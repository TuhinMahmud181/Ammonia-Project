/*
 * Liquid-metal ammonia kinetics rig — simulation engine
 * Follows P&ID PID-002 (simplified, rev G): H2 / N2 / Ar cylinders -> regulators -> MFCs -> header
 * -> spargers S1 / S2 or headspace -> R-201 in furnace H-201 -> NV-401 -> (CV-505 or P-601)
 * -> AB-507 acid trap (dilute H2SO4) -> vent outdoors. Instruments read by a LabJack U6.
 *
 * Lumped model: every gas volume is a well-mixed node (ideal gas, 5 species). Flows between
 * nodes are pressure-driven through valve conductances; each transfer is capped at half of what
 * would equalise the two nodes, so the explicit step stays stable for any valve setting.
 *
 * Author: Tuhin Mahmud (BUET). No external dependencies; runs in a browser or in Node.
 */
(function (root) {
  "use strict";

  const R = 8.314462618;       // J/mol/K
  const PATM = 101325;         // Pa
  const SCCM = 101325 * 1e-6 / 60 / (R * 273.15);   // mol/s per sccm (0 °C, 1 atm)
  const G = 9.81;
  const SP = ["H2", "N2", "Ar", "NH3", "O2"];
  const H2 = 0, N2 = 1, AR = 2, NH3 = 3, O2 = 4;
  const AIR = [0, 0.7809, 0.0093, 0, 0.2098];
  
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sum = (a) => a[0] + a[1] + a[2] + a[3] + a[4];

  /* ---------------- default parameters (all provisional, edit to match the build) ---------------- */
  function defaults() {
    return {
      Tamb: 30,               // °C, lab ambient
      actPct: 5,              // at% active metal in the melt
      Mmelt: 170,             // g/mol, mean molar mass of the melt
      meltMass: 50,           // g
      solidus: 125,           // °C, DSC onset
      // reactor R-201: SS316L Sch 10S pipe, ~170 mm tall, MgO crucible inside
      Vreactor: 0.80e-3,      // m3 internal
      crucibleID: 0.036,      // m
      meltRho: 9000,          // kg/m3
      // regulators (delivery pressure, kPa abs)
      PregH2: 200, PregN2: 200, PregAr: 200,
      psvSet: 151.3,          // kPa abs (0.5 barg), PSV-301
      pumpSpeed: 20,          // L/min, P-601
      pumpUlt: 0.1,           // kPa ultimate
      acidVol: 100,           // mL per acid trap
      acidMolar: 0.05,        // mol/L H2SO4
      // chemistry
      mode: "tof",            // "nitride" | "tof" | "release"
      logTOF: -6,             // log10 TOF, s^-1 per active-metal atom at 200 °C
      Ea: 80,                 // kJ/mol apparent activation energy (mode tof)
      storePct: 2,            // % of active metal that can hold reactive N (mode release)
      nitrideTau: 30,         // min, time constant of nitride formation at 200 °C, 1 bar N2 (mode nitride)
      // faults
      fLeak: false, fCV505: false, fFIC101: false, fPower: false
    };
  }

  /* ---------------- model ---------------- */
  function create(userParams) {
    const p = Object.assign(defaults(), userParams || {});
    const s = { p, t: 0, events: [], alarms: {}, logs: [], manual: [], lastLog: -1e9, lastManual: -1e9 };
    reset(s);
    return s;
  }

  function node(V, T, P, comp) {
    const n = (P * V) / (R * T);
    return { V, T, n: comp.map((x) => x * n) };
  }
  const press = (nd) => (nd.atm ? PATM : (sum(nd.n) * R * nd.T) / nd.V);
  const frac = (nd, i) => { if (nd.atm) return AIR[i]; const t = sum(nd.n); return t > 0 ? nd.n[i] / t : 0; };

  function meltProps(p) {
    const xAct = p.actPct / 100;
    const nTot = p.meltMass / p.Mmelt;
    const vol = p.meltMass / 1000 / p.meltRho;                       // m3
    const depth = vol / (Math.PI * p.crucibleID * p.crucibleID / 4);
    const liquidus = 140 + 3 * p.actPct;                                // °C, provisional (broad two-phase region on DSC)
    return { nAct: xAct * nTot, nTot, vol, depth, head: p.meltRho * G * depth, liquidus };
  }

  function reset(s) {
    const p = s.p, Ta = p.Tamb + 273.15;
    const m = meltProps(p);
    s.melt = m;
    s.t = 0; s.events = []; s.alarms = {}; s.logs = []; s.manual = []; s.lastLog = -1e9; s.lastManual = -1e9;
    s.N = {
      h2l: node(15e-6, Ta, PATM, AIR),
      hdr: node(25e-6, Ta, PATM, AIR),
      rx: node(p.Vreactor - m.vol, Ta, PATM, AIR),
      y: node(20e-6, Ta, PATM, AIR),
      ln: node(15e-6, Ta, PATM, AIR),                       // line from P-601 / CV-505 to the trap
      a1: node((250 - p.acidVol) * 1e-6, Ta, PATM, AIR),
      atm: { atm: true, V: Infinity, T: Ta, n: [0, 0, 0, 0, 0] }
    };
    s.liq = {
      ln: { acid: 0, oil: 0, nh3: 0, cap: 15 },                     // liquid that comes back up the inlet tube
      a1: { acid: p.acidVol, oil: 0, nh3: 0, cap: 250, tip: 15, h2so4: p.acidVol / 1000 * p.acidMolar }
    };
    s.v = {   // valves and switches; true = open / on
      cylH2: false, cylN2: false, cylAr: false,
      XV101: false, HV111: false, HV205: false, HV201: false, HV202: false, HV601: false,
      NV401: 0,              // 0..100 % opening
      pump: false, furnace: false, esd: false
    };
    s.sp = { FIC101: 0, FIC102: 0, FI104: 0, furnaceSP: 220 };   // sccm, sccm, sccm, °C
    s.th = { Tf: Ta, Tm: Ta, Pw: 0, I: 0 };
    s.cat = { metal: m.nAct, nitride: 0, oxide: 0, store: 0 };
    s.made = { nh3: 0, n2up: 0, slip: 0 };                                   // mol NH3 formed, mol N2 taken up
    s.flows = { FIC101: 0, FIC102: 0, FI104: 0, S1: 0, S2: 0, HV202: 0, HV111: 0, NV401: 0, CV505: 0, pump: 0, b1: 0, b2: 0, b3: 0, vent: 0, psv: 0, leak: 0 };
    s.spg = { S1: { inTube: false, plugged: false }, S2: { inTube: false, plugged: false } };
    s.sop = { leak: { state: "idle", t0: 0, P0: 0, rate: null }, cycles: 0, evacuated: false, done: {} };
    s.analysis = null;
    s.yLiquid = 0;
    s.speedCap = 0;
    event(s, "info", "Rig cold, reactor and lines full of air, all valves closed, cylinders shut.");
  }

  function event(s, level, text) { s.events.push({ t: s.t, level, text }); if (s.events.length > 400) s.events.shift(); }
  function alarm(s, key, on, level, text) {
    const was = s.alarms[key];
    if (on && !was) { s.alarms[key] = { level, text, t: s.t }; event(s, level, text); }
    else if (!on && was) { delete s.alarms[key]; }
  }

  /* move dn mol from a to b (negative = b to a) with the composition of the donor */
  function move(a, b, dn, out) {
    if (dn === 0) return;
    let from = a, to = b; if (dn < 0) { from = b; to = a; dn = -dn; }
    const tot = from.atm ? 1 : sum(from.n);
    if (!from.atm) dn = Math.min(dn, tot * 0.5);
    for (let i = 0; i < 5; i++) {
      const x = from.atm ? AIR[i] : from.n[i] / tot, d = x * dn;
      if (!from.atm) from.n[i] -= d;
      if (!to.atm) to.n[i] += d;
      if (out) out[i] += d;
    }
  }
  const kk = (nd) => (nd.atm ? 0 : (R * nd.T) / nd.V);
  /* capped pressure-driven transfer over dt; offset = Pa - Pb needed before anything flows */
  function flowDP(a, b, Gc, dt, offset) {
    const dp = press(a) - press(b) - (offset || 0);
    if (Gc <= 0 || dp === 0) return 0;
    let dn = Gc * dp * dt;
    const eq = 0.5 * Math.abs(dp) / (kk(a) + kk(b) || 1e-30);
    if (Math.abs(dn) > eq) dn = Math.sign(dn) * eq;
    return dn;
  }

  /* ---------------- one time step ---------------- */
  function step(s, dt) {
    const p = s.p, N = s.N, v = s.v, L = s.liq, m = s.melt, th = s.th;
    const Ta = p.Tamb + 273.15;
    const power = !p.fPower;
    const fl = { FIC101: 0, FIC102: 0, FI104: 0, S1: 0, S2: 0, HV202: 0, HV111: 0, NV401: 0, CV505: 0, pump: 0, b1: 0, vent: 0, psv: 0, leak: 0 };

    /* --- thermal: furnace chamber (own controller) and reactor + melt --- */
    const heaterOK = v.furnace && power && !v.esd;
    if (heaterOK) {
      const e = s.sp.furnaceSP + 273.15 - th.Tf;
      let u = e / 15 + th.I;
      if (u > 0 && u < 1) th.I = clamp(th.I + (e * dt) / (15 * 900), 0, 0.6);
      th.Pw = 1400 * clamp(u, 0, 1);
    } else { th.Pw = 0; th.I = 0; }
    const Cf = 6000, UAf = 1.2, UAfr = 1.5, UAtop = 0.15;
    const Tm = th.Tm - 273.15;
    let Cm = 900 + p.meltMass * 0.18;
    if (Tm > p.solidus && Tm < m.liquidus) Cm += (p.meltMass * 45) / (m.liquidus - p.solidus);   // latent heat ~45 J/g
    th.Tf += ((th.Pw - UAf * (th.Tf - Ta) - UAfr * (th.Tf - th.Tm)) / Cf) * dt;
    th.Tm += ((UAfr * (th.Tf - th.Tm) - UAtop * (th.Tm - Ta)) / Cm) * dt;
    const TmC = th.Tm - 273.15;
    const fL = clamp((TmC - p.solidus) / (m.liquidus - p.solidus), 0, 1);
    s.fL = fL;
    N.rx.T = Ta + 0.85 * (th.Tm - Ta);           // headspace gas sits between melt and cold top flange
    N.rx.V = p.Vreactor - m.vol;

    /* --- supplies through regulators and flow controllers --- */
    const supply = (cyl, Preg, spSccm, nd) => {
      if (!cyl) return 0;
      const f = spSccm * SCCM * clamp((Preg * 1000 - press(nd)) / 15000, 0, 1);
      return f * dt;
    };
    const xvOpen = v.XV101 && power && !v.esd;
    const sp101 = p.fFIC101 ? 100 : s.sp.FIC101;
    let d;
    d = supply(v.cylH2 && xvOpen, p.PregH2, sp101, N.h2l); N.h2l.n[H2] += d; fl.FIC101 = d / dt / SCCM;
    d = supply(v.cylN2, p.PregN2, s.sp.FIC102, N.hdr); N.hdr.n[N2] += d; fl.FIC102 = d / dt / SCCM;
    d = supply(v.cylAr, p.PregAr, s.sp.FI104, N.hdr); N.hdr.n[AR] += d; fl.FI104 = d / dt / SCCM;

    /* --- header / H2 line --- */
    if (v.HV111) { d = flowDP(N.h2l, N.hdr, 2e-6, dt); move(N.h2l, N.hdr, d); fl.HV111 = d / dt / SCCM; }

    /* --- spargers into the melt --- */
    const sparge = (key, open, line) => {
      const sg = s.spg[key];
      if (!open) return 0;
      const Pl = press(line), Pr = press(N.rx);
      if (fL > 0.5 && Pl < Pr + m.head - 300 && !sg.inTube) { sg.inTube = true; event(s, "warn", `Melt drawn up sparger ${key}: line pressure fell below reactor pressure.`); }
      if (sg.inTube && fL > 0.5 && Pl > Pr + m.head + 500) sg.inTube = false;
      if (sg.inTube && fL < 0.05 && !sg.plugged) { sg.plugged = true; event(s, "alarm", `Sparger ${key} PLUGGED: melt froze inside the dip tube. Cool, open R-201 and clear it.`); }
      if (sg.plugged) return 0;
      const Gs = 3e-8 * fL * fL;
      let dn = flowDP(line, N.rx, Gs, dt, m.head);
      if (dn < 0) dn = 0;                       // melt seals the tip against reverse gas flow
      move(line, N.rx, dn);
      return dn / dt / SCCM;
    };
    fl.S1 = sparge("S1", v.HV201, N.hdr);
    fl.S2 = sparge("S2", v.HV205, N.h2l);
    if (v.HV202) { d = flowDP(N.hdr, N.rx, 2e-6, dt); move(N.hdr, N.rx, d); fl.HV202 = d / dt / SCCM; }

    /* --- outlet: PSV-301, flange leak, NV-401 --- */
    const Prx = press(N.rx);
    if (Prx > p.psvSet * 1000) { d = flowDP(N.rx, N.atm, 2e-7, dt, p.psvSet * 1000 - PATM); if (d > 0) { move(N.rx, N.atm, d); fl.psv = d / dt / SCCM; } }
    if (p.fLeak) { d = flowDP(N.rx, N.atm, 2e-11, dt); move(N.rx, N.atm, d); fl.leak = d / dt / SCCM; }
    else { d = flowDP(N.rx, N.atm, 2e-14, dt); move(N.rx, N.atm, d); }
    if (v.NV401 > 0) { const u = v.NV401 / 100; d = flowDP(N.rx, N.y, 3e-7 * u * u, dt); move(N.rx, N.y, d); fl.NV401 = d / dt / SCCM; }

    /* --- CV-505 bypass and vacuum pump P-601 --- */
    d = flowDP(N.y, N.ln, 1e-6, dt, 500);
    if (d < 0) d = 0;
    if (p.fCV505) d = flowDP(N.y, N.ln, 1e-6, dt);   // failed check valve passes both ways
    move(N.y, N.ln, d); fl.CV505 = d / dt / SCCM;
    const pumpOn = v.pump && power && !v.esd;
    if (v.HV601) {
      if (pumpOn) {
        const Py = press(N.y), Pu = p.pumpUlt * 1000;
        if (Py > Pu) {
          let dn = (p.pumpSpeed / 60000) * (Py - Pu) / (R * N.y.T) * dt;
          dn = Math.min(dn, 0.5 * sum(N.y.n) * (Py - Pu) / Py);
          move(N.y, N.ln, dn); fl.pump = dn / dt / SCCM;
        }
      } else {
        d = flowDP(N.y, N.ln, 5e-8, dt); move(N.y, N.ln, d); fl.pump = d / dt / SCCM;   // leak back through a stopped pump
      }
    }

    /* --- bubbler train: SB-506 -> AB-507 -> AB-508 -> BB-509 -> vent --- */
    const bubbler = (up, upLiq, key, hd, fkey) => {
      const B = L[key];
      const area = 25e-4;                          // m2, bottle cross-section
      const above = Math.max(0, B.acid + B.oil - B.tip);           // mL of liquid above the dip-tube tip
      const rho = B.oil > B.acid ? 970 : 1000;
      const head = rho * G * (above * 1e-6 / area);
      const dp = press(up) - press(hd);
      if (dp > head) {
        const dn = flowDP(up, hd, 2e-7, dt, head);
        if (dn > 0) {
          const got = [0, 0, 0, 0, 0];
          move(up, hd, dn, got);
          // NH3 absorption in acid
          if (B.acid > 0 && B.h2so4 !== undefined) {
            const q = dn / dt / SCCM;
            const capLeft = Math.max(0, 2 * B.h2so4 - B.nh3);
            const eff = (capLeft > 0 ? 1 - Math.exp(-1500 / Math.max(q, 1)) : 0) * clamp(above / 20, 0, 1);
            const ab = Math.min(hd.n[NH3], got[NH3] * eff, capLeft);
            hd.n[NH3] -= ab; B.nh3 += ab;
          }
          fl[fkey] = dn / dt / SCCM;
        }
      } else if (dp < -1000 && above > 0) {
        // suck-back: liquid climbs the inlet dip tube and spills into the upstream bottle
        let vol = 2e-9 * (-dp - 1000) * dt * 1e6;   // mL
        vol = Math.min(vol, above);
        const fa = (B.acid + B.oil) > 0 ? B.acid / (B.acid + B.oil) : 1;
        const nh3m = B.acid > 0 ? (B.nh3 * (vol * fa) / B.acid) : 0;
        B.acid -= vol * fa; B.oil -= vol * (1 - fa); B.nh3 -= nh3m;
        if (B.h2so4 !== undefined) { const hs = B.h2so4 * (vol * fa) / (B.acid + vol * fa); B.h2so4 -= hs; if (upLiq.h2so4 !== undefined) upLiq.h2so4 += hs; else upLiq.h2so4x = (upLiq.h2so4x || 0) + hs; }
        upLiq.acid += vol * fa; upLiq.oil += vol * (1 - fa); upLiq.nh3 += nh3m;
        fl[fkey] = -vol / dt;   // mL/s, negative marks liquid going backwards
        if (key === "a1" && vol > 0) s.suckback = true;
      } else if (dp < 0 && above <= 0) {
        const dn = flowDP(up, hd, 2e-7, dt); move(up, hd, dn); fl[fkey] = dn / dt / SCCM;   // gas comes back once the tip is clear
      }
    };
    bubbler(N.ln, L.ln, "a1", N.a1, "b1");
    { const out = [0, 0, 0, 0, 0]; d = flowDP(N.a1, N.atm, 5e-6, dt); move(N.a1, N.atm, d, out); fl.vent = d / dt / SCCM; if (d > 0) s.made.slip += out[NH3]; }
    // gas volumes shrink or grow with the liquid moved around
    N.ln.V = Math.max(1e-6, (L.ln.cap - L.ln.acid - L.ln.oil)) * 1e-6;
    N.a1.V = (L.a1.cap - L.a1.acid - L.a1.oil) * 1e-6;
    if (L.ln.acid + L.ln.oil > 8) {
      const over = L.ln.acid + L.ln.oil - 8; L.ln.acid -= over; s.yLiquid += over;
      alarm(s, "sbOver", true, "alarm", "Acid has run back past CV-505 / P-601 toward NV-401: there is no suck-back bottle to catch it.");
      if (v.NV401 > 0 && Prx < press(N.y)) {
        const hot = th.Tm - 273.15 > 100;
        alarm(s, "acidRx", true, "alarm", hot ? "ACID ENTERED HOT R-201: violent boiling and H₂ from acid–metal reaction (HAZOP 4.1)."
          : "ACID ENTERED R-201: melt and crucible contaminated; strip, clean and recharge before the next run (HAZOP 4.1).");
      }
    }

    /* --- chemistry in the melt --- */
    const rx = N.rx, Prx2 = press(rx), tot = sum(rx.n);
    const pb = (i) => (tot > 0 ? (rx.n[i] / tot) * Prx2 / 1e5 : 0);   // bar
    const pH2 = pb(H2), pN2 = pb(N2), pNH3 = pb(NH3), pO2 = pb(O2);
    const sparging = fl.S1 + fl.S2 > 0.5;
    const contact = fL * (sparging ? 1 : 0.15);
    const Tk = th.Tm, arr = (Ea) => Math.exp((-Ea * 1000 / R) * (1 / Tk - 1 / 473.15));
    // oxidation of the active metal by any O2 that gets in (hot metal is a getter)
    if (pO2 > 0 && s.cat.metal > 0 && TmC > 60) {
      const r = Math.min(0.05 * s.cat.metal * pO2 * (TmC > p.solidus ? 1 : 0.2) * dt, rx.n[O2] * 0.9, s.cat.metal * 0.75);
      rx.n[O2] -= r; s.cat.metal -= (4 / 3) * r; s.cat.oxide += (4 / 3) * r;
    }
    if (contact > 0 && s.cat.metal > 0) {
      if (p.mode === "nitride") {
        // the nitride is too stable for H2 to reduce (thermodynamic result): N2 is taken up, no NH3 comes out
        const k = 1 / (p.nitrideTau * 60 * Math.sqrt(1));
        const r = Math.min(k * contact * s.cat.metal * Math.sqrt(pN2) * arr(60) * dt, rx.n[N2] * 2 * 0.5, s.cat.metal * 0.5);
        s.cat.metal -= r; s.cat.nitride += r; rx.n[N2] -= r / 2; s.made.n2up += r / 2;
      } else if (p.mode === "tof") {
        const K = Math.exp(-(-45900 + 99.0 * Tk) / (R * Tk));
        const Q = pN2 > 0 && pH2 > 0 ? pNH3 / (Math.sqrt(pN2) * Math.pow(pH2, 1.5)) : Infinity;
        const drive = isFinite(Q) ? 1 - Q / K : 0;
        const fp = (Math.sqrt(pN2) * Math.pow(pH2, 1.5)) / (Math.sqrt(0.25) * Math.pow(0.75, 1.5));
        let r = Math.pow(10, p.logTOF) * arr(p.Ea) * s.cat.metal * contact * fp * drive * dt;   // mol NH3
        if (r > 0) r = Math.min(r, rx.n[N2] * 2 * 0.2, rx.n[H2] * (2 / 3) * 0.2);
        else r = Math.max(r, -rx.n[NH3] * 0.2);
        rx.n[N2] -= r / 2; rx.n[H2] -= 1.5 * r; rx.n[NH3] += r; s.made.nh3 += r;
      } else if (p.mode === "release") {
        // hypothesis: reactive N–H species build up in the melt under N2 + H2 and come out as NH3 when the pressure drops
        const Smax = (p.storePct / 100) * s.cat.metal;
        const Seq = Smax * (Prx2 / (Prx2 + 50000));
        const feed = clamp((Math.sqrt(pN2) * Math.pow(pH2, 1.5)) / (Math.sqrt(0.25) * Math.pow(0.75, 1.5)), 0, 1);
        if (s.cat.store < Seq && feed > 0) {
          const r = Math.min((Seq - s.cat.store) / 1200 * contact * feed * arr(50) * dt, rx.n[N2] * 2 * 0.2, rx.n[H2] * (2 / 3) * 0.2);
          s.cat.store += r; rx.n[N2] -= r / 2; rx.n[H2] -= 1.5 * r; s.made.n2up += r / 2;
        } else if (s.cat.store > Seq) {
          const r = (s.cat.store - Seq) / 120 * fL * arr(50) * dt;
          s.cat.store -= r; rx.n[NH3] += r; s.made.nh3 += r;
        }
      }
    }

    s.fb1 = (s.fb1 || 0) + ((fl.b1 > 0 ? fl.b1 : 0) - (s.fb1 || 0)) * Math.min(1, dt / 4);   // smoothed AB-507 gas flow
    s.flows = fl;
    s.t += dt;
    checks(s);
    logPoint(s);
  }

  /* ---------------- safety checks and run-sequence tracking ---------------- */
  function checks(s) {
    const N = s.N, v = s.v, p = s.p, fl = s.flows;
    const Prx = press(N.rx) / 1000, TmC = s.th.Tm - 273.15;
    const xH2 = frac(N.rx, H2), xO2 = frac(N.rx, O2);
    alarm(s, "flam", xH2 > 0.04 && xO2 > 0.05, "alarm", "FLAMMABLE: H₂ and O₂ together in R-201 (H₂ > 4 %, O₂ > 5 %). Stop H₂, purge with Ar.");
    alarm(s, "ign", xH2 > 0.04 && xO2 > 0.05 && TmC > 500, "alarm", "IGNITION: flammable mixture above H₂ autoignition temperature.");
    alarm(s, "o2hot", xO2 > 1e-4 && TmC > 100 && s.cat.metal > 0, "warn", "Air in R-201 with hot melt: the catalyst metal is oxidising (purge with Ar before heating).");
    alarm(s, "pHigh", Prx > 130, "warn", "PT-301 high (>130 kPa): reactor pressurising. Check outlet line-up.");
    alarm(s, "psv", fl.psv > 1, "alarm", "PSV-301 lifting: reactor gas venting outdoors.");
    alarm(s, "pt201", press(N.hdr) / 1000 > 170, "warn", "PT-201 high: feed dead-headed. Sparger blocked or no outlet path?");
    const blocked = (open, line) => open && s.fL < 0.3 && press(line) > press(N.rx) + 3000;
    alarm(s, "frozen", blocked(v.HV201, N.hdr) || blocked(v.HV205, N.h2l), "warn", "Feeding into a solid melt: the sparger is blocked until the melt is fully liquid (HAZOP A7).");
    alarm(s, "vig", s.fb1 > 800, "warn", "Violent bubbling in AB-507 (>800 sccm): acid carry-over and NH₃ breakthrough. Throttle NV-401.");
    alarm(s, "suck", !!s.suckback && s.liq.ln.acid > 0.5, "alarm", "ACID SUCK-BACK out of AB-507: the trap was pulled below atmosphere. This run's NH₃ sample is lost.");
    alarm(s, "pumpRev", v.HV601 && !(v.pump && !p.fPower && !v.esd) && press(N.y) < press(N.ln) - 2000, "warn", "Reverse flow through stopped P-601: close HV-601 before stopping the pump (HAZOP 5.2).");
    alarm(s, "hot", TmC > 500, "warn", "Melt above 500 °C, the provisional rig operating limit.");
    alarm(s, "power", p.fPower, "alarm", "POWER FAILURE: furnace off, XV-101 closed, pump stopped. Melt will freeze around the spargers.");
    alarm(s, "esd", v.esd, "alarm", "ESD HS-902 pressed: XV-101 closed, furnace and pump off.");
    alarm(s, "h2noPurge", v.cylH2 && v.XV101 && s.flows.FIC101 > 0.5 && !s.sop.done.purge, "warn", "H₂ admitted before the Ar purge was completed (permissive P-1).");

    // leak-up test: reactor isolated after evacuation below 10 kPa, watched for 5 min
    const iso = !v.HV201 && !v.HV202 && !v.HV205 && v.NV401 === 0;
    const lk = s.sop.leak;
    if (lk.state === "idle" && iso && Prx < 10) { lk.state = "run"; lk.t0 = s.t; lk.P0 = Prx; }
    if (lk.state === "run") {
      if (!iso) { lk.state = "idle"; }
      else if (s.t - lk.t0 >= 300 || Prx - lk.P0 > 5) {
        lk.rate = (Prx - lk.P0) / ((s.t - lk.t0) / 60);
        lk.state = lk.rate < 0.1 ? "pass" : "fail";
        event(s, lk.state === "pass" ? "ok" : "alarm", `Leak-up test: ${lk.rate.toFixed(3)} kPa/min, ${lk.state === "pass" ? "PASS (< 0.1 kPa/min)" : "FAIL (limit 0.1 kPa/min): find and fix the leak before any H₂ (HAZOP A22)"}.`);
        if (lk.state === "pass") s.sop.done.leak = true;
      }
    }
    // purge cycles: evacuate below 5 kPa, refill above 95 kPa with mostly Ar
    if (Prx < 5) s.sop.evacuated = true;
    if (!s.sop.done.purge && s.sop.evacuated && Prx > 95 && frac(N.rx, AR) > 0.5) { s.sop.evacuated = false; s.sop.cycles++; event(s, "info", `Purge cycle ${s.sop.cycles} complete (evacuate + Ar refill).`); }
    if (!s.sop.done.purge && s.sop.cycles >= 3 && xO2 < 10e-6) { s.sop.done.purge = true; event(s, "ok", "R-201 purged: O₂ below 10 ppm."); }
    if (!s.sop.done.melt && s.fL >= 1 && s.sop.done.purge) { s.sop.done.melt = true; event(s, "ok", `Melt fully liquid (TE-201 ${TmC.toFixed(0)} °C) under Ar.`); }
    if (!s.sop.done.fill && s.sop.done.melt && xH2 > 0.6 && frac(N.rx, N2) > 0.15 && Prx > 95) { s.sop.done.fill = true; s.sop.fillT = s.t; event(s, "ok", "R-201 filled with N₂ + H₂."); }
    if (s.sop.done.fill && !s.sop.done.release && v.NV401 > 0) {
      s.sop.done.release = true;
      s.sop.holdMin = (s.t - s.sop.fillT) / 60;
      if (Prx * 1000 < PATM + 1500 && !(v.HV601 && v.pump)) event(s, "warn", "NV-401 opened with R-201 near or below atmospheric: risk of suck-back (permissive A29).");
      else event(s, "ok", `Release started after ${s.sop.holdMin.toFixed(0)} min hold.`);
    }
    if (s.sop.done.release && !s.sop.done.sweep && xH2 < 0.01 && frac(N.rx, AR) > 0.9) { s.sop.done.sweep = true; event(s, "ok", "Ar sweep complete: H₂ below 1 % in R-201."); }
  }

  /* ---------------- sensors, logging ---------------- */
  let seed = 12345;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

  function readings(s) {
    const N = s.N, fl = s.flows;
    const tot = sum(N.rx.n);
    const x = SP.map((_, i) => (tot > 0 ? N.rx.n[i] / tot : 0));
    return {
      t: s.t,
      PT201: press(N.hdr) / 1000 + 0.05 * gauss(),
      PT301: press(N.rx) / 1000 + 0.05 * gauss(),
      TE201: s.th.Tm - 273.15 + 0.2 * gauss(),
      TIC201: Math.round(s.th.Tf - 273.15),
      Pw: s.th.Pw,
      FIC101: Math.max(0, (s.flows.FIC101 || 0) + 0.2 * gauss() * (fl.FIC101 > 0 ? 1 : 0)),
      FIC102: Math.max(0, (s.flows.FIC102 || 0) + 0.2 * gauss() * (fl.FIC102 > 0 ? 1 : 0)),
      FI104: Math.round(s.flows.FI104 || 0),
      x, fL: s.fL,
      nh3ppm: x[NH3] * 1e6, o2ppm: x[O2] * 1e6,
      cap1: s.liq.a1.nh3 * 1e6, cap2: 0, slip: s.made.slip * 1e6,      // µmol
      made: s.made.nh3 * 1e6, n2up: s.made.n2up * 1e6,
      actMetal: s.cat.metal / s.melt.nAct * 100 || 0
    };
  }

  function logPoint(s) {
    if (s.t - s.lastLog >= 5) {
      s.lastLog = s.t;
      const r = readings(s);
      s.logs.push({ t: s.t, PT201: r.PT201, PT301: r.PT301, TE201: r.TE201, TIC201: r.TIC201, FIC101: r.FIC101, FIC102: r.FIC102, FI104: r.FI104,
        xH2: r.x[H2], xN2: r.x[N2], xAr: r.x[AR], xO2: r.x[O2], nh3ppm: r.nh3ppm, cap1: r.cap1, cap2: r.cap2, made: r.made });
      if (s.logs.length > 40000) s.logs.splice(0, s.logs.length - 40000);
    }
    if (s.t - s.lastManual >= 300) {
      s.lastManual = s.t;
      const r = readings(s);
      s.manual.push({ t: s.t, PT201: r.PT201, PT301: r.PT301, TE201: r.TE201, TIC: r.TIC201, FIC101: r.FIC101, FIC102: r.FIC102, FI104: r.FI104 });
    }
  }

  function advance(s, seconds) {
    const dt = 0.05;
    s.acc = (s.acc || 0) + seconds;
    while (s.acc >= dt) { step(s, dt); s.acc -= dt; }
  }

  /* ---------------- operator actions ---------------- */
  // change the catalyst charge (mass, g, and active metal at%) — active-metal pools are rescaled in proportion
  function setMelt(s, mass, actPct) {
    const old = s.melt.nAct;
    s.p.meltMass = mass; s.p.actPct = actPct;
    s.melt = meltProps(s.p);
    const f = old > 0 ? s.melt.nAct / old : 0;
    if (old > 0) { s.cat.metal *= f; s.cat.nitride *= f; s.cat.oxide *= f; s.cat.store *= f; }
    else { s.cat = { metal: s.melt.nAct, nitride: 0, oxide: 0, store: 0 }; }
    event(s, "info", `Catalyst charge set to ${mass} g, ${actPct} at% active metal (${(s.melt.nAct * 1000).toFixed(2)} mmol active metal, melt depth ${(s.melt.depth * 1000).toFixed(1)} mm).`);
  }

  function analyse(s) {
    // indophenol (salicylate) method on each acid trap: noise ~3 % rel, LOD 0.02 mg N/L
    const one = (B) => {
      const VL = Math.max(1e-6, B.acid / 1000);
      const true_mgNL = (B.nh3 * 14007) / VL;
      const meas = true_mgNL * (1 + 0.03 * gauss()) + 0.007 * gauss();
      return { V: B.acid, true: true_mgNL, meas, lod: 0.02, below: meas < 0.02, umol: (Math.max(0, meas) * VL / 14.007) * 1000 };
    };
    const a1 = one(s.liq.a1);
    const tot = a1.umol;
    const hold = s.sop.holdMin || 0;
    s.analysis = { t: s.t, a1, slip: s.made.slip * 1e6, totUmol: tot, holdMin: hold, nAct: s.melt.nAct,
      tofApparent: hold > 0 && s.melt.nAct > 0 ? (tot * 1e-6) / (s.melt.nAct * hold * 60) : null,
      tofLOD: hold > 0 && s.melt.nAct > 0 ? ((0.02 * (s.p.acidVol / 1000) / 14.007) * 1e-3) / (s.melt.nAct * hold * 60) : null };
    s.sop.done.analyse = true;
    event(s, "ok", `Indophenol: AB-507 ${a1.below ? "< LOD" : a1.meas.toFixed(3) + " mg N/L"}.`);
    return s.analysis;
  }

  function freshTraps(s) {
    const p = s.p, Ta = p.Tamb + 273.15;
    s.liq.ln = { acid: 0, oil: 0, nh3: 0, cap: 15 };
    s.liq.a1 = { acid: p.acidVol, oil: 0, nh3: 0, cap: 250, tip: 15, h2so4: p.acidVol / 1000 * p.acidMolar };
    s.N.ln = node(15e-6, Ta, PATM, AIR); s.N.a1 = node((250 - p.acidVol) * 1e-6, Ta, PATM, AIR);
    s.made.slip = 0; s.yLiquid = 0;
    s.suckback = false; delete s.alarms.suck; delete s.alarms.sbOver;
    s.analysis = null; s.sop.done.analyse = false;
    event(s, "info", "Fresh acid in AB-507.");
  }

  function openReactor(s) {
    const TmC = s.th.Tm - 273.15, xH2 = frac(s.N.rx, H2);
    if (TmC > 60) event(s, "alarm", `R-201 opened at ${TmC.toFixed(0)} °C: hot melt meets air (HAZOP 7.2). Cool under Ar first.`);
    if (xH2 > 0.04) event(s, "alarm", "R-201 opened with H₂ inside: flash-fire risk. Sweep with Ar first.");
    s.N.rx = node(s.p.Vreactor - s.melt.vol, s.N.rx.T, PATM, AIR);
    s.spg.S1 = { inTube: false, plugged: false }; s.spg.S2 = { inTube: false, plugged: false };
    s.sop = { leak: { state: "idle", t0: 0, P0: 0, rate: null }, cycles: 0, evacuated: false, done: {} };
    event(s, "info", "R-201 opened, spargers cleared, gasket replaced. Reactor is full of air again: leak-test and purge before use.");
  }

  /* scripted demonstration of the run sequence (also used as the self-test) */
  function demoScript(holdMin) {
    const P = (s) => press(s.N.rx) / 1000;
    const H = holdMin || 60;
    const A = [];
    const add = (note, when, act) => A.push({ note, when, act });
    const evac = (c) => {
      add(`Evacuate R-201 and feed lines (cycle ${c}): HV-111 + HV-202 open, HV-601 open, P-601 on, crack NV-401 to 8 %`,
        () => true, (s) => { s.sp.FI104 = 0; s.v.cylAr = false; s.v.HV111 = true; s.v.HV202 = true; s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 8; });
      add("Below 30 kPa: NV-401 to 20 %", (s) => P(s) < 30, (s) => { s.v.NV401 = 20; });
      add("Below 3 kPa: open NV-401 fully", (s) => P(s) < 3, (s) => { s.v.NV401 = 100; });
      if (c === 1) {
        add("Below 1 kPa: close NV-401 and HV-202, leak-up test for 5 min", (s) => P(s) < 1, (s) => { s.v.NV401 = 0; s.v.HV202 = false; s.v.HV111 = false; });
        add("Leak test done: refill with Ar through the feed lines (Ar 300 sccm, HV-111 + HV-202)", (s) => s.sop.leak.state === "pass" || s.sop.leak.state === "fail",
          (s) => { s.v.cylAr = true; s.sp.FI104 = 300; s.v.HV111 = true; s.v.HV202 = true; });
      } else {
        add("Below 1 kPa: close NV-401, refill with Ar 300 sccm", (s) => P(s) < 1, (s) => { s.v.NV401 = 0; s.v.cylAr = true; s.sp.FI104 = 300; });
      }
    };
    evac(1);
    add("Above 103 kPa: stop Ar", (s) => P(s) > 103, (s) => { s.sp.FI104 = 0; });
    evac(2);
    add("Above 103 kPa: stop Ar", (s) => P(s) > 103, (s) => { s.sp.FI104 = 0; });
    evac(3);
    add("Purged: close HV-601 then stop P-601; Ar 50 sccm through R-201 to the traps (NV-401 30 %); furnace on, SP 220 °C",
      (s) => P(s) > 103, (s) => { s.v.HV111 = false; s.v.HV601 = false; s.v.pump = false; s.sp.FI104 = 50; s.v.NV401 = 30; s.v.furnace = true; s.sp.furnaceSP = 220; });
    add("Melt liquid: stop Ar, close HV-202, evacuate the hot reactor (crack NV-401 to 8 %)",
      (s) => s.fL >= 1 && s.th.Tm - 273.15 > 185, (s) => { s.sp.FI104 = 0; s.v.cylAr = false; s.v.HV202 = false; s.v.HV601 = true; s.v.pump = true; s.v.NV401 = 8; });
    add("Below 30 kPa: NV-401 to 20 %", (s) => P(s) < 30, (s) => { s.v.NV401 = 20; });
    add("Below 3 kPa: open NV-401 fully", (s) => P(s) < 3, (s) => { s.v.NV401 = 100; });
    add("Below 1 kPa: close NV-401, close HV-601, stop P-601; feed N₂ 25 + H₂ 75 sccm through sparger S1 (HV-111, HV-201)",
      (s) => P(s) < 1, (s) => { s.v.NV401 = 0; s.v.HV601 = false; s.v.pump = false; s.v.cylN2 = true; s.v.cylH2 = true; s.v.XV101 = true; s.v.HV111 = true; s.sp.FIC101 = 75; s.sp.FIC102 = 25; s.v.HV201 = true; });
    add("PT-301 at 108 kPa: stop both MFCs, then close HV-201, HV-111, XV-101 and cylinders; hold starts",
      (s) => P(s) > 108, (s) => { s.sp.FIC101 = 0; s.sp.FIC102 = 0; s._hold = s.t; s._close = true; });
    add("Feed lines settled: close HV-201, HV-111, XV-101, cylinders", (s) => s.t - s._hold > 20,
      (s) => { s.v.HV201 = false; s.v.HV111 = false; s.v.XV101 = false; s.v.cylH2 = false; s.v.cylN2 = false; });
    add(`Hold ${H} min done: release to the traps, NV-401 at 10 %`, (s) => s.t - s._hold >= H * 60, (s) => { s.v.NV401 = 10; });
    add("Near atmospheric: pump down through the traps (HV-601 open, P-601 on)", (s) => P(s) < 103, (s) => { s.v.HV601 = true; s.v.pump = true; });
    add("Below 30 kPa: NV-401 to 20 %", (s) => P(s) < 30, (s) => { s.v.NV401 = 20; });
    add("Below 2 kPa: close NV-401, then HV-601, then stop P-601", (s) => P(s) < 2, (s) => { s.v.NV401 = 0; s.v.HV601 = false; s.v.pump = false; });
    add("Refill with Ar 300 sccm through the headspace (HV-202)", () => true, (s) => { s.v.cylAr = true; s.sp.FI104 = 300; s.v.HV202 = true; });
    add("Above 108 kPa: open NV-401 to 40 %, sweep Ar 150 sccm for 15 min", (s) => P(s) > 108, (s) => { s.v.NV401 = 40; s.sp.FI104 = 150; s._sw = s.t; });
    add("Sweep done: stop Ar, close HV-202 and NV-401, analyse the traps", (s) => s.t - s._sw > 900,
      (s) => { s.sp.FI104 = 0; s.v.cylAr = false; s.v.HV202 = false; s.v.NV401 = 0; analyse(s); });
    return A;
  }

  const api = { create, reset, step, advance, readings, analyse, freshTraps, openReactor, demoScript, setMelt, defaults, meltProps, press, frac, SP, SCCM, PATM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AmmoniaSim = api;
})(typeof window !== "undefined" ? window : globalThis);
