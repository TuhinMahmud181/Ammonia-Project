# Ammonia Kinetics Rig · Virtual Lab

An interactive simulation of a bench-scale rig for measuring ammonia synthesis over a liquid-metal catalyst. It covers the whole rig, from the gas cylinders to the vent, and follows the rig P&ID (PID-002, simplified).

Open `index.html` in a browser. It has no dependencies and needs no build step.

## What you can do

- **Operate the rig on a live P&ID.** Click any element on the drawing to get its control right there: cylinders, valves (HV-111, HV-205, HV-201, HV-202, HV-601), the NV-401 opening, the set points of FIC-101 and FIC-102, the Ar rotameter FI-104, the vacuum pump P-601, the furnace H-201 and its set point, the ESD button, and the catalyst in R-201. Gas moves along each pipe as coloured dashes, faster for more flow. The colour shows the gas the pipe holds; pale dotted pipes are under vacuum.
- **Set the catalyst.** Click the reactor in the drawing and type or slide the catalyst charge (5–150 g) and its active-material content (0–20 %). The melt depth and the rates follow during a run.
- **See the instrument wiring.** PT-201, PT-301, TE-201 and both MFCs are wired to a LabJack U6. The U6 writes the MFC set points from DAC0 and DAC1, and switches P-601 from FIO0 through a relay. It connects by USB to a PC that shows the live readings and trends. Each U6 terminal shows its live voltage, and a wiring table lists the channels and their scaling.
- **Run a timed program.** The run starts with the melt hot and liquid under Ar, and repeats four phases for the number of cycles you set. Each phase has its own time, and the total run time is the sum. The phase name and countdown show on the drawing while it runs:
  1. **Ar purge:** Ar bubbles through dip tubes S1 and S2 and leaves through NV-401 and the acid trap.
  2. **Evacuation:** the cylinders are shut and P-601 pulls the reactor down through NV-401, which opens in stages.
  3. **Reaction:** NV-401 is shut. H₂ bubbles through S2 and N₂ through S1 until PT-301 reaches the fill pressure, and the melt is held under that gas for the rest of the phase.
  4. **Release:** all inlets are shut and NV-401 opens slowly.

  An optional final Ar purge sweeps everything into the trap, which is then analysed. HV-202 stays closed. The PSV-301 discharge line only shows flow if the valve lifts on overpressure.
- **Compare kinetic hypotheses.** The rig is built to measure the kinetics, so the chemistry is a choice, not a prediction:
  - **A · stable nitride:** a metal nitride forms and is too stable to give NH₃. N₂ uptake shows on PT-301, but the acid stays blank.
  - **B · catalytic:** NH₃ forms at a turnover frequency (TOF) you set, with an Arrhenius term and the NH₃ equilibrium limit.
  - **C · store and release:** reactive N builds up in the melt under N₂ + H₂ and comes out as NH₃ when the pressure is reduced.
- **See what a run could detect.** The analysis reports NH₄⁺-N in the single acid trap AB-507, with realistic noise and a 0.02 mg N/L detection limit. The model also tracks the NH₃ that gets past the trap to the vent, which a real run cannot measure. It also gives the apparent TOF and the smallest TOF that run could have detected.
- **Trigger the HAZOP deviations.** The following hazards are live:
  - acid suck-back, including reverse flow through a stopped pump (with one trap and no suck-back bottle, the acid runs straight back toward the pump);
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

Each gas volume is a well-mixed ideal-gas node holding H₂, N₂, Ar, NH₃ and O₂. The nodes are the H₂ line, the feed header, the R-201 headspace, the pump suction, the line to the trap, and the acid trap AB-507.

- **Flows** are driven by pressure difference through valve conductances. The model includes the bubbler liquid heads, the melt's hydrostatic head at the sparger tips, and one-way check valves. Each transfer is capped at half the amount that would equalise the two nodes, so the explicit 0.05 s step stays stable for any valve line-up.
- **Heat:** the furnace runs at 1.4 kW on its own controller. The reactor and melt lag behind it and sit a little cooler. The melt is solid below 125 °C (DSC onset) and mushy up to the liquidus, and the spargers only pass gas when the melt is liquid. O₂ that gets into the reactor oxidises the hot catalyst.

U6 signal ranges are provisional too: 0–5 V for 0–300 kPa abs on the transducers, a type K thermocouple on AIN2/AIN3 (differential), and 0–5 V for 0–100 sccm on the MFCs. All volumes, set points and rate constants are provisional design values (see `defaults()` in `sim.js`). The simulation is for rehearsing the procedure, checking valve line-ups and training operators. It does not predict the real kinetics; the measured data will.

## Files

| File | Contents |
| --- | --- |
| `index.html` | Page layout and styles |
| `app.js` | Live P&ID drawing, on-diagram controls, LabJack U6 wiring, charts |
| `sim.js` | Simulation engine (works in a browser or Node) |
| `tests/selftest.js` | Headless check: `node tests/selftest.js` |

## Contributors

- **Tuhin Mahmud**: Department of Chemical Engineering, BUET
