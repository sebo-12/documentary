// One function, drawFrame(t), draws the whole 1920x1080 frame for any time t (seconds).
import { geoMercator, geoPath, geoGraticule10, geoArea } from "d3-geo";
import { interpolateZoom } from "d3-interpolate";
import { feature } from "topojson-client";
import land50 from "world-atlas/land-50m.json";
import beats from "../../beats.json";
import words from "../word_times.json";

export const W = 1920, H = 1080, FPS = 30;
const BG = "#0A1A26", MAPBLUE = "#2F6F9A", COAST = "#6FA6CC", PAPER = "#EFE9DC", RED = "#E8322B";
const SERIF = "'Cormorant Lining', 'Cormorant Garamond'", MONO = "'IBM Plex Mono'", KR = "'Noto Serif KR'";

// ---------- projection: fixed Mercator, the camera is a 2D transform on top ----------
const proj = geoMercator().center([127, 38]).scale(3000).translate([0, 0]);
const pathStr = geoPath(proj);
const P = (lon, lat) => proj([lon, lat]);

let LAND, GRAT, REGIONS, REGION_LINES;
// d3 wants clockwise rings; flip any ring that came out as "the rest of the globe"
const ll = (pts) => { let g = { type: "Polygon", coordinates: [[...pts, pts[0]]] }; if (geoArea(g) > 2 * Math.PI) g = { type: "Polygon", coordinates: [[...pts, pts[0]].reverse()] }; return g; };
// rough 5th-century territories, used only as clip masks on Natural Earth land
const REG = {
  GOGURYEO: [[120.5, 44.0], [120.5, 40.5], [121.5, 38.6], [124.5, 37.2], [126.5, 37.0], [128.0, 37.1], [129.4, 36.9], [134, 36.9], [134, 40], [130.8, 42.3], [130.5, 44.0]],
  BAEKJE: [[124, 34.0], [127.75, 34.0], [127.7, 35.6], [127.9, 36.3], [128.0, 37.1], [126.5, 37.0], [124.5, 37.2], [124, 37.0]],
  SILLA: [[128.0, 37.1], [127.9, 36.3], [127.7, 35.6], [127.75, 34.4], [128.4, 34.5], [129.15, 34.95], [129.8, 35.2], [129.8, 37.0], [129.4, 36.9]],
};
// the internal borders (drawn as lines, clipped to land)
const BORDERS = [
  [[121.5, 38.6], [124.5, 37.2], [126.5, 37.0], [128.0, 37.1], [129.4, 36.9], [131, 36.9]],
  [[128.0, 37.1], [127.9, 36.3], [127.7, 35.6], [127.75, 34.4], [127.75, 33.9]],
];

// ---------- utilities ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, s) => a + (b - a) * s;
const smooth = (s) => { s = clamp(s); return s * s * (3 - 2 * s); };
const easeInOutSine = (s) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(s));
const easeOut = (s) => 1 - Math.pow(1 - clamp(s), 3);
const easeIn = (s) => Math.pow(clamp(s), 3);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const noise1 = (t, a, b, c) => 0.6 * Math.sin(2 * Math.PI * 0.13 * t + a) + 0.3 * Math.sin(2 * Math.PI * 0.29 * t + b) + 0.1 * Math.sin(2 * Math.PI * 0.47 * t + c);
const beat = (id) => beats.find((b) => b.id === id);
// absolute time a word is spoken in a beat (from the speech-to-text pass), matched by prefix
function wt(id, prefix, nth = 0) {
  const hits = words[id].filter(([w]) => w.toLowerCase().replace(/[^\w]/g, "").startsWith(prefix.toLowerCase()));
  if (!hits[nth]) throw new Error(`word ${prefix} not in beat ${id}`);
  return hits[nth][1];
}
const cue = (id) => beat(id).cue_time;

// ---------- camera ----------
// stations: where the camera rests (with drift) between moves. ay = screen y fraction for the target point
const ST = [];
function station(lon, lat, span, ay, arrive, depart, name) { ST.push({ lon, lat, span, ay, arrive, depart, name }); }
function zoomFor(lat, span) { return H / (P(0, lat - span / 2)[1] - P(0, lat + span / 2)[1]); }
function view(s) { // -> [cx, cy, w] (screen-centre world coords and visible world width)
  const z = zoomFor(s.lat, s.span); const [x, y] = P(s.lon, s.lat);
  return [x, y - (s.ay - 0.5) * H / z, W / z];
}
const END = beats[beats.length - 1].end;
export let DURATION = END; // replaced by the real wav length via setDuration
export function setDuration(d) { DURATION = d; }

const b = (i) => beat(i);
station(126.0, 43.6, 15, 0.5, 0, 0.6, "north");
station(126.49, 37.75, 2.6, 0.32, 3.8, b(1).end - 0.6, "Ganghwa");
station(127.4, 38.3, 10.6, 0.5, b(2).start + 1.4, b(2).end - 0.3, "peninsula");
station(126.19, 41.13, 3.2, 0.32, b(3).start + 1.6, b(3).end - 0.6, "Ji'an");
station(129.22, 35.84, 3.2, 0.32, b(4).start + 2.0, b(4).end - 0.4, "Gyeongju");
station(126.55, 37.97, 2.6, 0.32, b(5).start + 2.0, b(6).end - 0.3, "Kaesong");
station(126.98, 37.57, 2.6, 0.32, b(7).start + 1.4, b(8).end - 0.3, "Seoul");
station(126.31, 34.57, 2.4, 0.32, b(9).start + 3.2, b(9).end - 0.6, "Myeongnyang");
station(126.98, 37.57, 3.0, 0.32, b(10).start + 1.5, b(10).end - 0.2, "Seoul2");
station(124.6, 34.5, 12.5, 0.5, b(11).start + 2.2, b(11).end - 0.3, "Shanghai");
station(127.4, 38.0, 4.6, 0.5, b(12).start + 2.6, b(12).end - 0.2, "38th");
station(126.55, 37.97, 3.0, 0.32, b(13).start + 1.6, b(13).end - 0.5, "Kaesong2");
// Han River, east to west through Seoul (camera path only, nothing drawn)
const HAN = [[127.33, 37.55], [127.17, 37.53], [127.03, 37.52], [126.93, 37.535], [126.83, 37.57]];
station(127.33, 37.55, 1.7, 0.32, b(14).start + 0.9, b(14).start + 1.1, "Han0");
station(126.98, 37.57, 3.2, 0.32, b(15).start + 1.2, b(15).end - 0.2, "Seoul3");
// arrives after the film ends, so the closing pull back is still gliding at the last frame
station(125.6, 37.6, 18.5, 0.5, END + 2.5, END + 10, "final");

function hanAt(s) { // position along the river polyline, s in 0..1
  const seg = HAN.length - 1, f = clamp(s) * seg, i = Math.min(seg - 1, Math.floor(f)), u = f - i;
  return [lerp(HAN[i][0], HAN[i + 1][0], u), lerp(HAN[i][1], HAN[i + 1][1], u)];
}

const DRIFT = 6; // px per second during holds
function driftVec(i) { // world units/s at station i, pointing toward the next station
  const a = view(ST[i]), n = ST[i + 1] ? view(ST[i + 1]) : a;
  let dx = n[0] - a[0], dy = n[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
  const z = W / a[2];
  return [dx / L * DRIFT / z, dy / L * DRIFT / z];
}
function heldView(i, t) { const v = view(ST[i]), d = driftVec(i); const dt = t - ST[i].arrive; return [v[0] + d[0] * dt, v[1] + d[1] * dt, v[2]]; }

export function camera(t) {
  for (let i = 0; i < ST.length; i++) {
    const s = ST[i];
    if (t <= s.arrive && i === 0) return heldView(0, t);
    if (t >= s.arrive && t <= s.depart) return heldView(i, t);
    const n = ST[i + 1];
    if (n && t > s.depart && t < n.arrive) {
      // special: the Han River glide is a slow continuous travel, not a zoom move
      if (s.name === "Han0") {
        const t0 = s.depart, t1 = beat(14).end - 0.3;
        const glide = (tt) => { // mostly eased, with a small linear part so it never fully stops
          const q = clamp((tt - t0) / (t1 - t0)), u = 0.85 * easeInOutSine(q) + 0.15 * q;
          const [lon, lat] = hanAt(u), z = zoomFor(lat, s.span), [x, y] = P(lon, lat);
          return [x, y - (s.ay - 0.5) * H / z, W / z];
        };
        if (t < t1) return glide(t);
        const from = glide(t1), pre = glide(t1 - 0.02), vx = (from[0] - pre[0]) / 0.02, vy = (from[1] - pre[1]) / 0.02;
        const u = easeInOutSine((t - t1) / (n.arrive - t1)), a = t - t1;
        const v = interpolateZoom.rho(1.2)(from, view(n))(u), d1 = driftVec(i + 1), c = t - n.arrive;
        return [v[0] + vx * a * (1 - u) + d1[0] * c * u, v[1] + vy * a * (1 - u) + d1[1] * c * u, v[2]];
      }
      const from = heldView(i, s.depart), to = view(n);
      const u = easeInOutSine((t - s.depart) / (n.arrive - s.depart));
      const v = interpolateZoom.rho(1.3)(from, to)(u);
      // carry the hold drift into and out of the move, so the camera never stops dead
      const d0 = driftVec(i), d1 = driftVec(i + 1), a = t - s.depart, c = t - n.arrive;
      return [v[0] + d0[0] * a * (1 - u) + d1[0] * c * u, v[1] + d0[1] * a * (1 - u) + d1[1] * c * u, v[2]];
    }
  }
  return heldView(ST.length - 1, t);
}

// screen speed in px/frame (used for motion blur)
export function camSpeed(t) {
  const a = camera(t), c = camera(t + 1 / FPS);
  const z = W / a[2];
  return Math.hypot(c[0] - a[0], c[1] - a[1]) * z + Math.abs(Math.log(a[2] / c[2])) * W * 0.5;
}

// ---------- pins ----------
const PINS = [
  { lon: 126.49, lat: 37.75, label: "GANGHWA", on: 2.6, labelOff: b(1).end + 0.2 },
  { lon: 126.19, lat: 41.13, label: "JI'AN", on: b(3).start + 0.6, labelOff: b(3).end + 0.3 },
  { lon: 129.22, lat: 35.84, label: "GYEONGJU", on: b(4).start + 1.3, labelOff: b(4).end + 0.3 },
  { lon: 126.55, lat: 37.97, label: "KAESONG", on: b(5).start + 1.3, labelOff: b(6).end + 0.3 },
  { lon: 126.98, lat: 37.57, label: "SEOUL", on: b(7).start + 0.7, labelOff: b(8).end + 0.3 },
  { lon: 126.31, lat: 34.57, label: "MYEONGNYANG", on: b(9).start + 2.3, labelOff: b(9).end + 0.3 },
];

// ---------- heroes (screen space) ----------
// each: kind, text, t0 (appears), t1 (gone), hy (screen y fraction of its centre)
const HY_LOW = 0.665, HY_MID = 0.52;
const HEROES = [
  { kind: "word", text: "GOJOSEON", t0: wt(1, "gojoseon") - 0.05, beat: 1, hy: HY_LOW },
  { kind: "word", text: "GWANGGAETO", t0: wt(3, "guang") - 0.05, beat: 3, hy: HY_LOW },
  { kind: "circle", text: "676", t0: b(4).start - 0.05, circle: cue(4), beat: 4, hy: HY_LOW },
  { kind: "type", text: "KOREA", t0: wt(5, "korea") - 0.08, beat: 5, hy: HY_LOW, width: 0.66 },
  { kind: "word", text: "JIKJI", t0: wt(6, "jeekji") - 0.05, beat: 6, hy: HY_LOW, width: 0.5 },
  { kind: "word", text: "JOSEON", t0: wt(7, "joseon") - 0.05, beat: 7, hy: HY_LOW, width: 0.55 },
  { kind: "hangeul", text: "한글", t0: wt(8, "hangul") - 0.1, beat: 8, hy: HY_LOW },
  { kind: "ships", t0: cue(9), t133: wt(9, "133"), beat: 9, hy: HY_LOW },
  { kind: "stamp", text: "ANNEXED", t0: cue(10), beat: 10, hy: 0.62 },
  { kind: "circle", text: "1919", t0: wt(11, "march") - 0.05, circle: cue(11), beat: 11, hy: HY_MID },
  { kind: "word", text: "ARMISTICE", t0: wt(13, "armistice") - 0.05, beat: 13, hy: HY_LOW },
  { kind: "word", text: "MIRACLE ON THE HANGANG", t0: wt(14, "miracle") - 0.05, beat: 14, hy: HY_LOW, width: 0.68 },
  { kind: "type", text: "JUNE 29, 1987", t0: wt(15, "june") - 0.05, beat: 15, hy: HY_LOW, width: 0.62 },
  { kind: "word", text: "HAN KANG, 2024", t0: wt(16, "han") - 0.05, beat: 16, hy: HY_MID, width: 0.6, out: END - 0.9 },
];
for (const h of HEROES) h.t1 = h.out ?? (b(h.beat).end + 0.5);
const heroAlpha = (h, t) => clamp((t - h.t0) / 0.25) * (1 - smooth((t - (h.t1 - 0.45)) / 0.45));

// territory label times
const TERR = [
  { name: "GOGURYEO", lon: 126.6, lat: 40.6, t0: wt(2, "gogur") - 0.05 },
  { name: "BAEKJE", lon: 125.6, lat: 35.9, t0: wt(2, "bek") - 0.05 },
  { name: "SILLA", lon: 129.75, lat: 35.75, t0: wt(2, "shilla") - 0.05 },
];
const TERR_IN = b(2).start, TERR_OUT0 = b(4).start + 1.5, TERR_OUT1 = b(4).end;
const LINE38 = { t0: cue(12), lon0: 124.2, lon1: 129.7 };

// ---------- assets built once ----------
let grain = [], dust = [], stampCanvas, glowC, worldC, tmpC;
export function init() {
  const land = feature(land50, land50.objects.land);
  LAND = new Path2D(pathStr(land));
  GRAT = new Path2D(pathStr(geoGraticule10()));
  REGIONS = Object.fromEntries(Object.entries(REG).map(([k, v]) => [k, new Path2D(pathStr(ll(v)))]));
  REGION_LINES = BORDERS.map((line) => line.map(([lo, la]) => P(lo, la)));
  const r = rng(7);
  for (let k = 0; k < 8; k++) {
    const c = new OffscreenCanvas(256, 256), g = c.getContext("2d"), im = g.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); grain.push(c);
  }
  for (let i = 0; i < 46; i++) dust.push({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 6, vy: -2 - r() * 5, s: 0.8 + r() * 2.2, a: 0.05 + r() * 0.16, ph: r() * 6.28, par: 0.08 + r() * 0.2 });
  stampCanvas = makeStamp();
}

function makeStamp() {
  const fs = 210, pad = 70;
  const m = new OffscreenCanvas(10, 10).getContext("2d");
  m.font = `600 ${fs}px ${MONO}`; m.letterSpacing = "18px";
  const tw = m.measureText("ANNEXED").width;
  const cw = Math.ceil(tw + pad * 2 + 40), ch = Math.ceil(fs + pad * 2 + 40);
  const c = new OffscreenCanvas(cw, ch), g = c.getContext("2d");
  g.strokeStyle = RED; g.fillStyle = RED;
  g.lineWidth = 14; g.strokeRect(20, 20, cw - 40, ch - 40);
  g.lineWidth = 5; g.strokeRect(44, 44, cw - 88, ch - 88);
  g.font = `600 ${fs}px ${MONO}`; g.letterSpacing = "18px"; g.textBaseline = "middle"; g.textAlign = "center";
  g.fillText("ANNEXED", cw / 2 + 9, ch / 2 + 6);
  // ink distress: knock out specks and streaks
  const r = rng(11); g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 2600; i++) { g.globalAlpha = 0.25 + r() * 0.75; const s = r() * 3.2; g.fillRect(r() * cw, r() * ch, s, s); }
  for (let i = 0; i < 40; i++) { g.globalAlpha = 0.15 + r() * 0.3; g.fillRect(r() * cw, r() * ch, 40 + r() * 160, 1 + r() * 2); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  return c;
}

// ---------- world layer ----------
function worldTransform(g, cam, t) {
  const z = W / cam[2];
  const hx = 3.2 * noise1(t, 0.3, 1.7, 2.9), hy = 2.6 * noise1(t + 11, 2.2, 0.6, 1.1);
  const rot = (0.14 * Math.PI / 180) * noise1(t + 23, 1.4, 2.8, 0.2);
  g.translate(W / 2 + hx, H / 2 + hy); g.rotate(rot); g.scale(z, z); g.translate(-cam[0], -cam[1]);
  return z;
}
const toScreen = (cam, t, x, y) => {
  const z = W / cam[2];
  const hx = 3.2 * noise1(t, 0.3, 1.7, 2.9), hy = 2.6 * noise1(t + 11, 2.2, 0.6, 1.1);
  const rot = (0.14 * Math.PI / 180) * noise1(t + 23, 1.4, 2.8, 0.2);
  const dx = (x - cam[0]) * z, dy = (y - cam[1]) * z, c = Math.cos(rot), s = Math.sin(rot);
  return [W / 2 + hx + dx * c - dy * s, H / 2 + hy + dx * s + dy * c];
};

function drawWorld(g, t) {
  const cam = camera(t);
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  g.save();
  const z = worldTransform(g, cam, t);
  // graticule
  g.strokeStyle = "rgba(140,190,220,0.055)"; g.lineWidth = 1.2 / z; g.stroke(GRAT);
  // land
  g.fillStyle = MAPBLUE; g.globalAlpha = 0.5; g.fill(LAND); g.globalAlpha = 1;
  g.strokeStyle = COAST; g.globalAlpha = 0.55; g.lineWidth = 1.4 / z; g.stroke(LAND); g.globalAlpha = 1;

  // three kingdoms
  const terrA = clamp((t - TERR_IN) / 0.6) * (1 - 0.75 * smooth((t - (b(2).end + 0.3)) / 1.2)) * (1 - smooth((t - TERR_OUT0) / (TERR_OUT1 - TERR_OUT0)));
  if (terrA > 0.001) {
    const tints = { GOGURYEO: "rgba(150,200,230,0.26)", BAEKJE: "rgba(120,190,230,0.20)", SILLA: "rgba(200,225,240,0.32)" };
    for (const [k, path] of Object.entries(REGIONS)) {
      const nameT = TERR.find((x) => x.name === k).t0;
      const a = terrA * clamp((t - nameT + 0.25) / 0.4);
      if (a <= 0) continue;
      g.save(); g.clip(path); g.globalAlpha = a;
      if (k === "GOGURYEO") { // feather the northern and western edges so no straight line shows on land
        const [cx, cy] = P(127.0, 39.6), [ex] = P(131.0, 39.6), r = ex - cx;
        const gr = g.createRadialGradient(cx, cy, r * 0.35, cx, cy, r * 1.15);
        gr.addColorStop(0, tints[k]); gr.addColorStop(1, "rgba(150,200,230,0)"); g.fillStyle = gr;
      } else g.fillStyle = tints[k];
      g.fill(LAND); g.restore();
    }
    // borders draw on
    const prog = easeInOutSine((t - (TERR_IN + 0.3)) / 1.3);
    g.save(); g.clip(LAND);
    g.strokeStyle = PAPER; g.globalAlpha = 0.9 * terrA; g.lineWidth = 3 / z; g.setLineDash([9 / z, 7 / z]);
    for (const line of REGION_LINES) strokePartial(g, line, prog);
    g.restore();
  }

  // 38th parallel
  const l38 = clamp((t - LINE38.t0) / 0.5);
  if (l38 > 0) {
    const [x0, y0] = P(LINE38.lon0, 38), [x1] = P(LINE38.lon1, 38);
    g.strokeStyle = RED; g.lineWidth = 4 / z; g.lineCap = "round";
    g.globalAlpha = 1 - 0.72 * smooth((t - (b(13).start + 0.5)) / 2);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(lerp(x0, x1, easeOut(l38)), y0); g.stroke(); g.globalAlpha = 1;
  }
  g.restore();

  // pins and labels in screen units (constant size)
  for (const p of PINS) {
    const a = clamp((t - p.on) / 0.35);
    if (a <= 0) continue;
    const [px, py] = P(p.lon, p.lat); const [sx, sy] = toScreen(cam, t, px, py);
    const pulse = clamp((t - p.on) / 0.9);
    g.save();
    if (pulse < 1) { g.strokeStyle = RED; g.globalAlpha = (1 - pulse) * 0.8; g.lineWidth = 2.5; g.beginPath(); g.arc(sx, sy, 8 + 34 * easeOut(pulse), 0, 7); g.stroke(); }
    g.globalAlpha = a; g.fillStyle = RED;
    g.beginPath(); g.arc(sx, sy, 7.5 * (0.6 + 0.4 * easeOut(a)), 0, 7); g.fill();
    g.strokeStyle = "rgba(10,26,38,0.9)"; g.lineWidth = 2; g.stroke();
    const la = a * (1 - smooth((t - p.labelOff) / 0.5));
    if (la > 0) {
      g.globalAlpha = la; g.font = `500 42px ${MONO}`; g.letterSpacing = "5px"; g.textBaseline = "middle";
      g.fillStyle = PAPER; g.shadowColor = "rgba(5,14,22,0.9)"; g.shadowBlur = 14;
      g.fillText(p.label, sx + 26 + 10 * (1 - easeOut(la)), sy + 1);
    }
    g.restore();
  }
  // territory names (world anchored, constant screen size)
  const nameA = 1 - smooth((t - (b(2).end + 0.2)) / 0.5);
  if (terrA > 0.001 && nameA > 0) for (const tr of TERR) {
    const a = nameA * clamp((t - tr.t0) / 0.3); if (a <= 0) continue;
    const [sx, sy] = toScreen(cam, t, ...P(tr.lon, tr.lat));
    g.save(); g.globalAlpha = a; g.font = `500 44px ${MONO}`; g.letterSpacing = "6px"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = PAPER; g.shadowColor = "rgba(5,14,22,0.95)"; g.shadowBlur = 16;
    g.fillText(tr.name, sx, sy + 8 * (1 - easeOut(a))); g.restore();
  }
  // 38°N label
  if (l38 >= 1) {
    const a = clamp((t - LINE38.t0 - 0.5) / 0.3) * (1 - smooth((t - (b(12).end + 0.2)) / 0.5));
    if (a > 0) {
      const [sx, sy] = toScreen(cam, t, ...P(LINE38.lon1, 38));
      g.save(); g.globalAlpha = a; g.font = `500 44px ${MONO}`; g.letterSpacing = "4px"; g.textBaseline = "middle";
      g.fillStyle = PAPER; g.shadowColor = "rgba(5,14,22,0.95)"; g.shadowBlur = 16; g.fillText("38°N", sx + 24, sy); g.restore();
    }
  }
}

function strokePartial(g, pts, s) {
  if (s <= 0) return;
  let total = 0; const seg = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let left = total * clamp(s);
  g.beginPath(); g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const d = seg[i - 1], u = Math.min(1, left / d);
    g.lineTo(lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)); left -= d;
  }
  g.stroke();
}

// ---------- hero drawing ----------
function fitFont(g, text, font, letterSp, targetW) {
  g.font = font(100); g.letterSpacing = letterSp(100);
  const w = g.measureText(text).width;
  return 100 * targetW / w;
}

function drawHeroes(g, t) {
  for (const h of HEROES) {
    const a = heroAlpha(h, t);
    if (a <= 0 || t < h.t0) continue;
    const cy = h.hy * H, exitLift = -14 * smooth((t - (h.t1 - 0.45)) / 0.45);
    g.save(); g.translate(0, exitLift);
    g.fillStyle = PAPER; g.textBaseline = "alphabetic"; g.shadowColor = "rgba(4,12,20,0.85)"; g.shadowBlur = 30;
    if (h.kind === "word" || h.kind === "type") drawWord(g, h, t, a, cy);
    else if (h.kind === "circle") drawCircleNum(g, h, t, a, cy);
    else if (h.kind === "hangeul") drawHangeul(g, h, t, a, cy);
    else if (h.kind === "ships") drawShips(g, h, t, a, cy);
    else if (h.kind === "stamp") drawStamp(g, h, t, a, cy);
    g.restore();
  }
}

const serifFont = (s) => `600 ${s}px ${SERIF}`;
function drawWord(g, h, t, a, cy) {
  const target = (h.width ?? 0.6) * W;
  const sp = (s) => `${(s * 0.06).toFixed(1)}px`;
  let fs = fitFont(g, h.text, serifFont, sp, target);
  fs = Math.min(fs, 330);
  g.font = serifFont(fs); g.letterSpacing = sp(fs);
  const chars = [...h.text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((x, y) => x + y, 0);
  let x = W / 2 - total / 2 + fs * 0.03;
  const base = cy + fs * 0.32; // optical centre of capitals
  const step = h.kind === "type" ? 0.075 : 0.045, fade = h.kind === "type" ? 0.05 : 0.22;
  chars.forEach((c, i) => {
    const ci = clamp((t - h.t0 - i * step) / fade);
    if (ci > 0) { g.globalAlpha = a * ci; g.fillText(c, x, base + (h.kind === "type" ? 0 : 18 * (1 - easeOut(ci)))); }
    x += widths[i];
  });
  if (h.kind === "type") { // caret while typing
    const n = Math.min(chars.length, Math.floor((t - h.t0) / step) + 1);
    const done = t - h.t0 > chars.length * step + 0.35;
    if (!done) {
      let cx = W / 2 - total / 2 + fs * 0.03; for (let i = 0; i < n; i++) cx += widths[i];
      g.globalAlpha = a * 0.9; g.fillRect(cx + fs * 0.02, base - fs * 0.66, Math.max(3, fs * 0.022), fs * 0.74);
    }
  }
  // red underline draws on after the word lands
  const u = easeOut((t - h.t0 - Math.min(0.6, chars.length * step) - 0.05) / 0.5);
  if (u > 0) { g.shadowBlur = 0; g.globalAlpha = a; g.fillStyle = RED; const uw = Math.min(260, total * 0.3); g.fillRect(W / 2 - uw / 2, base + fs * 0.2, uw * u, Math.max(4, fs * 0.025)); }
}

function drawCircleNum(g, h, t, a, cy) {
  const fs = 400; g.font = serifFont(fs); g.letterSpacing = "6px";
  const w = g.measureText(h.text).width;
  const base = cy + fs * 0.24;
  g.globalAlpha = a; g.fillText(h.text, W / 2 - w / 2, base + 14 * (1 - easeOut((t - h.t0) / 0.35)));
  const p = easeOut((t - h.circle) / 0.5);
  if (p > 0) {
    g.shadowBlur = 0; g.strokeStyle = RED; g.lineWidth = 7; g.lineCap = "round"; g.globalAlpha = a;
    const rx = w / 2 + 95, ry = fs * 0.5, a0 = -Math.PI * 0.62, sweep = Math.PI * 2.1 * p;
    const ccy = base - fs * 0.34; // centre of the lining figures
    g.beginPath();
    for (let k = 0; k <= 80; k++) {
      const th = a0 + sweep * (k / 80), wob = 1 + 0.025 * Math.sin(th * 3 + 1) + 0.04 * (k / 80);
      const x = W / 2 + Math.cos(th) * rx * wob, y = ccy + Math.sin(th) * ry * wob;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}

function drawHangeul(g, h, t, a, cy) {
  const steps = ["ㅎ", "하", "한", "한ㄱ", "한그", "한글"];
  const k = Math.min(steps.length - 1, Math.floor((t - h.t0) / 0.085));
  const fs = 470; g.font = `700 ${fs}px ${KR}`; g.letterSpacing = "20px";
  const full = g.measureText("한글").width;
  g.globalAlpha = a; g.fillText(steps[k], W / 2 - full / 2, cy + fs * 0.36);
  const u = easeOut((t - h.t0 - 0.6) / 0.5);
  if (u > 0) { g.shadowBlur = 0; g.fillStyle = RED; g.fillRect(W / 2 - 130, cy + fs * 0.36 + 46, 260 * u, 7); }
}

function slamScale(t, t0) { // 1.6 -> 1 accelerating, tiny overshoot
  const s = (t - t0) / 0.12; if (s < 1) return lerp(1.6, 0.97, easeIn(s));
  return 1 - 0.03 * Math.exp(-(t - t0 - 0.12) * 18) * Math.cos((t - t0 - 0.12) * 40);
}
function drawShips(g, h, t, a, cy) {
  const fs = 390; g.font = serifFont(fs); g.letterSpacing = "6px";
  const base = cy + fs * 0.24, gap = 210;
  const w13 = g.measureText("13").width, w133 = g.measureText("133").width;
  const total = w13 + gap + w133, x13 = W / 2 - total / 2, x133 = x13 + w13 + gap;
  // 13 slams
  const sc = slamScale(t, h.t0);
  g.save(); g.translate(x13 + w13 / 2, base - fs * 0.33); g.scale(sc, sc);
  g.globalAlpha = a * clamp((t - h.t0) / 0.05); g.fillText("13", -w13 / 2, fs * 0.33); g.restore();
  // 133 (the larger fleet) arrives when spoken, dimmer
  const b = clamp((t - h.t133 + 0.05) / 0.3);
  if (b > 0) { g.globalAlpha = a * b * 0.5; g.fillText("133", x133, base + 14 * (1 - easeOut(b))); }
  // short red rule under 13
  const u = easeOut((t - h.t0 - 0.25) / 0.45);
  if (u > 0) { g.shadowBlur = 0; g.globalAlpha = a; g.fillStyle = RED; g.fillRect(x13 + w13 / 2 - 90, base + 40, 180 * u, 7); }
}

function drawStamp(g, h, t, a, cy) {
  const sc = slamScale(t, h.t0) * (W * 0.58) / stampCanvas.width;
  g.shadowBlur = 0;
  g.save(); g.translate(W / 2, cy); g.rotate(-6 * Math.PI / 180); g.scale(sc, sc);
  g.globalAlpha = a * 0.92 * clamp((t - h.t0) / 0.04);
  g.drawImage(stampCanvas, -stampCanvas.width / 2, -stampCanvas.height / 2); g.restore();
}

// ---------- progress line ----------
function drawProgress(g, t) {
  const x0 = 80, x1 = W - 80, y = H - 40, p = clamp(t / DURATION);
  g.save(); g.globalAlpha = 0.22; g.fillStyle = PAPER; g.fillRect(x0, y, x1 - x0, 2);
  g.globalAlpha = 0.5; g.fillRect(x0, y, (x1 - x0) * p, 2);
  for (const bt of beats) { const x = x0 + (x1 - x0) * bt.start / DURATION; g.globalAlpha = 0.4; g.fillRect(x - 1, y - 6, 2, 14); }
  g.globalAlpha = 0.9; g.beginPath(); g.arc(x0 + (x1 - x0) * p, y + 1, 5, 0, 7); g.fill(); g.restore();
}

// ---------- full frame ----------
export function drawFrame(ctx, t, scale = 1) {
  if (!worldC) { worldC = new OffscreenCanvas(W, H); tmpC = new OffscreenCanvas(W, H); glowC = new OffscreenCanvas(W / 4, H / 4); }
  const wg = worldC.getContext("2d");
  // motion blur: average four sub-frame samples only while the camera moves fast
  const fast = camSpeed(t) > 9;
  if (!fast) { wg.setTransform(1, 0, 0, 1, 0, 0); drawWorld(wg, t); }
  else {
    const tg = tmpC.getContext("2d");
    for (let k = 0; k < 4; k++) {
      const ts = t + ((k + 0.5) / 4 - 0.5) * 0.5 / FPS; // 180-degree shutter
      tg.setTransform(1, 0, 0, 1, 0, 0); drawWorld(tg, ts);
      wg.globalAlpha = 1 / (k + 1); wg.drawImage(tmpC, 0, 0); wg.globalAlpha = 1;
    }
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(worldC, 0, 0);

  // dust (slight parallax with the camera)
  ctx.save(); ctx.fillStyle = PAPER;
  for (const d of dust) {
    let x = (d.x + d.vx * t) % W; if (x < 0) x += W;
    let y = (d.y + d.vy * t) % H; if (y < 0) y += H;
    ctx.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(t * 0.7 + d.ph));
    ctx.beginPath(); ctx.arc(x, y, d.s, 0, 7); ctx.fill();
  }
  ctx.restore();

  // dim the map behind a hero
  let dim = 0;
  for (const h of HEROES) dim = Math.max(dim, heroAlpha(h, t));
  if (dim > 0) { ctx.fillStyle = `rgba(8,20,30,${0.5 * dim})`; ctx.fillRect(0, 0, W, H); }

  drawHeroes(ctx, t);

  // glow
  const gg = glowC.getContext("2d");
  gg.setTransform(1, 0, 0, 1, 0, 0); gg.filter = "blur(5px)"; gg.clearRect(0, 0, W / 4, H / 4);
  gg.drawImage(ctx.canvas, 0, 0, W / 4, H / 4); gg.filter = "none";
  ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.28; ctx.drawImage(glowC, 0, 0, W, H); ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,4,8,0.62)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  drawProgress(ctx, t);

  // grain
  const fi = Math.floor(t * FPS);
  ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = 0.085;
  const gt = grain[fi % grain.length], ox = (fi * 97) % 256, oy = (fi * 57) % 256;
  ctx.translate(-ox, -oy); ctx.fillStyle = ctx.createPattern(gt, "repeat"); ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
