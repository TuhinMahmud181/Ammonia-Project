/* Ammonia kinetics rig — virtual lab page (drawing, controls, charts). Author: Tuhin Mahmud. */
(function () {
"use strict";
const S = window.AmmoniaSim;
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let s = S.create({});
let running = true, speed = 60, anim = 0;
const params = () => ({
  mode: $("sMode").value, logTOF: +$("iTOF").value, Ea: +$("iEa").value, storePct: +$("iStore").value,
  nitrideTau: +$("iTau").value, meltMass: +$("iMass").value, actPct: +$("iAct").value,
  fLeak: $("fLeak").checked, fCV505: $("fCV505").checked, fFIC101: $("fFIC101").checked, fPower: $("fPower").checked
});
const powerOK = () => !s.p.fPower && !s.v.esd;

/* ---------------- SVG helpers and layers ---------------- */
const svg = $("scene");
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  (parent || gFront).appendChild(e);
  return e;
}
function txt(x, y, str, cls, parent, anchor, style) {
  const t = el("text", { x, y, class: cls || "", "text-anchor": anchor || "middle" }, parent);
  if (style) t.setAttribute("style", style);
  t.textContent = str; return t;
}
const mk = (tag) => { const g = document.createElementNS(NS, tag); svg.appendChild(g); return g; };
const gBack = mk("g"), gWire = mk("g"), gPipe = mk("g"), gFront = mk("g"), gBub = mk("g");
gBub.setAttribute("pointer-events", "none"); gWire.setAttribute("pointer-events", "none");

const C = { H2: [91, 79, 196], N2: [47, 138, 87], Ar: [64, 78, 86], NH3: [176, 65, 143], O2: [217, 138, 28] };
function gasColour(x) {
  const w = [x[0], x[1] - (x[4] > 0.01 ? x[4] * 3.7 : 0), x[2], x[3] * 30, x[4] * 4.7].map((v) => Math.max(0, v));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  const cs = [C.H2, C.N2, C.Ar, C.NH3, C.O2];
  return `rgb(${[0, 1, 2].map((k) => Math.round(cs.reduce((a, c, i) => a + c[k] * w[i] / tot, 0))).join(",")})`;
}
const comp = (k) => [0, 1, 2, 3, 4].map((i) => S.frac(s.N[k], i));

/* ---------------- pipes: a tube with the gas moving inside it ---------------- */
const lines = [];
function pipe(d, nodeKey, flowFn) {
  el("path", { d, fill: "none", stroke: "#c9d2d4", "stroke-width": 9, "stroke-linejoin": "round", "stroke-linecap": "round" }, gPipe);
  el("path", { d, fill: "none", stroke: "#f7f9f9", "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round" }, gPipe);
  const gas = el("path", { d, fill: "none", "stroke-width": 4.2, "stroke-linejoin": "round", "stroke-linecap": "butt" }, gPipe);
  const L = { gas, nodeKey, flowFn, off: 0 };
  lines.push(L); return L;
}
// supplies (cylinder to MFC)
pipe("M62 128 V100 H270", "supH2");
pipe("M62 328 V300 H270", "supN2");
pipe("M62 498 V470 H270", "supAr");
// H2 line to sparger S2, and cross-over HV-111
pipe("M350 100 H460", "h2l", () => s.flows.FIC101);
pipe("M460 100 H835 V588", "h2l", () => s.flows.S2);
pipe("M460 100 V300", "h2l", () => s.flows.HV111);
// N2 and Ar into the header
pipe("M350 300 H460", "hdr", () => s.flows.FIC102);
pipe("M350 470 H460 V300", "hdr", () => s.flows.FI104);
// header to sparger S1 and to the headspace
pipe("M460 300 H620", "hdr", () => s.flows.S1 + s.flows.HV202);
pipe("M620 300 H765 V588", "hdr", () => s.flows.S1);
pipe("M620 300 V220 H690", "hdr", () => s.flows.HV202);
pipe("M690 220 H812 V385", "rx", () => s.flows.HV202);
// outlet
pipe("M856 378 V170 H1010", "rx", () => s.flows.NV401 + s.flows.psv);
pipe("M950 170 V128", "rx", () => s.flows.psv);
pipe("M950 102 V45 H1274", "psvout", () => s.flows.psv);
pipe("M1274 45 H1478", "vent", () => s.flows.psv + s.flows.vent);
pipe("M1010 170 H1170", "y", () => s.flows.CV505);
pipe("M1060 170 V262 H1093", "y", () => s.flows.pump);
pipe("M1137 262 H1170 V170", "ln", () => s.flows.pump);
pipe("M1170 170 H1248 V326", "ln", () => s.flows.CV505 + s.flows.pump);
pipe("M1274 200 V45", "trapout", () => s.flows.vent);
el("path", { d: "M1476 37 L1494 45 L1476 53 Z", fill: "var(--ink)" });
txt(1490, 28, "To outdoors, above head height", "small", null, "end");

/* ---------------- symbols ---------------- */
const tips = {};
const ctlTargets = {};            // id -> builder for the on-diagram control popover
function clickable(g, id) {
  g.setAttribute("class", (g.getAttribute("class") || "") + " click");
  g.setAttribute("tabindex", 0); g.setAttribute("role", "button");
  g.addEventListener("click", (e) => { e.stopPropagation(); openPop(id, g); });
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPop(id, g); } });
}
const cyl = {};
function cylinder(key, x, y, label, fill) {
  const g = el("g", { "aria-label": `${label} cylinder valve` });
  el("rect", { x: x - 22, y: y + 18, width: 44, height: 110, rx: 20, fill, stroke: "#5b6b71", "stroke-width": 1.5, class: "vb" }, g);
  el("rect", { x: x - 6, y: y + 6, width: 12, height: 14, fill: "#c9d1d3", stroke: "#5b6b71" }, g);
  const ind = el("circle", { cx: x, cy: y + 4, r: 6, stroke: "#5b6b71", "stroke-width": 1.5 }, g);
  txt(x, y + 78, label, "tag", g);
  const st = txt(x, y + 96, "shut", "small", g);
  clickable(g, key);
  cyl[key] = { ind, st };
}
cylinder("cylH2", 62, 110, "H₂", "#e3e0fb");
cylinder("cylN2", 62, 310, "N₂", "#ddf2e4");
cylinder("cylAr", 62, 480, "Ar", "#e9edee");

const valves = {};
function bowtie(x, y, vertical, g) {
  const h = 9, w = 11;
  const d = vertical ? `M${x - h} ${y - w} L${x + h} ${y - w} L${x - h} ${y + w} L${x + h} ${y + w} Z` : `M${x - w} ${y - h} L${x - w} ${y + h} L${x + w} ${y - h} L${x + w} ${y + h} Z`;
  return el("path", { d, stroke: "var(--ink)", "stroke-width": 1.6, "stroke-linejoin": "round", class: "vb" }, g);
}
function valve(id, key, x, y, opt) {
  opt = opt || {};
  const g = el("g", { "aria-label": id });
  el("rect", { x: x - 16, y: y - 16, width: 32, height: 32, fill: "transparent" }, g);
  const b = bowtie(x, y, opt.vertical, g);
  if (opt.solenoid) { el("line", { x1: x, y1: y, x2: x, y2: y - 20, stroke: "var(--ink)", "stroke-width": 1.4 }, g); el("rect", { x: x - 7, y: y - 33, width: 14, height: 13, fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.4 }, g); txt(x, y - 22.5, "S", "small", g, null, "font-size:10px;fill:var(--ink)"); }
  if (opt.needle) { el("line", { x1: x, y1: y, x2: x, y2: y - 18, stroke: "var(--ink)", "stroke-width": 1.6 }, g); el("line", { x1: x - 8, y1: y - 18, x2: x + 8, y2: y - 18, stroke: "var(--ink)", "stroke-width": 1.6 }, g); }
  if (opt.reg) { el("line", { x1: x, y1: y, x2: x, y2: y - 14, stroke: "var(--ink)", "stroke-width": 1.4 }, g); el("path", { d: `M${x - 9} ${y - 14} A9 9 0 0 1 ${x + 9} ${y - 14} Z`, fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.4 }, g); }
  const lx = opt.lx !== undefined ? opt.lx : x, ly = opt.ly !== undefined ? opt.ly : y + 30;
  txt(lx, ly, id, "tag mono", g, opt.anchor);
  if (!opt.locked) clickable(g, opt.ctl || id);
  valves[id] = { b, key, g };
  return g;
}
function check(x, y, label, ly) {
  const g = el("g", {});
  el("path", { d: `M${x - 9} ${y - 9} L${x - 9} ${y + 9} L${x + 7} ${y} Z`, fill: "var(--ink)" }, g);
  el("line", { x1: x + 8, y1: y - 9, x2: x + 8, y2: y + 9, stroke: "var(--ink)", "stroke-width": 2.4 }, g);
  txt(x, ly || y + 26, label, "tag mono", g);
}
function inst(tag, num, x, y, stemTo, tipFn, dashStemX) {
  const g = el("g", { "data-tip": tag + "-" + num });
  if (stemTo !== null && stemTo !== undefined) el("line", { x1: x, y1: y + 16, x2: x, y2: stemTo, stroke: "#5b6b71", "stroke-width": 1.2 }, g);
  if (dashStemX) el("line", { x1: x + 16, y1: y, x2: dashStemX, y2: y, stroke: "#5b6b71", "stroke-width": 1, "stroke-dasharray": "4 3" }, g);
  el("circle", { cx: x, cy: y, r: 16, fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.4 }, g);
  el("line", { x1: x - 16, y1: y, x2: x + 16, y2: y, stroke: "var(--ink)", "stroke-width": 0.8 }, g);
  txt(x, y - 3, tag, "mono", g, null, "font-size:10px;font-weight:700");
  txt(x, y + 11, num, "mono", g, null, "font-size:9px");
  tips[tag + "-" + num] = tipFn;
  return g;
}
function box(id, x, y, w, h) {
  const g = el("g", { "data-tip": id, "aria-label": id });
  el("rect", { x, y, width: w, height: h, fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.4, rx: 2, class: "vb" }, g);
  txt(x + w / 2, y + 13, id, "mono", g, null, "font-size:11px;font-weight:700");
  const v = txt(x + w / 2, y + 28, "", "mono", g, null, "font-size:10.5px;fill:var(--accent)");
  clickable(g, id);
  return { g, v };
}
const flowTag = (x, y, anchor) => txt(x, y, "", "mono", null, anchor || "middle", "font-size:10.5px;fill:var(--accent);font-weight:600");

/* gas panel */
valve("PCV-101", "cylH2", 130, 100, { reg: true, ctl: "cylH2" });
valve("PCV-102", "cylN2", 130, 300, { reg: true, ctl: "cylN2" });
valve("PCV-104", "cylAr", 130, 470, { reg: true, ctl: "cylAr" });
inst("PI", "101", 130, 55, null, () => s.v.cylH2 ? `${s.p.PregH2} kPa abs delivery` : "cylinder shut");
inst("PI", "102", 130, 255, null, () => s.v.cylN2 ? `${s.p.PregN2} kPa abs delivery` : "cylinder shut");
inst("PI", "104", 130, 425, null, () => s.v.cylAr ? `${s.p.PregAr} kPa abs delivery` : "cylinder shut");
[[71, 86], [271, 286], [441, 456]].forEach(([a, b]) => el("line", { x1: 130, y1: a, x2: 130, y2: b, stroke: "#5b6b71", "stroke-width": 1.2 }));
const fic101 = box("FIC-101", 270, 82, 80, 36);
const fic102 = box("FIC-102", 270, 282, 80, 36);
const fi104 = box("FI-104", 270, 452, 80, 36);
check(400, 100, "CV-101"); check(400, 300, "CV-102"); check(400, 470, "CV-104");
valve("HV-111", "HV111", 460, 200, { vertical: true, lx: 474, ly: 204, anchor: "start" });
valve("HV-205", "HV205", 560, 100);
el("circle", { cx: 460, cy: 100, r: 4, fill: "var(--ink)" });
el("circle", { cx: 460, cy: 300, r: 4, fill: "var(--ink)" });
txt(444, 290, "X-1", "small");
inst("PT", "201", 540, 255, 296, () => `${(S.press(s.N.hdr) / 1000).toFixed(1)} kPa abs, feed header → U6 AIN0`);
el("circle", { cx: 620, cy: 300, r: 4, fill: "var(--ink)" });
valve("HV-201", "HV201", 690, 300);
valve("HV-202", "HV202", 690, 220, { locked: true, lx: 690, ly: 250 });
txt(690, 263, "always closed", "small");
const fS1 = flowTag(745, 288, "end"), fS2 = flowTag(600, 88), fHS = flowTag(760, 212), fH2x = flowTag(410, 72), fN2x = flowTag(410, 272), fArx = flowTag(410, 442);

/* furnace and reactor (back layer, so the dip tubes show in front) */
const furn = el("g", { "aria-label": "Furnace H-201" }, gBack);
const furnBody = el("rect", { x: 695, y: 425, width: 210, height: 225, rx: 6, fill: "#fdf1e6", stroke: "#b8692e", "stroke-width": 1.6, class: "vb" }, furn);
const glow = el("rect", { x: 702, y: 432, width: 196, height: 211, rx: 4, fill: "#ff7a2f", opacity: 0, "pointer-events": "none" }, furn);
for (let i = 0; i < 7; i++) {
  const yy = 450 + i * 27;
  el("path", { d: `M708 ${yy - 6} L716 ${yy} L708 ${yy + 6}`, fill: "none", stroke: "#d0503a", "stroke-width": 1.3 }, furn);
  el("path", { d: `M892 ${yy - 6} L884 ${yy} L892 ${yy + 6}`, fill: "none", stroke: "#d0503a", "stroke-width": 1.3 }, furn);
}
txt(800, 668, "H-201 furnace", "tag", furn);
clickable(furn, "furnace");
const vesselG = el("g", { "aria-label": "R-201: set the catalyst" }, gBack);
el("rect", { x: 730, y: 360, width: 140, height: 255, rx: 6, fill: "#f4f6f7", stroke: "var(--ink)", "stroke-width": 2, class: "vb" }, vesselG);
clickable(vesselG, "melt");
const headspace = el("rect", { x: 733, y: 363, width: 134, height: 249, rx: 4, fill: "#fff", opacity: 0.3, "pointer-events": "none" }, vesselG);
el("rect", { x: 715, y: 345, width: 170, height: 15, fill: "#c9d1d3", stroke: "var(--ink)", "stroke-width": 1.4 }, vesselG);
const meltG = el("g", { "aria-label": "Catalyst melt" }, gBack);
const melt = el("rect", { x: 753, y: 566, width: 94, height: 35, fill: "#8a8f93" }, meltG);
const meltSurf = el("line", { x1: 753, y1: 566, x2: 847, y2: 566, stroke: "#c9d1d3", "stroke-width": 2 }, meltG);
el("path", { d: "M750 475 V598 Q750 604 756 604 H844 Q850 604 850 598 V475", fill: "none", stroke: "#8a5a2b", "stroke-width": 4 }, meltG);
el("rect", { x: 750, y: 470, width: 100, height: 140, fill: "transparent" }, meltG);
clickable(meltG, "melt");
const meltLab = txt(800, 628, "", "small", null, "middle", "font-size:10.5px");
txt(892, 340, "R-201 reactor", "tag", null, "start");
txt(752, 470, "S1", "mono", null, "middle", "font-size:11px;font-weight:700;fill:var(--h2)");
txt(850, 470, "S2", "mono", null, "middle", "font-size:11px;font-weight:700;fill:var(--h2)");
el("line", { x1: 788, y1: 281, x2: 788, y2: 590, stroke: "#8a5a2b", "stroke-width": 2.5 });
el("circle", { cx: 788, cy: 590, r: 3, fill: "var(--hot)" });
inst("TE", "201", 788, 265, null, () => `${(s.th.Tm - 273.15).toFixed(1)} °C in the melt · ${meltState()} → U6 AIN2/AIN3`);
inst("TIC", "201", 640, 560, null, () => `Furnace PV ${(s.th.Tf - 273.15).toFixed(0)} °C, SP ${s.sp.furnaceSP} °C · heater ${(s.th.Pw / 1000).toFixed(2)} kW · ${s.v.furnace ? "ON" : "OFF"} (stand-alone controller)`, 695);
const plugMark = { S1: txt(765, 642, "", "small", null, "middle", "font-size:10px;fill:var(--hot);font-weight:700"), S2: txt(835, 642, "", "small", null, "middle", "font-size:10px;fill:var(--hot);font-weight:700") };

/* outlet side */
const psvG = el("g", {});
el("path", { d: "M941 103 L959 103 L941 127 L959 127 Z", fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.6 }, psvG);
el("path", { d: "M959 115 l6 -5 l4 10 l4 -10 l4 10", fill: "none", stroke: "var(--ink)", "stroke-width": 1.3 }, psvG);
const psvLamp = el("circle", { cx: 933, cy: 115, r: 4, fill: "#e3e9e8" }, psvG);
txt(924, 119, "PSV-301", "tag mono", psvG, "end");
el("circle", { cx: 950, cy: 170, r: 4, fill: "var(--ink)" });
txt(934, 160, "X-2", "small");
inst("PT", "301", 950, 215, null, () => `${(S.press(s.N.rx) / 1000).toFixed(2)} kPa abs in R-201 → U6 AIN1 · PSV set ${s.p.psvSet} kPa`);
el("line", { x1: 950, y1: 174, x2: 950, y2: 199, stroke: "#5b6b71", "stroke-width": 1.2 });
valve("NV-401", "NV401", 1010, 170, { needle: true, ly: 202 });
const fNV = flowTag(1010, 132);
el("circle", { cx: 1060, cy: 170, r: 4, fill: "var(--ink)" });
check(1115, 170, "CV-505", 152);
valve("HV-601", "HV601", 1060, 215, { vertical: true, lx: 1074, ly: 219, anchor: "start" });
const pumpG = el("g", { "aria-label": "Vacuum pump P-601" });
el("circle", { cx: 1115, cy: 262, r: 22, fill: "#fff", stroke: "var(--ink)", "stroke-width": 1.6, class: "vb" }, pumpG);
const rotor = el("path", { d: "M1103 250 L1131 262 L1103 274 Z", fill: "var(--ink)" }, pumpG);
txt(1115, 302, "P-601", "tag mono", pumpG);
txt(1115, 315, "vacuum pump", "small", pumpG);
clickable(pumpG, "pump");
el("circle", { cx: 1170, cy: 170, r: 4, fill: "var(--ink)" });

/* the one acid trap */
const trapG = el("g", { "data-tip": "AB-507" }, gBack);
el("rect", { x: 1225, y: 190, width: 70, height: 150, rx: 7, fill: "#fbfdfd", stroke: "var(--ink)", "stroke-width": 1.6 }, trapG);
const trapLiq = el("rect", { x: 1227, y: 338, width: 66, height: 0, fill: "#cfe0fa" }, trapG);
el("rect", { x: 1235, y: 182, width: 50, height: 10, rx: 2, fill: "#c9d1d3", stroke: "var(--ink)", "stroke-width": 1.2 }, trapG);
const trapBub = el("g", {});
txt(1260, 360, "AB-507", "tag mono");
txt(1260, 375, "dilute H₂SO₄, 100 mL", "small");
txt(1260, 389, "NH₃ capture", "small");
const fTrap = flowTag(1305, 280, "start");
tips["AB-507"] = () => `${s.liq.a1.acid.toFixed(0)} mL acid · NH₃ held ${(s.liq.a1.nh3 * 1e6).toFixed(2)} µmol · gas in ${Math.max(0, s.flows.b1 || 0).toFixed(0)} sccm · slipped to vent ${(s.made.slip * 1e6).toFixed(3)} µmol`;
tips["FIC-101"] = () => `H₂ ${s.flows.FIC101.toFixed(1)} sccm · SP ${s.sp.FIC101} sccm (U6 DAC0 ${(s.sp.FIC101 / 20).toFixed(2)} V)${s.p.fFIC101 ? " · FAILED OPEN" : ""}`;
tips["FIC-102"] = () => `N₂ ${s.flows.FIC102.toFixed(1)} sccm · SP ${s.sp.FIC102} sccm (U6 DAC1 ${(s.sp.FIC102 / 20).toFixed(2)} V)`;
tips["FI-104"] = () => `Ar rotameter ${s.flows.FI104.toFixed(0)} sccm · set ${s.sp.FI104} sccm (manual, not logged)`;

/* ESD */
const esdG = el("g", { "aria-label": "Emergency shutdown HS-902" });
el("circle", { cx: 1010, cy: 560, r: 18, fill: "#fff", stroke: "var(--hot)", "stroke-width": 2, class: "vb" }, esdG);
const esdLamp = el("circle", { cx: 1010, cy: 560, r: 9, fill: "#f3c7bd" }, esdG);
txt(1036, 556, "HS-902", "tag mono", esdG, "start");
txt(1036, 570, "ESD: cuts the supply", "small", esdG, "start");
clickable(esdG, "esd");

/* ---------------- LabJack U6, wiring and PC ---------------- */
const U = { x: 925, y: 790, w: 350, h: 120 };
el("rect", { x: U.x, y: U.y, width: U.w, height: U.h, rx: 8, fill: "#2b3a42", stroke: "#18262c", "stroke-width": 1.5 });
el("rect", { x: U.x + 8, y: U.y - 10, width: U.w - 16, height: 14, rx: 3, fill: "#3f8f4f", stroke: "#18262c" });
txt(U.x + 16, U.y + 102, "LabJack U6", "tag", null, "start", "fill:#fff;font-size:14px");
txt(U.x + 112, U.y + 102, "16-bit DAQ · USB", "small", null, "start", "fill:#b9c6cb");
const TERM = [
  ["AIN0", "PT-201", "ain"], ["AIN1", "PT-301", "ain"], ["AIN2/3", "TE-201", "ain"], ["AIN4", "FIC-101 PV", "ain"], ["AIN5", "FIC-102 PV", "ain"],
  ["DAC0", "FIC-101 SP", "dac"], ["DAC1", "FIC-102 SP", "dac"], ["FIO0", "P-601", "dio"]
];
const WCOL = { ain: "#0d6f8f", dac: "#2f8a57", dio: "#c06f12" };
const termX = (i) => U.x + 24 + i * 34;
const termVal = {};
TERM.forEach(([t], i) => {
  const x = termX(i);
  el("rect", { x: x - 8, y: U.y - 14, width: 16, height: 12, rx: 2, fill: "#d8dee0", stroke: "#18262c" });
  el("circle", { cx: x, cy: U.y - 8, r: 3, fill: "#8a969b" });
  txt(x, U.y + 18, t, "mono", null, "middle", "font-size:9.5px;fill:#e6eef0;font-weight:600");
  termVal[t] = txt(x, U.y + 34, "", "mono", null, "middle", "font-size:9px;fill:#b8f07a");
});
txt(U.x + U.w - 12, U.y + 18, "GND", "mono", null, "end", "font-size:9.5px;fill:#e6eef0");
const wires = [];
function wire(d, kind, label, lx, ly, anchor) {
  const w = el("path", { d, fill: "none", stroke: WCOL[kind], "stroke-width": 1.4, "stroke-dasharray": "5 4", opacity: 0.9 }, gWire);
  wires.push({ w, kind });
  if (label) txt(lx, ly, label, "mono", gWire, anchor || "start", `font-size:9.5px;fill:${WCOL[kind]};font-weight:600`);
}
const T = (i) => termX(i);
const ty = U.y - 14;
wire(`M556 255 H578 V700 H${T(0)} V${ty}`, "ain", "AIN0", 582, 330);
wire(`M950 231 V756 H${T(1)} V${ty}`, "ain", "AIN1", 954, 250);
wire(`M772 265 H665 V708 H${T(2)} V${ty}`, "ain", "AIN2/3 type K", 660, 420, "end");
wire(`M350 110 H362 V716 H${T(3)} V${ty}`, "ain", "AIN4", 366, 140);
wire(`M350 116 H368 V724 H${T(5)} V${ty}`, "dac", "DAC0", 372, 160);
wire(`M350 310 H376 V732 H${T(4)} V${ty}`, "ain", "AIN5", 380, 340);
wire(`M350 314 H382 V740 H${T(6)} V${ty}`, "dac", "DAC1", 386, 360);
wire(`M1115 322 V764 H${T(7)} V${ty}`, "dio", "FIO0 → relay", 1119, 340);
wire(`M1010 578 V640 H1180 V680`, "dio", "", 0, 0);
txt(1184, 690, "relay supply", "small", gWire, "middle");
// PC
const pcX = 1330, pcY = 700;
el("rect", { x: pcX, y: pcY, width: 160, height: 140, rx: 6, fill: "#2b3a42", stroke: "#18262c", "stroke-width": 1.5 });
el("rect", { x: pcX + 6, y: pcY + 6, width: 148, height: 118, rx: 2, fill: "#0f1d24" });
el("rect", { x: pcX + 70, y: pcY + 140, width: 20, height: 22, fill: "#5b6b71" });
el("rect", { x: pcX + 45, y: pcY + 160, width: 70, height: 6, rx: 3, fill: "#5b6b71" });
txt(pcX + 80, pcY + 186, "PC · logging software", "small");
el("path", { d: `M${U.x + U.w} ${U.y + 70} H1316 V${pcY + 120} H${pcX}`, fill: "none", stroke: "#18262c", "stroke-width": 2.5 }, gWire);
txt(U.x + U.w + 6, U.y + 62, "USB", "mono", gWire, "start", "font-size:9.5px;font-weight:700");
const scr = { title: txt(pcX + 12, pcY + 19, "U6 live · ammonia rig", "mono", null, "start", "font-size:8.5px;fill:#7fbf55"), rows: [] };
for (let i = 0; i < 6; i++) scr.rows.push(txt(pcX + 12, pcY + 32 + i * 10.5, "", "mono", null, "start", "font-size:8.5px;fill:#b8f07a"));
const trendP = el("path", { d: "", fill: "none", stroke: "#4fc3e8", "stroke-width": 1.2 });
const trendT = el("path", { d: "", fill: "none", stroke: "#ff8a65", "stroke-width": 1.2 });
txt(pcX + 150, pcY + 120, "PT-301 · TE-201, last 60 min", "mono", null, "end", "font-size:7px;fill:#7a8f97");

/* ---------------- phase banner on the drawing ---------------- */
const PH_COL = { ar: "#56646b", evac: "#0d6f8f", react: "#5b4fc4", rel: "#c06f12" };
const banner = el("g", { "pointer-events": "none" });
const bRect = el("rect", { x: 560, y: 8, width: 330, height: 54, rx: 9, fill: "#fff", stroke: "#d4dcdb", "stroke-width": 1.4 }, banner);
const bChip = el("rect", { x: 568, y: 16, width: 8, height: 38, rx: 3, fill: "#c4cdcf" }, banner);
const bTitle = txt(586, 33, "No run", "tag", banner, "start", "font-size:16px;font-weight:700");
const bSub = txt(586, 51, "Set the phase times and press Start run", "small", banner, "start", "font-size:11.5px");
const bLeft = txt(880, 33, "", "mono", banner, "end", "font-size:16px;font-weight:700");
const bNext = txt(880, 51, "", "small", banner, "end", "font-size:11px");

/* ---------------- tooltips ---------------- */
const tip = $("tip");
svg.addEventListener("mousemove", (e) => {
  const g = e.target.closest("[data-tip]");
  if (!g || !tips[g.dataset.tip] || !$("pop").hidden) { tip.style.opacity = 0; return; }
  const pr = svg.closest(".scene").getBoundingClientRect();
  tip.innerHTML = `<b>${g.dataset.tip}</b><br><span class="v">${tips[g.dataset.tip]()}</span>`;
  let x = e.clientX - pr.left + 14, y = e.clientY - pr.top + 14;
  if (x > pr.width - 290) x -= 300;
  tip.style.left = x + "px"; tip.style.top = y + "px"; tip.style.opacity = 1;
});
svg.addEventListener("mouseleave", () => { tip.style.opacity = 0; });

/* ---------------- on-diagram control popover ---------------- */
const pop = $("pop");
const ONOFF = {
  cylH2: ["H₂ cylinder", "cylH2", "Cylinder valve; regulator PCV-101 then delivers H₂ at about 1 barg."],
  cylN2: ["N₂ cylinder", "cylN2", "Cylinder valve; regulator PCV-102."],
  cylAr: ["Ar cylinder", "cylAr", "Cylinder valve; regulator PCV-104."],
  "HV-111": ["HV-111", "HV111", "H₂ line to the N₂/Ar header (send H₂ through S1, or purge the H₂ line)."],
  "HV-205": ["HV-205", "HV205", "H₂ line to sparger S2, straight into the melt."],
  "HV-201": ["HV-201", "HV201", "Header to sparger S1, into the melt."],
  "HV-601": ["HV-601", "HV601", "Isolates the vacuum pump. Close it before you stop P-601."],
  pump: ["P-601 vacuum pump", "pump", "Switched by U6 FIO0 through a relay. Exhausts through AB-507."],
  esd: ["HS-902 ESD", "esd", "Cuts the supply: P-601, the MFCs and the furnace stop."]
};
let popId = null;
function openPop(id, g) {
  popId = id; tip.style.opacity = 0;
  pop.innerHTML = popHTML(id);
  pop.hidden = false;
  const pr = svg.closest(".scene").getBoundingClientRect(), r = g.getBoundingClientRect();
  let x = r.right - pr.left + 8, y = r.top - pr.top - 10;
  if (x + 260 > pr.width) x = r.left - pr.left - 258;
  if (x < 4) x = 4;
  y = Math.max(4, Math.min(y, pr.height - pop.offsetHeight - 50));
  pop.style.left = x + "px"; pop.style.top = y + "px";
  wirePop(id);
  const first = pop.querySelector("input,button:not(.x)"); if (first) first.focus({ preventScroll: true });
}
function closePop() { pop.hidden = true; popId = null; }
document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) closePop(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) closePop(); });
const head = (t) => `<h3><span>${t}</span><button class="x" type="button" aria-label="Close" data-close>×</button></h3>`;
const rng = (id, lab, min, max, step, val, unit) => `<label>${lab} <span class="num"><input type="number" id="po_${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${lab}, ${unit}"> ${unit}</span><input type="range" id="pi_${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${lab}"></label>`;
function popHTML(id) {
  if (ONOFF[id]) {
    const [t, k, d] = ONOFF[id], on = !!s.v[k];
    const words = id === "pump" ? ["Start", "Stop"] : id === "esd" ? ["Press", "Reset"] : ["Open", "Close"];
    return head(t) + `<div class="st">${d}</div><div class="row2"><button type="button" data-set="1" class="${on ? "on" : ""}">${words[0]}</button><button type="button" data-set="0" class="${on ? "" : "on"}">${words[1]}</button></div><div class="live" id="poLive"></div>`;
  }
  if (id === "NV-401") return head("NV-401 needle valve") + `<div class="st">Outlet to the pump and the acid trap. Open it slowly.</div>` + rng("nv", "Opening", 0, 100, 1, s.v.NV401, "%") + `<div class="live" id="poLive"></div>`;
  if (id === "FIC-101") return head("FIC-101 · H₂ MFC") + `<div class="st">Set point written by U6 DAC0 (0–5 V = 0–100 sccm); flow read back on AIN4.</div>` + rng("sp", "Set point", 0, 100, 1, s.sp.FIC101, "sccm") + `<div class="live" id="poLive"></div>`;
  if (id === "FIC-102") return head("FIC-102 · N₂ MFC") + `<div class="st">Set point from U6 DAC1; flow read back on AIN5.</div>` + rng("sp", "Set point", 0, 100, 1, s.sp.FIC102, "sccm") + `<div class="live" id="poLive"></div>`;
  if (id === "FI-104") return head("FI-104 · Ar rotameter") + `<div class="st">Manual needle on the rotameter. Not logged.</div>` + rng("sp", "Flow", 0, 500, 5, s.sp.FI104, "sccm") + `<div class="live" id="poLive"></div>`;
  if (id === "furnace") return head("H-201 furnace") + `<div class="st">Stand-alone furnace controller TIC-201. TE-201 in the melt reads lower than the furnace.</div><div class="row2"><button type="button" data-set="1" class="${s.v.furnace ? "on" : ""}">On</button><button type="button" data-set="0" class="${s.v.furnace ? "" : "on"}">Off</button></div>` + rng("sp", "Set point", 25, 600, 5, s.sp.furnaceSP, "°C") + `<div class="live" id="poLive"></div>`;
  if (id === "melt") return head("Catalyst in R-201") + `<div class="st">Liquid-metal catalyst in the MgO crucible.</div>` + rng("mass", "Catalyst charge", 5, 150, 1, s.p.meltMass, "g") + rng("act", "Active material", 0, 20, 0.5, s.p.actPct, "%") + `<div class="live" id="poLive"></div>`;
  return head(id);
}
function wirePop(id) {
  pop.querySelector("[data-close]").addEventListener("click", closePop);
  pop.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
    const k = ONOFF[id] ? ONOFF[id][1] : "furnace";
    s.v[k] = b.dataset.set === "1";
    pop.querySelectorAll("[data-set]").forEach((x) => x.classList.toggle("on", x === b));
    refreshToggles();
  }));
  // slider and typed value stay in step; fn gets the value, done() runs once the value is settled
  const bind = (rid, fn, unit, dec, done) => {
    const r = $("pi_" + rid), n = $("po_" + rid); if (!r) return;
    r.addEventListener("input", () => { n.value = (+r.value).toFixed(dec || 0); fn(+r.value); syncSliders(); });
    r.addEventListener("change", () => { if (done) done(); });
    n.addEventListener("change", () => {
      let v = +n.value; if (!isFinite(v)) v = +r.value;
      v = Math.min(+n.max, Math.max(+n.min, v)); n.value = v; r.value = v; fn(v); syncSliders(); if (done) done();
    });
  };
  if (id === "NV-401") bind("nv", (v) => { s.v.NV401 = v; }, "%");
  if (id === "FIC-101") bind("sp", (v) => { s.sp.FIC101 = v; }, "sccm");
  if (id === "FIC-102") bind("sp", (v) => { s.sp.FIC102 = v; }, "sccm");
  if (id === "FI-104") bind("sp", (v) => { s.sp.FI104 = v; }, "sccm");
  if (id === "furnace") bind("sp", (v) => { s.sp.furnaceSP = v; }, "°C");
  if (id === "melt") {
    const apply = () => { $("iMass").value = +$("pi_mass").value; $("iAct").value = +$("pi_act").value; setCatalyst(); livePop(); };
    bind("mass", () => {}, "g", 0, apply);
    bind("act", () => {}, "%", 1, apply);
  }
  livePop();
}
function livePop() {
  if (pop.hidden || !popId) return;
  const L = $("poLive"); if (!L) return;
  const id = popId, f = s.flows;
  let t = "";
  if (id === "NV-401") t = `${f.NV401.toFixed(1)} sccm through · PT-301 ${(S.press(s.N.rx) / 1000).toFixed(1)} kPa`;
  else if (id === "FIC-101") t = `PV ${f.FIC101.toFixed(1)} sccm · DAC0 ${(s.sp.FIC101 / 20).toFixed(2)} V · AIN4 ${(f.FIC101 / 20).toFixed(3)} V`;
  else if (id === "FIC-102") t = `PV ${f.FIC102.toFixed(1)} sccm · DAC1 ${(s.sp.FIC102 / 20).toFixed(2)} V · AIN5 ${(f.FIC102 / 20).toFixed(3)} V`;
  else if (id === "FI-104") t = `${f.FI104.toFixed(0)} sccm Ar into the header`;
  else if (id === "furnace") t = `PV ${(s.th.Tf - 273.15).toFixed(0)} °C · heater ${(s.th.Pw / 1000).toFixed(2)} kW · melt ${(s.th.Tm - 273.15).toFixed(0)} °C`;
  else if (id === "melt") t = `active material ${(s.p.meltMass * s.p.actPct / 100).toFixed(2)} g of ${s.p.meltMass} g · depth ${(s.melt.depth * 1000).toFixed(1)} mm · ${meltState()}`;
  else if (id === "pump") t = `${f.pump.toFixed(0)} sccm · suction ${(S.press(s.N.y) / 1000).toFixed(1)} kPa`;
  else if (id === "HV-201") t = `S1 ${f.S1.toFixed(1)} sccm · PT-201 ${(S.press(s.N.hdr) / 1000).toFixed(1)} kPa`;
  else if (id === "HV-205") t = `S2 ${f.S2.toFixed(1)} sccm`;
  else if (id === "HV-111") t = `${f.HV111.toFixed(1)} sccm`;
  else if (id.startsWith("cyl")) t = s.v[id] ? "open" : "shut";
  else if (id === "esd") t = s.v.esd ? "PRESSED" : "armed";
  L.textContent = t;
}

/* ---------------- side-panel toggles and sliders ---------------- */
const TOG = [["cylH2", "H₂ cyl"], ["cylN2", "N₂ cyl"], ["cylAr", "Ar cyl"], ["HV111", "HV-111"], ["HV205", "HV-205"],
  ["HV201", "HV-201"], ["HV601", "HV-601"], ["pump", "P-601"], ["furnace", "Furnace"], ["esd", "ESD"]];
TOG.forEach(([k, lab]) => {
  const b = document.createElement("button"); b.type = "button"; b.textContent = lab; b.id = "t_" + k;
  if (k === "esd") b.className = "danger";
  b.addEventListener("click", () => { s.v[k] = !s.v[k]; refreshToggles(); });
  $("toggles").appendChild(b);
});
function refreshToggles() {
  TOG.forEach(([k]) => $("t_" + k).setAttribute("aria-pressed", s.v[k] ? "true" : "false"));
  $("t_esd").textContent = s.v.esd ? "Reset ESD" : "ESD";
}
const SL = [
  ["iFIC101", "oFIC101", (v) => { s.sp.FIC101 = v; return v + " sccm"; }],
  ["iFIC102", "oFIC102", (v) => { s.sp.FIC102 = v; return v + " sccm"; }],
  ["iFI104", "oFI104", (v) => { s.sp.FI104 = v; return v + " sccm"; }],
  ["iNV", "oNV", (v) => { s.v.NV401 = v; return v + " %"; }],
  ["iTsp", "oTsp", (v) => { s.sp.furnaceSP = v; return v + " °C"; }],
  ["iTOF", "oTOF", (v) => { s.p.logTOF = v; return `10^${v} s⁻¹`; }],
  ["iEa", "oEa", (v) => { s.p.Ea = v; return v + " kJ/mol"; }],
  ["iStore", "oStore", (v) => { s.p.storePct = v; return v.toFixed(1) + " %"; }],
  ["iTau", "oTau", (v) => { s.p.nitrideTau = v; return v + " min"; }],
  ["iMass", "oMass", (v) => v + " g"],
  ["iAct", "oAct", (v) => v.toFixed(1) + " %"]
];
SL.forEach(([i, o, f]) => { $(i).addEventListener("input", () => { $(o).textContent = f(+$(i).value); }); });
SL.slice(5).forEach(([i, o, f]) => { $(o).textContent = f(+$(i).value); });
function setCatalyst() {
  S.setMelt(s, +$("iMass").value, +$("iAct").value);
  $("oMass").textContent = $("iMass").value + " g"; $("oAct").textContent = (+$("iAct").value).toFixed(1) + " %";
  meltNote();
}
function meltNote() { $("oMelt").textContent = `Active material ${(s.p.meltMass * s.p.actPct / 100).toFixed(2)} g of ${s.p.meltMass} g; melt about ${(s.melt.depth * 1000).toFixed(1)} mm deep. You can also click the reactor in the drawing.`; }
$("iMass").addEventListener("change", setCatalyst);
$("iAct").addEventListener("change", setCatalyst);
function syncSliders() {
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set("iFIC101", s.sp.FIC101); set("iFIC102", s.sp.FIC102); set("iFI104", s.sp.FI104); set("iNV", s.v.NV401); set("iTsp", s.sp.furnaceSP);
  $("oFIC101").textContent = s.sp.FIC101 + " sccm"; $("oFIC102").textContent = s.sp.FIC102 + " sccm"; $("oFI104").textContent = s.sp.FI104 + " sccm";
  $("oNV").textContent = s.v.NV401 + " %"; $("oTsp").textContent = s.sp.furnaceSP + " °C";
}
const MODE_NOTE = {
  nitride: "A metal nitride forms from N₂ and is too stable for H₂ to reduce: PT-301 falls as N₂ is taken up, but the acid stays blank.",
  tof: "Melt makes NH₃ catalytically at the TOF you set (per active-metal atom, at 200 °C), with Arrhenius scaling and the NH₃ equilibrium limit. Sparging gives full gas contact; a static hold only the melt surface.",
  release: "Hypothesis from the reported observation: reactive N–H species build up under N₂ + H₂ and leave as NH₃ when the pressure is reduced (release step / pump-down)."
};
function modeUI() {
  const m = $("sMode").value; s.p.mode = m; $("modeNote").textContent = MODE_NOTE[m];
  document.querySelectorAll("[data-mode]").forEach((l) => { l.hidden = l.dataset.mode !== m; });
}
$("sMode").addEventListener("change", modeUI);
["fLeak", "fCV505", "fFIC101", "fPower"].forEach((k) => $(k).addEventListener("change", () => { s.p[k] = $(k).checked; }));

/* ---------------- buttons ---------------- */
function say(t, warn) { $("msg").textContent = t; $("msg").style.color = warn ? "var(--hot)" : "var(--ok)"; setTimeout(() => { if ($("msg").textContent === t) $("msg").textContent = ""; }, 4000); }
const RES0 = "Run the hold and the sweep first, then analyse. Detection limit 0.02 mg N/L.";
function restart() { s = S.create(params()); closePop(); $("bStop").disabled = true; $("res").textContent = RES0; refreshToggles(); syncSliders(); meltNote(); drawCharts(); updatePanel(); }
$("bPlay").addEventListener("click", () => { running = !running; $("bPlay").textContent = running ? "Pause" : "Resume"; });
$("bReset").addEventListener("click", restart);
$("sSpeed").addEventListener("change", () => { speed = +$("sSpeed").value; if (pacing()) $("pPace").checked = false; });

/* ---------------- run program ---------------- */
const PH_INFO = {
  ar: "Ar bubbles through S1 and S2 and leaves through NV-401 and AB-507.",
  evac: "Cylinders shut; P-601 pulls R-201 down through NV-401 (opened in stages).",
  react: "NV-401 shut; H₂ bubbles through S2 and N₂ through S1 up to the fill pressure, then the melt is held under it.",
  rel: "All inlets shut; NV-401 opens slowly and the gas leaves through AB-507."
};
const pdef = S.programDefaults();
$("phaseIn").innerHTML = S.PHASES.map((ph, k) => `<label class="phase" for="pt_${ph.key}"><i style="background:${PH_COL[ph.key]}">${k + 1}</i><span><b>${ph.name}</b></span><span class="num"><input type="number" id="pt_${ph.key}" min="1" max="240" step="1" value="${pdef.min[ph.key]}"> min</span></label>`).join("");
const progCfg = () => {
  const n = (id, lo, hi) => { const e = $(id); let v = Math.round(+e.value); if (!isFinite(v)) v = lo; v = Math.min(hi, Math.max(lo, v)); e.value = v; return v; };
  return { min: { ar: n("pt_ar", 1, 240), evac: n("pt_evac", 1, 240), react: n("pt_react", 1, 240), rel: n("pt_rel", 1, 240) },
    cycles: n("pCycles", 1, 10), fillKPa: n("pFill", 102, 145), arSccm: n("pAr", 10, 500), h2Sccm: n("pH2", 1, 100), n2Sccm: n("pN2", 1, 100), finalSweep: $("pSweep").checked };
};
const mm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.floor(sec % 60); return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const hmin = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);
function showTotal() {
  const c = progCfg(), per = c.min.ar + c.min.evac + c.min.react + c.min.rel, tot = per * c.cycles + (c.finalSweep ? c.min.ar : 0);
  $("pTotal").innerHTML = `One cycle ${hmin(per)} · total run <b>${hmin(tot)}</b>${c.finalSweep ? ` (incl. final Ar purge ${c.min.ar} min)` : ""}`;
  if (!s.prog || s.prog.done) drawBar(null, c);
}
document.querySelectorAll("#progCard input").forEach((e) => e.addEventListener("change", showTotal));
function drawBar(st, c) {
  const plan = st ? st.plan : (() => { const p = []; for (let k = 1; k <= c.cycles; k++) S.PHASES.forEach((ph) => p.push({ key: ph.key, min: c.min[ph.key] })); if (c.finalSweep) p.push({ key: "ar", min: c.min.ar }); return p; })();
  const tot = plan.reduce((x, p) => x + p.min, 0);
  $("pBar").innerHTML = plan.map((p, k) => `<span class="${st ? (k < st.idx || st.done ? "done" : k === st.idx ? "now" : "") : ""}" style="width:${(100 * p.min / tot).toFixed(2)}%;background-color:${PH_COL[p.key]}"></span>`).join("");
}
$("bStart").addEventListener("click", () => {
  const c = progCfg();
  restart();
  S.startProgram(s, c);
  $("bStop").disabled = false; running = true; $("bPlay").textContent = "Pause";
  if (speed < 60) { speed = 60; $("sSpeed").value = "60"; }
});
$("bStop").addEventListener("click", () => { S.stopProgram(s); $("bStop").disabled = true; running = false; $("bPlay").textContent = "Resume"; speed = +$("sSpeed").value; });
function updateProgram() {
  const st = S.programStatus(s);
  if (!st) { bTitle.textContent = "No run"; bSub.textContent = "Set the phase times and press Start run"; bLeft.textContent = ""; bNext.textContent = ""; bChip.setAttribute("fill", "#c4cdcf"); return; }
  drawBar(st);
  if (st.done) {
    bTitle.textContent = st.stopped ? "Run stopped" : "Run complete"; bChip.setAttribute("fill", st.stopped ? "#c4472f" : "#2f8a57");
    bSub.textContent = st.stopped ? "Valves left as they were" : "AB-507 analysed: see the results panel"; bLeft.textContent = mm(st.elapsed); bNext.textContent = "elapsed";
    $("demo").innerHTML = st.stopped ? "Run stopped. You have the controls." : `Run complete in ${mm(st.elapsed)}. Results are in the analysis panel.`;
    $("bStop").disabled = true;
    return;
  }
  const ph = st.phase, k = S.PHASES.findIndex((p) => p.key === ph.key) + 1;
  const nxt = st.plan[st.idx + 1];
  bChip.setAttribute("fill", PH_COL[ph.key]);
  bTitle.textContent = `${k} · ${ph.name}`;
  bSub.textContent = `Cycle ${st.cycle} of ${st.cycles} · ${mm(ph.min * 60 - st.left)} of ${mm(ph.min * 60)}`;
  bLeft.textContent = mm(st.left) + " left";
  bNext.textContent = nxt ? `next: ${nxt.name}` : "then analysis";
  $("demo").innerHTML = `<b>Cycle ${st.cycle}/${st.cycles} · ${k} ${ph.name}</b> · ${mm(st.left)} left · run ${mm(st.elapsed)} of ${mm(st.total)}<br>${PH_INFO[ph.key]}`;
}

$("bAnalyse").addEventListener("click", () => { S.analyse(s); showAnalysis(); });
$("bFresh").addEventListener("click", () => { S.freshTraps(s); $("res").textContent = "Fresh acid loaded in AB-507."; });
$("bOpen").addEventListener("click", () => { S.openReactor(s); });
function copy(text, label) {
  const fallback = () => { const b = $("csvBox"); b.style.display = "block"; b.value = text; b.select(); say("Select-all and copy from the box below."); };
  try {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => say(label + " copied."), fallback);
    else fallback();
  } catch (e) { fallback(); }
}
const hms = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60); return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`; };
$("bCopy").addEventListener("click", () => {
  const head = "time_s,PT201_kPa,PT301_kPa,TE201_C,TIC201_C,FIC101_sccm,FIC102_sccm,FI104_sccm,xH2,xN2,xAr,xO2,NH3_ppm,AB507_umol";
  copy([head].concat(s.logs.map((r) => [r.t.toFixed(0), r.PT201.toFixed(2), r.PT301.toFixed(2), r.TE201.toFixed(1), r.TIC201, r.FIC101.toFixed(1), r.FIC102.toFixed(1), r.FI104,
    r.xH2.toFixed(4), r.xN2.toFixed(4), r.xAr.toFixed(4), r.xO2.toExponential(2), r.nh3ppm.toFixed(1), r.cap1.toFixed(4)].join(","))).join("\n"), "Logger CSV");
});
$("bCopyMan").addEventListener("click", () => {
  copy(["time,PT201_kPa,PT301_kPa,TE201_C,TIC_C,FIC101,FIC102,FI104"].concat(s.manual.map((r) => [hms(r.t), r.PT201.toFixed(1), r.PT301.toFixed(1), r.TE201.toFixed(1), r.TIC, r.FIC101.toFixed(0), r.FIC102.toFixed(0), r.FI104].join(","))).join("\n"), "Manual log");
});

/* ---------------- panels ---------------- */
function meltState() { return s.fL >= 1 ? "liquid" : s.fL > 0 ? `mushy, ${(s.fL * 100).toFixed(0)} % liquid` : "solid"; }
const fmt = (v, d) => (Math.abs(v) >= 1e4 ? v.toExponential(1) : v.toFixed(d));
function showAnalysis() {
  const a = s.analysis; if (!a) return;
  let h = `<table><thead><tr><th>Trap</th><th>Acid</th><th>NH₄⁺-N, mg/L</th><th>NH₃, µmol</th></tr></thead><tbody><tr><td>AB-507</td><td>${a.a1.V.toFixed(0)} mL</td><td class="big">${a.a1.below ? "&lt; LOD" : a.a1.meas.toFixed(3)}</td><td>${a.a1.below ? "—" : a.a1.umol.toFixed(3)}</td></tr></tbody></table>`;
  if (a.holdMin > 0) h += `<p>Reaction time ${a.holdMin.toFixed(0)} min. Apparent TOF from the trap: <b class="big">${a.tofApparent > a.tofLOD ? a.tofApparent.toExponential(2) + " s⁻¹" : "not detected"}</b>. Smallest TOF this run could detect: ${a.tofLOD.toExponential(1)} s⁻¹.</p>`;
  else h += "<p>No reaction time recorded yet, so no rate can be worked out.</p>";
  if (a.slip > 0.05 * Math.max(a.a1.umol, 1e-9) && a.slip > 0.01) h += `<p style="color:#9a5c06">Model: ${a.slip.toFixed(2)} µmol NH₃ went past AB-507 to the vent (not measured, there is no second trap). Release or sweep more slowly.</p>`;
  if (s.liq.ln.acid > 0.5 || s.yLiquid > 0) h += `<p style="color:var(--hot)">Acid was sucked back out of AB-507: this sample is not valid.</p>`;
  $("res").innerHTML = h;
}
function updateSOP() {
  const st = S.programStatus(s);
  if (!st) {
    const c = progCfg();
    $("sop").innerHTML = S.PHASES.map((ph, k) => `<li><i style="background:${PH_COL[ph.key]}"></i><b>${k + 1} · ${ph.name}</b><span>${c.min[ph.key]} min</span><span class="desc">${PH_INFO[ph.key]}</span></li>`).join("");
    return;
  }
  $("sop").innerHTML = st.plan.map((p, k) => {
    const cls = st.done || k < st.idx ? "done" : k === st.idx ? "now" : "";
    const n = S.PHASES.findIndex((q) => q.key === p.key) + 1;
    const right = k === st.idx && !st.done ? `${mm(st.left)} left` : `${p.min} min`;
    return `<li class="${cls}"><i style="background:${PH_COL[p.key]}"></i><b>Cycle ${p.cycle} · ${n} ${p.name}</b><span>${right}</span>${k === st.idx && !st.done ? `<span class="desc">${PH_INFO[p.key]}</span>` : ""}</li>`;
  }).join("");
}
const Vin = () => {   // live U6 terminal values
  const f = s.flows, TmC = s.th.Tm - 273.15, Ta = s.p.Tamb;
  return {
    AIN0: (S.press(s.N.hdr) / 1000 / 300 * 5).toFixed(3) + " V",
    AIN1: (S.press(s.N.rx) / 1000 / 300 * 5).toFixed(3) + " V",
    "AIN2/3": (0.041 * (TmC - Ta)).toFixed(2) + " mV",
    AIN4: (f.FIC101 / 20).toFixed(3) + " V",
    AIN5: (f.FIC102 / 20).toFixed(3) + " V",
    DAC0: (s.sp.FIC101 / 20).toFixed(2) + " V",
    DAC1: (s.sp.FIC102 / 20).toFixed(2) + " V",
    FIO0: s.v.pump && powerOK() ? "1" : "0"
  };
};
const WIRING = [
  ["PT-201", "header pressure", "AIN0", "0–5 V = 0–300 kPa abs", "AIN0"],
  ["PT-301", "reactor pressure", "AIN1", "0–5 V = 0–300 kPa abs", "AIN1"],
  ["TE-201", "melt, type K", "AIN2 (+) / AIN3 (−)", "differential, ±0.1 V range; CJC from the U6 internal sensor", "AIN2/3"],
  ["FIC-101", "H₂ flow out", "AIN4", "0–5 V = 0–100 sccm", "AIN4"],
  ["FIC-102", "N₂ flow out", "AIN5", "0–5 V = 0–100 sccm", "AIN5"],
  ["FIC-101", "H₂ set point in", "DAC0", "0–5 V = 0–100 sccm", "DAC0"],
  ["FIC-102", "N₂ set point in", "DAC1", "0–5 V = 0–100 sccm", "DAC1"],
  ["P-601", "vacuum pump", "FIO0", "→ relay → pump mains", "FIO0"]
];
function updateWiring() {
  const v = Vin();
  $("wiring").innerHTML = `<thead><tr><th>Instrument</th><th>Signal</th><th>U6 terminal</th><th>Scaling</th><th>Now</th></tr></thead><tbody>` +
    WIRING.map((w) => `<tr><td>${w[0]}</td><td style="text-align:left">${w[1]}</td><td style="text-align:left;font-family:var(--font-mono)">${w[2]}</td><td style="text-align:left;white-space:normal;font-size:12px;color:var(--muted)">${w[3]}</td><td style="font-family:var(--font-mono)">${v[w[4]]}</td></tr>`).join("") + "</tbody>";
}
let lastEv = null;
function updatePanel() {
  const r = S.readings(s);
  const Prx = r.PT301, TmC = r.TE201;
  $("lcd").innerHTML = [
    ["PT-201", "header", r.PT201.toFixed(1) + " kPa"], ["PT-301", "reactor", Prx.toFixed(1) + " kPa"], ["TE-201", "melt", TmC.toFixed(1) + " °C"],
    ["TIC-201", `SP ${s.sp.furnaceSP}`, r.TIC201 + " °C"], ["FIC-101", "H₂", r.FIC101.toFixed(1) + " sccm"], ["FIC-102", "N₂", r.FIC102.toFixed(1) + " sccm"], ["FI-104", "Ar", r.FI104 + " sccm"]
  ].map(([a, b, c]) => `<div class="row"><span>${a}</span><span>${b}</span><span>${c}</span></div>`).join("") +
    `<div class="foot"><span>t ${hms(s.t)}</span><span>${s.logs.length} rows</span></div>`;
  $("pClock").textContent = hms(s.t);
  const pst = S.programStatus(s);
  $("pState").textContent = pst && pst.done && !running ? (pst.stopped ? "Run stopped" : "Run complete") : !running ? "Paused" : pst && !pst.done ? `${pst.phase.name} · ${mm(pst.left)}` : "Running";
  $("pState").className = "pill " + (running ? "run" : "");
  $("pSpeed").textContent = "×" + Math.round(speed) + (pacing() ? " auto" : "");
  const al = Object.values(s.alarms);
  $("pAlarm").hidden = al.length === 0; $("pAlarm").textContent = al.length + " alarm" + (al.length > 1 ? "s" : "");
  $("pAlarm").className = "pill " + (al.some((a) => a.level === "alarm") ? "bad" : "warn");
  $("alarmCard").hidden = al.length === 0;
  $("alarms").innerHTML = al.map((a) => `<div class="${a.level}">${a.text}</div>`).join("");
  $("kP").innerHTML = Prx.toFixed(1) + "<small>kPa</small>";
  $("kPN").textContent = Prx < 20 ? "under vacuum" : Prx > 101.3 ? `${(Prx - 101.3).toFixed(1)} kPa above atm` : `${(101.3 - Prx).toFixed(1)} kPa below atm`;
  $("kT").innerHTML = TmC.toFixed(0) + "<small>°C</small>";
  $("kTN").textContent = meltState() + ` · ${s.p.meltMass} g charge`;
  $("kO2").innerHTML = (r.o2ppm >= 1e4 ? (r.o2ppm / 1e4).toFixed(1) + "<small>%</small>" : r.o2ppm.toFixed(r.o2ppm < 10 ? 1 : 0) + "<small>ppm</small>");
  $("kO2N").textContent = r.o2ppm < 10 ? "purged" : "purge before heating";
  $("kMade").innerHTML = fmt(r.made, 2) + "<small>µmol</small>";
  $("kMadeN").textContent = s.p.mode === "nitride" ? `N₂ taken up ${fmt(r.n2up, 1)} µmol` : `in gas now ${r.nh3ppm.toFixed(0)} ppm`;
  $("kCap").innerHTML = fmt(r.cap1, 2) + "<small>µmol</small>";
  $("kCapN").textContent = `slipped to vent ${fmt(r.slip, 3)} µmol (model)`;
  $("kAct").innerHTML = (s.melt.nAct > 0 ? r.actMetal.toFixed(1) : "—") + "<small>%</small>";
  $("kActN").textContent = s.melt.nAct > 0 ? `oxide ${(s.cat.oxide / s.melt.nAct * 100).toFixed(1)} % · nitride ${(s.cat.nitride / s.melt.nAct * 100).toFixed(1)} %` : "host-only blank";
  updateSOP(); updateWiring(); livePop();
  const evTop = s.events[s.events.length - 1];
  if (evTop !== lastEv) { lastEv = evTop; $("events").innerHTML = s.events.slice().reverse().map((e) => `<div class="${e.level}"><b>${hms(e.t).slice(0, -3)}</b><span>${e.text}</span></div>`).join(""); }
  $("manual").innerHTML = s.manual.slice().reverse().map((m) => `<tr><td>${hms(m.t).slice(0, -3)}</td><td>${m.PT201.toFixed(1)}</td><td>${m.PT301.toFixed(1)}</td><td>${m.TE201.toFixed(1)}</td><td>${m.TIC}</td><td>${m.FIC101.toFixed(0)}</td><td>${m.FIC102.toFixed(0)}</td><td>${m.FI104}</td></tr>`).join("");
  updateProgram();
  if (s.analysis && s.analysis.t !== s._shownA) { s._shownA = s.analysis.t; showAnalysis(); }
  // PC screen
  const v = Vin();
  const rows = [
    `PT-201  ${r.PT201.toFixed(1).padStart(6)} kPa`, `PT-301  ${Prx.toFixed(1).padStart(6)} kPa`, `TE-201  ${TmC.toFixed(1).padStart(6)} °C`,
    `FIC-101 ${r.FIC101.toFixed(1).padStart(5)}/${String(s.sp.FIC101).padStart(3)} sccm`, `FIC-102 ${r.FIC102.toFixed(1).padStart(5)}/${String(s.sp.FIC102).padStart(3)} sccm`,
    `P-601 ${v.FIO0 === "1" ? "ON" : "OFF"}  furnace ${s.v.furnace && powerOK() ? "ON" : "OFF"}`
  ];
  rows.forEach((t, i) => { scr.rows[i].textContent = t; });
  const lg = s.logs, t1 = s.t, t0 = t1 - 3600, x0 = pcX + 12, x1 = pcX + 148, y0 = pcY + 112, hgt = 13;
  const pts = (fn, lo, hi) => { const out = []; for (let i = Math.max(0, lg.length - 720); i < lg.length; i++) { const L = lg[i]; if (L.t < t0) continue; const x = x0 + (x1 - x0) * (L.t - t0) / 3600, y = y0 - hgt * Math.max(0, Math.min(1, (fn(L) - lo) / (hi - lo))); out.push(x.toFixed(1) + " " + y.toFixed(1)); } return out.length ? "M" + out.join(" L") : ""; };
  trendP.setAttribute("d", pts((L) => L.PT301, 0, 150)); trendT.setAttribute("d", pts((L) => L.TE201, 0, 300));
  for (const k in termVal) { const x = v[k]; termVal[k].textContent = x.endsWith(" mV") ? parseFloat(x).toFixed(1) + "mV" : x.endsWith(" V") ? parseFloat(x).toFixed(2) + "V" : x; }
  syncSliders(); refreshToggles();
}

/* ---------------- live scene ---------------- */
const bub = [];
function updateScene(rd) {
  const N = s.N, pw = powerOK();
  const supply = { supH2: s.v.cylH2 ? [1, 0, 0, 0, 0] : null, supN2: s.v.cylN2 ? [0, 1, 0, 0, 0] : null, supAr: s.v.cylAr ? [0, 0, 1, 0, 0] : null };
  lines.forEach((L) => {
    let col = "#c4cdcf", vac = false;
    if (L.nodeKey in supply) { if (supply[L.nodeKey]) col = gasColour(supply[L.nodeKey]); }
    const f = L.flowFn ? L.flowFn() : 0;
    let empty = false;
    if (L.nodeKey === "psvout") { if (f > 0.3) col = gasColour(comp("rx")); else empty = true; }
    else if (L.nodeKey === "vent") { if (f > 0.3) col = gasColour(s.flows.psv > 0.3 ? comp("rx") : comp("a1")); else empty = true; }
    else if (L.nodeKey === "trapout") { if (f > 0.3) col = gasColour(comp("a1")); else empty = true; }
    else if (!(L.nodeKey in supply)) { col = gasColour(comp(L.nodeKey)); vac = S.press(N[L.nodeKey]) < 20000; }
    L.gas.setAttribute("stroke", col);
    if (Math.abs(f) > 0.3) {
      L.gas.setAttribute("stroke-dasharray", "7 9"); L.gas.setAttribute("opacity", 0.95);
      const v = Math.min(90, 10 + 22 * Math.log10(1 + Math.abs(f)));
      if (!reduced && running) L.off -= Math.sign(f) * v * rd;
      L.gas.setAttribute("stroke-dashoffset", L.off);
    } else {
      L.gas.setAttribute("stroke-dasharray", vac ? "2 6" : "");
      L.gas.setAttribute("opacity", empty ? 0 : vac ? 0.35 : (L.nodeKey in supply && !supply[L.nodeKey]) ? 0.4 : 0.55);
    }
  });
  ["cylH2", "cylN2", "cylAr"].forEach((k) => { cyl[k].ind.setAttribute("fill", s.v[k] ? "var(--ok)" : "#fff"); cyl[k].st.textContent = s.v[k] ? "open" : "shut"; });
  for (const id in valves) {
    const V = valves[id];
    let open = V.key === "NV401" ? s.v.NV401 > 0 : !!s.v[V.key];
    V.b.setAttribute("fill", open ? "#e3f3ea" : "var(--ink)");
    V.b.setAttribute("stroke", open ? "var(--ok)" : "var(--ink)");
  }
  const f = s.flows, sc = (x) => (x > 0.3 ? x.toFixed(x < 10 ? 1 : 0) + " sccm" : "");
  fic101.v.textContent = `${(f.FIC101 || 0).toFixed(1)} / ${s.p.fFIC101 ? "FAIL" : s.sp.FIC101}`;
  fic102.v.textContent = `${(f.FIC102 || 0).toFixed(1)} / ${s.sp.FIC102}`;
  fi104.v.textContent = `${(f.FI104 || 0).toFixed(0)} sccm`;
  fS1.textContent = f.S1 > 0.3 ? "S1 " + sc(f.S1) : ""; fS2.textContent = f.S2 > 0.3 ? "S2 " + sc(f.S2) : ""; fHS.textContent = sc(f.HV202);
  fH2x.textContent = sc(f.FIC101); fN2x.textContent = sc(f.FIC102); fArx.textContent = sc(f.FI104);
  fNV.textContent = `${s.v.NV401} %` + (f.NV401 > 0.3 ? ` · ${sc(f.NV401)}` : "");
  fTrap.textContent = f.b1 > 0.3 ? sc(f.b1) : "";
  glow.setAttribute("opacity", (0.05 + 0.3 * s.th.Pw / 1400) * (s.v.furnace ? 1 : 0) + Math.max(0, (s.th.Tf - 323) / 2500));
  furnBody.setAttribute("stroke", s.v.furnace && pw ? "var(--hot)" : "#b8692e");
  const TmC = s.th.Tm - 273.15, hot = Math.max(0, Math.min(1, (TmC - 100) / 400));
  const depthPx = Math.max(10, Math.min(60, 35 * Math.sqrt(s.p.meltMass / 50)));
  melt.setAttribute("y", 601 - depthPx); melt.setAttribute("height", depthPx);
  meltSurf.setAttribute("y1", 601 - depthPx); meltSurf.setAttribute("y2", 601 - depthPx);
  melt.setAttribute("fill", s.fL >= 1 ? `rgb(${Math.round(150 + 80 * hot)},${Math.round(160 - 30 * hot)},${Math.round(170 - 80 * hot)})` : s.fL > 0 ? "#9fa6aa" : "#8a8f93");
  meltSurf.setAttribute("stroke", s.fL > 0 ? "#e6ecee" : "#a7aeb2");
  meltLab.textContent = `${s.p.meltMass} g catalyst · ${s.p.actPct} % active · ${meltState()}  ✎`;
  headspace.setAttribute("fill", gasColour(comp("rx")));
  headspace.setAttribute("opacity", Math.min(0.35, S.press(N.rx) / 101325 * 0.3));
  plugMark.S1.textContent = s.spg.S1.plugged ? "S1 plugged" : ""; plugMark.S2.textContent = s.spg.S2.plugged ? "S2 plugged" : "";
  rotor.setAttribute("transform", s.v.pump && pw ? `rotate(${(performance.now() / 4) % 360} 1115 262)` : "");
  psvLamp.setAttribute("fill", f.psv > 1 ? "var(--hot)" : "#e3e9e8");
  esdLamp.setAttribute("fill", s.v.esd ? "var(--hot)" : "#f3c7bd");
  const vol = s.liq.a1.acid, hgt = Math.min(146, vol * 0.58);
  trapLiq.setAttribute("y", 338 - hgt); trapLiq.setAttribute("height", hgt);
  trapLiq.setAttribute("fill", s.liq.a1.nh3 * 1e6 > 1 ? "#d9c8ef" : "#cfe0fa");
  // signal wires: dashes run toward the U6 for inputs, away for outputs
  if (!reduced && running) wires.forEach((w) => { w.off = (w.off || 0) + (w.kind === "ain" ? -1 : 1) * 14 * rd; w.w.setAttribute("stroke-dashoffset", w.off); });
  // bubbles
  if (!running || reduced) { while (bub.length) bub.pop().e.remove(); return; }
  const surf = 601 - depthPx;
  const add = (x, y0, yTop) => { const e = el("circle", { cx: x + (Math.random() - 0.5) * 6, cy: y0, r: 2 + Math.random() * 2.2, fill: "#fff", "fill-opacity": 0.9, stroke: "#5b6b71", "stroke-width": 0.5 }, gBub); bub.push({ e, y: y0, top: yTop, vx: (Math.random() - 0.5) * 8 }); };
  const rate = (q) => Math.min(25, Math.abs(q) / 4);
  if (f.S1 > 0.5 && Math.random() < rate(f.S1) * rd) add(765, 592, surf);
  if (f.S2 > 0.5 && Math.random() < rate(f.S2) * rd) add(835, 592, surf);
  if (f.b1 > 0.5 && vol > 20 && Math.random() < rate(f.b1) * rd * 1.5) add(1248, 328, 338 - hgt);
  for (let i = bub.length - 1; i >= 0; i--) {
    const b = bub[i]; b.y -= 40 * rd;
    b.e.setAttribute("cy", b.y); b.e.setAttribute("cx", +b.e.getAttribute("cx") + b.vx * rd);
    if (b.y < b.top) { b.e.remove(); bub.splice(i, 1); }
  }
}

/* ---------------- charts (same renderer as the ZLDD lab) ---------------- */
function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function niceStep(range, n) { const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag; }
function chart(id, lgId, series, opt) {
  const { ctx, w, h } = setupCanvas($(id));
  $(lgId).innerHTML = series.map((sr) => `<span style="color:${sr.color}"><i class="${sr.dash ? "dash" : ""}" style="background:${sr.color}"></i><span style="color:var(--muted)">${sr.name}</span></span>`).join("");
  const L = 48, R = 18, T = 8, B = 24, pw = w - L - R, ph = h - T - B;
  const tmax = Math.max(10, s.t / 60), xst = niceStep(tmax, 6), x1 = Math.ceil(tmax / xst) * xst;
  let lo = Infinity, hi = -Infinity;
  series.forEach((sr) => sr.data.forEach(([, y]) => { if (y < lo) lo = y; if (y > hi) hi = y; }));
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (opt.min !== undefined) lo = Math.min(lo, opt.min);
  if (opt.max !== undefined) hi = Math.max(hi, opt.max);
  const st = niceStep(Math.max(1e-6, hi - lo), 4);
  lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st; if (hi === lo) hi = lo + st;
  const px = (x) => L + pw * x / x1, py = (y) => T + ph * (1 - (y - lo) / (hi - lo));
  ctx.font = "11px IBM Plex Mono, monospace"; ctx.fillStyle = "#5b6b71"; ctx.strokeStyle = "#e3e9e8"; ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const dec = st < 0.01 ? 3 : st < 0.1 ? 2 : st < 1 ? 1 : 0;
  for (let y = lo; y <= hi + st / 2; y += st) { ctx.beginPath(); ctx.moveTo(L, py(y)); ctx.lineTo(L + pw, py(y)); ctx.stroke(); ctx.fillText(y.toFixed(dec), L - 6, py(y)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let x = 0; x <= x1 + 1e-9; x += xst) ctx.fillText(x.toFixed(0), px(x), T + ph + 6);
  ctx.textAlign = "right"; ctx.fillText("min", L + pw, T + ph - 8);
  ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(opt.unit, 0, 0); ctx.restore();
  series.forEach((sr) => {
    if (!sr.data.length) return;
    ctx.beginPath(); sr.data.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.strokeStyle = sr.color; ctx.lineWidth = sr.width || 1.8; ctx.setLineDash(sr.dash ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    const [lx, ly] = sr.data[sr.data.length - 1];
    ctx.fillStyle = sr.color; ctx.beginPath(); ctx.arc(px(lx), py(ly), 3, 0, Math.PI * 2); ctx.fill();
  });
}
function thin(fn) { const lg = s.logs, st = Math.max(1, Math.floor(lg.length / 500)), out = []; for (let i = 0; i < lg.length; i += st) out.push([lg[i].t / 60, fn(lg[i])]); if (lg.length) out.push([lg[lg.length - 1].t / 60, fn(lg[lg.length - 1])]); return out; }
function drawCharts() {
  chart("c1", "lg1", [
    { name: "PT-301 reactor", color: "#0d6f8f", data: thin((r) => r.PT301) },
    { name: "PT-201 header", color: "#9a5c06", data: thin((r) => r.PT201), dash: true }
  ], { unit: "kPa abs", min: 0, max: 120 });
  chart("c2", "lg2", [
    { name: "TE-201 melt", color: "#c4472f", data: thin((r) => r.TE201) },
    { name: "TIC-201 furnace", color: "#d98a1c", data: thin((r) => r.TIC201), dash: true },
    { name: "solidus 125 °C", color: "#9aa5a8", data: s.logs.length ? [[0, s.p.solidus], [s.t / 60, s.p.solidus]] : [], width: 1 }
  ], { unit: "°C", min: 0 });
  chart("c3", "lg3", [
    { name: "H₂", color: "#5b4fc4", data: thin((r) => r.xH2 * 100) },
    { name: "N₂", color: "#2f8a57", data: thin((r) => r.xN2 * 100) },
    { name: "Ar", color: "#404e56", data: thin((r) => r.xAr * 100) },
    { name: "O₂", color: "#d98a1c", data: thin((r) => r.xO2 * 100) }
  ], { unit: "mol %", min: 0, max: 100 });
  chart("c4", "lg4", [
    { name: "formed in R-201 (model)", color: "#b0418f", data: thin((r) => r.made), dash: true },
    { name: "caught in AB-507", color: "#0d6f8f", data: thin((r) => r.cap1) },
    { name: "slipped to vent (model)", color: "#d98a1c", data: thin((r) => r.slip || 0) }
  ], { unit: "µmol NH₃", min: 0, max: 0.1 });
}

/* ---------------- loop ---------------- */
modeUI(); refreshToggles(); syncSliders(); meltNote(); showTotal(); drawCharts(); updatePanel(); updateScene(0);
let last = performance.now(), panelT = 0, chartT = 0, wasDone = true;
function pacing() { const st = S.programStatus(s); return !!(st && !st.done && $("pPace").checked); }
function frame(now) {
  const rd = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) {
    const st = S.programStatus(s);
    if (st && !st.done && $("pPace").checked) {   // each phase takes the same real time on screen
      const secs = Math.max(5, Math.min(120, +$("pPaceS").value || 20));
      speed = Math.max(1, st.phase.min * 60 / secs);
    }
    let left = rd * speed;
    while (left > 1e-9) {
      const chunk = Math.min(left, 1);
      S.advance(s, chunk); left -= chunk;
      if (s.prog && s.prog.done && !wasDone) break;
    }
    // run finished: stop the clock
    if (s.prog && s.prog.done && !wasDone) {
      running = false; $("bPlay").textContent = "Resume";
      speed = +$("sSpeed").value;
      updatePanel(); drawCharts();
    }
  }
  wasDone = !s.prog || s.prog.done;
  updateScene(rd);
  panelT += rd; chartT += rd;
  if (panelT > 0.25) { panelT = 0; updatePanel(); }
  if (chartT > 0.8) { chartT = 0; drawCharts(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener("resize", drawCharts);
})();
