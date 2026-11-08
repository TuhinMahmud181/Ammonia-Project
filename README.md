# Ammonia Kinetics Rig · Virtual Lab

An interactive simulation of a bench-scale rig for measuring ammonia synthesis over a molten Yb–Bi–Sn catalyst. It covers the whole rig, from the gas cylinders to the vent, and follows the rig P&ID (PID-002, simplified).

Open `index.html` in a browser. It has no dependencies and needs no build step.

## What you can do

- **Operate the rig on a live P&ID.** Click cylinders, valves (XV-101, HV-111, HV-205, HV-201, HV-202, HV-601), the vacuum pump P-601, the furnace H-201 and the ESD button. The flow controllers FIC-101 and FIC-102, the Ar rotameter FI-104, the needle valve NV-401 and the furnace set point are sliders. Lines are coloured by the gas they hold. Moving dashes show flow, and pale dashed lines are under vacuum.
- **Rehearse the procedure.** The steps are: leak-up test, three Ar purge cycles (feed lines included), melting under a small Ar flow, filling with N₂ + H₂ through a sparger, hold, release through the acid traps, pump-down, Ar sweep, and indophenol analysis. The run-sequence panel ticks each step off as you complete it. **Run the full SOP** carries out the whole sequence automatically.
- **Compare kinetic hypotheses.** The rig is built to measure the kinetics, so the chemistry is a choice, not a prediction:
  - **A · YbN sink:** YbN forms and is too stable to give NH₃. N₂ uptake shows on PT-301, but the acid stays blank.
  - **B · catalytic:** NH₃ forms at a turnover frequency (TOF) you set, with an Arrhenius term and the NH₃ equilibrium limit.
  - **C · store and release:** reactive N builds up in the melt under N₂ + H₂ and comes out as NH₃ when the pressure is reduced.
- **See what a run could detect.** The analysis reports NH₄⁺-N in AB-507 and AB-508 with realistic noise and a 0.02 mg N/L detection limit. It also gives the apparent TOF and the smallest TOF that run could have detected.
- **Trigger the HAZOP deviations.** The following hazards are live:
  - acid suck-back, including reverse flow through a stopped pump;
  - H₂ admitted to an unpurged reactor;
  - feeding gas into a solid melt;
  - a sparger freezing shut after a power cut;
  - pressurisation when a sealed reactor is heated, and PSV-301 lifting;
  - violent bubbling in the traps;
  - opening a hot reactor;
  - a failed leak-up test.

  Injectable faults: a worn gasket, CV-505 passing, FIC-101 failing open, and mains power failure.
- **Export the data.** You can copy the logger CSV (5 s) and the manual log sheet (5 min).

## Model in brief

Each gas volume is a well-mixed ideal-gas node holding H₂, N₂, Ar, NH₃ and O₂. The nodes are the H₂ line, the feed header, the R-201 headspace, the pump suction, SB-506, the two acid traps and the oil bubbler.

- **Flows** are driven by pressure difference through valve conductances. The model includes the bubbler liquid heads, the melt's hydrostatic head at the sparger tips, and one-way check valves. Each transfer is capped at half the amount that would equalise the two nodes, so the explicit 0.05 s step stays stable for any valve line-up.
- **Heat:** the furnace runs at 1.4 kW on its own controller. The reactor and melt lag behind it and sit a little cooler. The melt is solid below 125 °C (DSC onset) and mushy up to the liquidus, and the spargers only pass gas when the melt is liquid. O₂ that gets into the reactor oxidises the hot Yb.

All volumes, set points and rate constants are provisional design values (see `defaults()` in `sim.js`). The simulation is for rehearsing the procedure, checking valve line-ups and training operators. It does not predict the real kinetics; the measured data will.

## Files

| File | Contents |
| --- | --- |
| `index.html` | Page, P&ID drawing, controls, charts |
| `sim.js` | Simulation engine (works in a browser or Node) |
| `tests/selftest.js` | Headless check: `node tests/selftest.js` |

## Contributors

- **Tuhin Mahmud**: Department of Chemical Engineering, BUET
