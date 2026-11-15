// Render pipeline: one or two scenes side by side into an HDR buffer, then bloom, then a filmic grade.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// Draws each view's scene into its own rectangle of the frame (fractions of the width).
class ViewsPass extends Pass {
  constructor() { super(); this.needsSwap = false; this.views = []; this.clear = true; }
  render(renderer, writeBuffer, readBuffer) {
    const rt = readBuffer, W = rt.width, H = rt.height;
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear();
    rt.scissorTest = true;
    for (const v of this.views) {
      const x = Math.round(v.x0 * W), w = Math.round(v.x1 * W) - x;
      rt.viewport.set(x, 0, w, H); rt.scissor.set(x, 0, w, H);
      renderer.setRenderTarget(rt);
      v.before?.();
      renderer.render(v.scene, v.camera);
    }
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H);
    renderer.setRenderTarget(rt);
  }
}

// Any invalid or absurdly bright pixel would be smeared across the frame by the bloom blur: stop it here.
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      bool ok = c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0 && c.r < 1e4 && c.g < 1e4 && c.b < 1e4;   // false for NaN and Inf
      gl_FragColor = vec4(ok ? min(c, vec3(48.0)) : vec3(0.0), 1.0);
    }`,
};

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uExposure: { value: 1 }, uSplit: { value: -1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uExposure, uSplit; uniform vec2 uRes; varying vec2 vUv;
    // ACES filmic (Stephen Hill's fit)
    vec3 aces(vec3 c){
      const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      c = inM * c; vec3 a = c * (c + 0.0245786) - 0.000090537, b = c * (0.983729 * c + 0.4329510) + 0.238081;
      return clamp(outM * (a / b), 0.0, 1.0);
    }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      c = aces(c);
      c = pow(c, vec3(1.0 / 2.2));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.08);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);                                    // a little more contrast in the mid-tones
      // vignette per view, so each half of a split screen is framed on its own
      vec2 q = vUv; if (uSplit > 0.0) q.x = q.x < uSplit ? q.x / uSplit : (q.x - uSplit) / (1.0 - uSplit);
      q -= 0.5; c *= 1.0 - dot(q, q) * 0.42;
      c += (fract(sin(dot(floor(vUv * uRes) + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;   // grain doubles as dither
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.composer = new EffectComposer(renderer, rt);
    this.views = new ViewsPass(); this.composer.addPass(this.views);
    this.composer.addPass(new ShaderPass(SANITIZE));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 1.15); this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE); this.composer.addPass(this.grade);
  }
  // Whole pixels only: a fractional buffer size corrupts the bloom mip chain.
  setSize(w, h, pixelRatio) {
    const W = Math.max(2, Math.floor(w * pixelRatio)), H = Math.max(2, Math.floor(h * pixelRatio));
    this.composer.setPixelRatio(1); this.composer.setSize(W, H);
    this.grade.uniforms.uRes.value.set(W, H);
  }
  render(views, timeSec, split) {
    this.views.views = views;
    this.grade.uniforms.uTime.value = timeSec; this.grade.uniforms.uSplit.value = split;
    this.composer.render();
  }
}
