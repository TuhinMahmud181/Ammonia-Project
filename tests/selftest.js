// Headless self-test: runs one scripted loop under each kinetic hypothesis
// and a few HAZOP deviations, and prints the outcome.  Usage: node tests/selftest.js
const S = require("../sim.js");
const P = (s) => S.press(s.N.rx) / 1000;
let fail = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fail++; };

function runSOP(params, hold) {
  const s = S.create(params), A = S.demoScript(hold); let i = 0;
  while (s.t < 6 * 3600 && i < A.length) { if (A[i].when(s)) { A[i].act(s); i++; } else S.advance(s, 1); }
  return { s, finished: i === A.length };
}
for (const mode of ["nitride", "tof", "release"]) {
  const { s, finished } = runSOP({ mode }, 60);
  const r = S.readings(s), a = s.analysis;
  ok(finished, `${mode}: procedure completes (${(s.t / 60).toFixed(0)} min)`);
  ok(Object.values(s.alarms).length === 0, `${mode}: no alarms left active`);
  const inGas = Object.values(s.N).reduce((a, nd) => a + (nd.atm ? 0 : nd.n[3]), 0) * 1e6;
  const balance = Math.abs(r.made - r.cap1 - r.slip - inGas) <= 0.02 * r.made + 0.05;
  ok(balance, `${mode}: NH3 made ${r.made.toFixed(2)} µmol = trap ${r.cap1.toFixed(2)} + vent ${r.slip.toFixed(3)} + still in gas ${inGas.toFixed(2)}`);
  ok(!s.events.some((e) => e.level === "warn" || e.level === "alarm"), `${mode}: the loop raises no warnings`);
  ok(!s.events.some((e) => e.text.includes("PSV-301 lifting")), `${mode}: PSV-301 stays shut`);
  console.log(`      AB-507 ${a.a1.below ? "<LOD" : a.a1.meas.toFixed(3)} mg N/L, apparent TOF ${a.tofApparent.toExponential(2)}, LOD TOF ${a.tofLOD.toExponential(1)}`);
}
{ const s = S.create(); s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 20;
  while (P(s) > 5) S.advance(s, 1); s.v.pump = false; S.advance(s, 120);
  ok(!!s.alarms.suck, "stopping P-601 with HV-601 open causes acid suck-back"); }
{ const s = S.create({ fLeak: true }); s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 100;
  while (P(s) > 5 && s.t < 900) S.advance(s, 1); s.v.NV401 = 0; S.advance(s, 400);
  ok(s.sop.leak.state === "fail", "worn gasket fails the leak-up test"); }
{ const s = S.create(); s.v.cylH2 = true; s.sp.FIC101 = 100; s.v.HV111 = true; s.v.HV202 = true; s.v.NV401 = 50; S.advance(s, 900);
  ok(s.events.some((e) => e.text.startsWith("FLAMMABLE")), "H2 into an unpurged reactor raises the flammable alarm"); }
{ const s = S.create({ mode: "tof" }); const n0 = s.melt.nAct; S.setMelt(s, 100, 5);
  ok(Math.abs(s.melt.nAct / n0 - 2) < 1e-9 && Math.abs(s.cat.metal / n0 - 2) < 1e-9, "doubling the catalyst charge doubles the active metal inventory"); }
{ const s = S.create(); s.v.furnace = true; s.sp.furnaceSP = 400; S.advance(s, 3 * 3600);
  ok(P(s) > 130, `heating a sealed reactor pressurises it (${P(s).toFixed(0)} kPa)`); }
console.log(fail ? `${fail} check(s) failed` : "all checks passed");
process.exit(fail ? 1 : 0);
