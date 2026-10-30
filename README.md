# SPY-6 vs SPY-1D: Flight III Kill Chain Simulation

Interactive 3D simulation for a PHYS 271 (Electricity & Magnetism) project at the University of San Diego.

**Live:** https://jcameronbaird04-gif.github.io/spy6-sim/

A Flight III destroyer defends against a Red Sea style raid: drones, cruise missiles, an anti-ship
ballistic missile, a ballistic missile in space with decoys, an 8-drone swarm and a stand-off jammer.
Press Play, then switch the radar between **SPY-6** and **SPY-1D** and run the same raid again.

## What to watch for (the five advantages)

| # | Advantage | What happens in the sim |
|---|-----------|------------------------|
| 1 | Range | SPY-6 detects the anti-ship ballistic missile at ~215 nm; SPY-1D at ~43 nm |
| 2 | Capacity | During the swarm SPY-1D's track updates slow down and tracks are lost; SPY-6 keeps all of them |
| 3 | Jamming | A jammer turns on at T+2:40. SPY-6 nulls it; SPY-1D loses more than half its range in that sector |
| 4 | Discrimination | The ballistic missile releases 3 decoys. SPY-6 picks the warhead in 6 s, SPY-1D in about 40 s |
| 5 | Availability | Covered in the paper and charts (SPY-1 calibration downtime, SPY-6 graceful degradation) |

## Controls

Drag to look around (drag up to look into the sky) · right-drag or W A S D to move · Q / E down / up ·
scroll to zoom · click a threat in the list to follow it · Ship / Tactical / Space / Look up camera presets.

## Files

- `index.html`: the whole simulation (three.js r128, loaded from cdnjs)
- `scenario.yaml`: the scenario and the numbers behind it

## Honesty notes

Built from open sources only. The +15 dB (~30x) sensitivity and the 144-module / 37-RMA array come from
NAVSEA and CSIS. Ranges, target sizes, jamming loss and discrimination times are illustrative values chosen
to show the physics; they are not classified performance figures. Both radars defeat the raid, as USS Carney
did with SPY-1D in 2023; the difference is time and margin.
