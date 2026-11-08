// Headless self-test: runs the run program (Ar purge -> Evacuation -> Reaction -> Release) under each
// kinetic hypothesis, plus a few HAZOP deviations.  Usage: node tests/selftest.js
const S = require("../sim.js");
const P = (s) => S.press(s.N.rx) / 1000;
let fail = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fail++; };

function runProgram(params, cfg) {
  const s = S.create(params);
  S.startProgram(s, cfg);
  while (!s.prog.done && s.t < 12 * 3600) S.advance(s, 1);
  return s;
}
for (const mode of ["nitride", "tof", "release"]) {
  const cfg = { cycles: 2, min: { ar: 15, evac: 10, react: 30, rel: 15 } };
  const s = runProgram({ mode }, cfg);
  const r = S.readings(s), a = s.analysis;
  const expect = 2 * (15 + 10 + 30 + 15) + 15;
  ok(s.prog.done && Math.abs(s.t / 60 - expect) < 0.5, `${mode}: 2 cycles + final purge take ${(s.t / 60).toFixed(0)} min (expected ${expect})`);
  ok(Math.abs(s.reactSec / 60 - 60) < 0.5, `${mode}: reaction time counted ${(s.reactSec / 60).toFixed(0)} min`);
  ok(!s.events.some((e) => e.level === "warn" || e.level === "alarm"), `${mode}: no warnings or alarms`);
  const inGas = Object.values(s.N).reduce((x, nd) => x + (nd.atm ? 0 : nd.n[3]), 0) * 1e6;
  ok(Math.abs(r.made - r.cap1 - r.slip - inGas) <= 0.02 * r.made + 0.05, `${mode}: NH3 made ${r.made.toFixed(2)} µmol = trap ${r.cap1.toFixed(2)} + vent ${r.slip.toFixed(3)} + gas ${inGas.toFixed(2)}`);
  console.log(`      AB-507 ${a.a1.below ? "<LOD" : a.a1.meas.toFixed(3)} mg N/L, apparent TOF ${a.tofApparent.toExponential(2)}, LOD TOF ${a.tofLOD.toExponential(1)}`);
}
{ const s = S.create({ mode: "tof" }); S.startProgram(s, { min: { ar: 5, evac: 10, react: 40, rel: 10 } });
  let pmax = 0; while (!s.prog.done) { S.advance(s, 1); if (S.programStatus(s).phase && S.programStatus(s).phase.key === "react") pmax = Math.max(pmax, P(s)); }
  ok(pmax < 125 && pmax > 118, `reaction feed stops at the fill pressure (max PT-301 ${pmax.toFixed(1)} kPa, fill 120)`); }
{ const s = S.create(); s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 20;
  while (P(s) > 5) S.advance(s, 1); s.v.pump = false; S.advance(s, 120);
  ok(!!s.alarms.suck, "stopping P-601 with HV-601 open causes acid suck-back"); }
{ const s = S.create({ fLeak: true, hotStart: false }); s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 100;
  while (P(s) > 5 && s.t < 900) S.advance(s, 1); s.v.NV401 = 0; S.advance(s, 400);
  ok(s.sop.leak.state === "fail", "worn gasket fails the leak-up test"); }
{ const s = S.create({ hotStart: false }); s.v.cylH2 = true; s.sp.FIC101 = 100; s.v.HV111 = true; s.v.HV202 = true; s.v.NV401 = 50; S.advance(s, 900);
  ok(s.events.some((e) => e.text.startsWith("FLAMMABLE")), "H2 into an unpurged reactor raises the flammable alarm"); }
{ const s = S.create({ mode: "tof" }); const n0 = s.melt.nAct; S.setMelt(s, 100, 5);
  ok(Math.abs(s.melt.nAct / n0 - 2) < 1e-9, "doubling the catalyst charge doubles the active material"); }
{ const s = S.create(); s.v.cylAr = true; s.sp.FI104 = 500; s.v.HV111 = true; s.v.HV201 = true; S.advance(s, 1800);
  ok(s.events.some((e) => e.text.includes("PSV-301 lifting")), "feeding a closed reactor lifts PSV-301"); }
console.log(fail ? `${fail} check(s) failed` : "all checks passed");
process.exit(fail ? 1 : 0);
