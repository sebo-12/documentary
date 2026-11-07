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
station(126.49, 37.75, 2.6, 0.24, 3.8, b(1).end - 0.6, "Ganghwa");
station(127.4, 38.3, 10.6, 0.5, b(2).start + 1.4, b(2).end - 0.3, "peninsula");
station(126.19, 41.13, 3.2, 0.24, b(3).start + 1.6, b(3).end - 0.6, "Ji'an");
station(129.22, 35.84, 3.2, 0.32, b(4).start + 2.0, b(4).end - 0.4, "Gyeongju");
station(126.55, 37.97, 2.6, 0.24, b(5).start + 2.0, b(6).end - 0.3, "Kaesong");
station(126.98, 37.57, 2.6, 0.24, b(7).start + 1.4, b(8).end - 0.3, "Seoul");
station(127.9, 34.9, 5.0, 0.5, b(9).start + 1.6, b(9).start + 2.8, "south");
station(126.31, 34.57, 2.4, 0.32, b(9).start + 5.0, b(9).end - 0.6, "Myeongnyang");
station(126.98, 37.57, 3.0, 0.24, b(10).start + 1.5, b(10).end - 0.6, "Seoul2");
station(124.6, 34.5, 12.5, 0.5, b(11).start + 1.0, b(11).end - 0.3, "Shanghai");
station(127.4, 38.0, 4.6, 0.5, b(12).start + 2.6, b(12).end - 0.2, "38th");
station(126.55, 37.97, 3.0, 0.24, b(13).start + 1.6, b(13).end - 0.5, "Kaesong2");
// Han River, east to west through Seoul (camera path only, nothing drawn)
const HAN = [[127.33, 37.55], [127.17, 37.53], [127.03, 37.52], [126.93, 37.535], [126.83, 37.57]];
station(127.33, 37.55, 1.7, 0.24, b(14).start + 0.9, b(14).start + 1.1, "Han0");
station(126.98, 37.57, 3.2, 0.24, b(15).start + 1.2, b(15).end - 0.2, "Seoul3");
// arrives after the film ends, so the closing pull back is still gliding at the last frame
station(125.6, 37.6, 18.5, 0.5, END + 3.0, END + 12, "final");

function hanAt(s) { // position along the river polyline, s in 0..1
  const seg = HAN.length - 1, f = clamp(s) * seg, i = Math.min(seg - 1, Math.floor(f)), u = f - i;
  return [lerp(HAN[i][0], HAN[i + 1][0], u), lerp(HAN[i][1], HAN[i + 1][1], u)];
}

const DRIFT = 6; // px per second during holds
function driftVec(i) { // world units/s at station i, pointing toward the next station
  const a = view(ST[i]);
  // the last station keeps drifting the way the camera came in, so it never stops dead
  let dx, dy;
  if (ST[i + 1]) { const n = view(ST[i + 1]); dx = n[0] - a[0]; dy = n[1] - a[1]; }
  else { const pv = view(ST[i - 1]); dx = a[0] - pv[0]; dy = a[1] - pv[1]; }
  const L = Math.hypot(dx, dy) || 1;
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
  { kind: "counter", text: "700,000", t0: wt(1, "700") - 0.05, sub: "YEARS AGO", subT: wt(1, "years"), beat: 1, hy: 0.5, out: 2.9 },
  { kind: "circle", text: "676", t0: b(4).start - 0.05, circle: cue(4), beat: 4, hy: HY_LOW },
  { kind: "type", text: "KOREA", t0: wt(5, "korea") - 0.08, beat: 5, hy: HY_LOW, width: 0.66 },
  { kind: "hangeul", text: "한글", t0: wt(8, "hangul") - 0.1, beat: 8, hy: 0.6 },
  { kind: "ships", t0: cue(9), t133: wt(9, "133"), beat: 9, hy: HY_LOW },
  { kind: "stamp", text: "ANNEXED", t0: cue(10), beat: 10, hy: 0.6 },
  { kind: "circle", text: "1919", t0: cue(11) - 0.3, circle: cue(11), beat: 11, hy: 0.56 },
  { kind: "type", text: "JUNE 29, 1987", t0: wt(15, "june") - 0.05, beat: 15, hy: HY_LOW, width: 0.62 },
  { kind: "word", text: "HAN KANG, 2024", t0: wt(16, "han") - 0.05, beat: 16, hy: HY_MID, width: 0.6, out: END - 1.2 },
];
// photos (black-and-white polaroids) and documents (paper) that drop onto the map where the story happens.
// sx, sy: screen position (fractions) at the moment tRef; box: max display size in px at that moment.
const OBJECTS = [
  { img: "dolmen", kind: "polaroid", beat: 1, td: 3.0, sx: 0.5, sy: 0.6, box: [760, 500], rot: -2.5, caption: "GOJOSEON", capT: wt(1, "gojoseon") - 0.05 },
  { img: "stele", kind: "polaroid", beat: 3, td: wt(3, "guang") - 0.1, sx: 0.5, sy: 0.6, box: [400, 520], rot: 2 },
  { img: "jikji", kind: "polaroid", beat: 6, td: wt(6, "jeekji") - 0.1, sx: 0.5, sy: 0.6, box: [720, 500], rot: -2 },
  { img: "gyeongbokgung", kind: "polaroid", beat: 7, td: wt(7, "joseon") - 0.2, sx: 0.5, sy: 0.6, box: [760, 500], rot: -3 },
  { img: "hunminjeongeum", kind: "doc", beat: 8, td: b(8).start + 0.8, sx: 0.5, sy: 0.6, box: [860, 600], rot: 2, overlay: wt(8, "hangul") - 0.1 },
  { img: "annexation_treaty", kind: "doc", beat: 10, td: b(10).start + 0.7, sx: 0.5, sy: 0.6, box: [820, 560], rot: -1.5 },
  { img: "declaration", kind: "doc", beat: 11, td: b(11).start + 0.35, sx: 0.5, sy: 0.56, box: [1100, 520], rot: 1, overlay: cue(11) - 0.3 },
  { img: "armistice", kind: "doc", beat: 13, td: wt(13, "armistice") - 0.15, sx: 0.5, sy: 0.6, box: [480, 600], rot: 1.5 },
  { img: "expressway", kind: "polaroid", beat: 14, td: b(14).start + 0.9, sx: 0.5, sy: 0.6, box: [760, 500], rot: -2, tRef: (b(14).start + b(14).end) / 2 },
];
for (const o of OBJECTS) o.t1 = b(o.beat).end + 0.5;
// closing shot: screen position (at the last frame) and the story place each thumbnail links to
const PL = { ganghwa: [126.49, 37.75], jian: [126.19, 41.13], kaesong: [126.55, 37.97], seoul: [126.98, 37.57] };
const FINAL = {
  stele: [0.16, 0.22, PL.jian], dolmen: [0.16, 0.45, PL.ganghwa], jikji: [0.16, 0.68, PL.kaesong], declaration: [0.33, 0.86, PL.seoul],
  gyeongbokgung: [0.84, 0.22, PL.seoul], hunminjeongeum: [0.84, 0.42, PL.seoul], annexation_treaty: [0.84, 0.62, PL.seoul],
  expressway: [0.84, 0.83, PL.seoul], armistice: [0.66, 0.86, PL.kaesong],
};
const FINAL_T0 = END - 1.65; // as the last hero fades
HEROES.push({ kind: "endcard", t0: END + 0.35, beat: 16, hy: 0.42, out: 1e9 });
for (const h of HEROES) h.t1 = h.out ?? (b(h.beat).end + 0.5);
const objLive = (o, t) => clamp((t - o.td) / 0.25) * (1 - smooth((t - (o.t1 - 0.45)) / 0.45));
const heroAlpha = (h, t) => clamp((t - h.t0) / 0.25) * (1 - smooth((t - (h.t1 - 0.45)) / 0.45));

// territory label times
const TERR = [
  { name: "GOGURYEO", lon: 126.6, lat: 40.6, t0: wt(2, "gogur") - 0.05 },
  { name: "BAEKJE", lon: 125.6, lat: 35.9, t0: wt(2, "bek") - 0.05 },
  { name: "SILLA", lon: 129.75, lat: 35.75, t0: wt(2, "shilla") - 0.05 },
];
const TERR_IN = b(2).start, TERR_OUT0 = b(4).start + 1.5, TERR_OUT1 = b(4).end;
const LINE38 = { t0: cue(12), lon0: 124.2, lon1: 129.7 };
const ARROWS = [
  { from: [126.19, 41.13], to: [124.6, 41.5], bend: -0.18, t0: wt(3, "pushes") - 0.05, t1: b(3).end + 0.3 },
  { from: [130.7, 33.8], to: [129.12, 35.0], bend: 0.22, t0: wt(9, "invades") - 0.1, t1: b(9).start + 3.6 },
];

// ---------- assets built once ----------
let grain = [], dust = [], stampCanvas, glowC, worldC, tmpC;
let IMAGES = {};
export const IMAGE_NAMES = ["dolmen", "stele", "jikji", "gyeongbokgung", "hunminjeongeum", "annexation_treaty", "declaration", "armistice", "expressway"];
export function setImages(m) { IMAGES = m; }
const PAPERC = "#F1ECE2";
function prerenderObject(o) {
  const im = IMAGES[o.img]; const iw = im.width, ih = im.height;
  const k = Math.min(o.box[0] / iw, o.box[1] / ih); // display size at tRef
  const Q = 1.5; // supersample so pull-ins stay sharp
  const dw = Math.round(iw * k), dh = Math.round(ih * k);
  const r = rng(o.img.length * 7 + 3);
  if (o.kind === "polaroid") {
    const bs = 24, bb = 92, pad = 70;
    const cw = dw + bs * 2, ch = dh + bs + bb;
    const c = new OffscreenCanvas(Math.ceil((cw + pad * 2) * Q), Math.ceil((ch + pad * 2) * Q)), g = c.getContext("2d");
    g.scale(Q, Q); g.translate(pad, pad);
    g.fillStyle = PAPERC; g.fillRect(0, 0, cw, ch);
    g.filter = "grayscale(1) contrast(1.12) brightness(1.03)"; g.drawImage(im, bs, bs, dw, dh); g.filter = "none";
    g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.strokeRect(bs + 0.5, bs + 0.5, dw - 1, dh - 1);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,80,60,${0.03 + r() * 0.05})`; g.fillRect(r() * cw, r() * ch, 1.2, 1.2); }
    drawClip(g, cw * 0.18, -8);
    o.canvas = c; o.cw = cw; o.ch = ch; o.pad = pad; o.Q = Q; o.capY = dh + bs + bb * 0.56;
  } else {
    const pad = 40, cw = dw, ch = dh;
    const c = new OffscreenCanvas(Math.ceil((cw + pad * 2) * Q), Math.ceil((ch + pad * 2) * Q)), g = c.getContext("2d");
    g.scale(Q, Q); g.translate(pad, pad);
    const path = new Path2D(), J = () => (r() - 0.5) * 3.2, step = 10;
    path.moveTo(J(), J());
    for (let x = step; x < cw; x += step) path.lineTo(x, J());
    for (let y = 0; y < ch; y += step) path.lineTo(cw + J(), y);
    for (let x = cw; x > 0; x -= step) path.lineTo(x, ch + J());
    for (let y = ch; y > 0; y -= step) path.lineTo(J(), y);
    path.closePath();
    g.save(); g.clip(path); g.fillStyle = PAPERC; g.fillRect(-5, -5, cw + 10, ch + 10); g.drawImage(im, 0, 0, cw, ch); g.restore();
    o.canvas = c; o.cw = cw; o.ch = ch; o.pad = pad; o.Q = Q;
  }
}
function drawClip(g, x, y) { // a steel paper clip over the top edge
  g.save(); g.translate(x, y); g.rotate(-0.12);
  const loop = (w, h, off) => { g.beginPath(); g.moveTo(off, h); g.lineTo(off, w / 2); g.arc(off + w / 2, w / 2, w / 2, Math.PI, 0); g.lineTo(off + w, h - w / 2); };
  g.lineCap = "round"; g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = 4; g.shadowOffsetY = 2;
  g.strokeStyle = "#9AA4AB"; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(8, 92); g.lineTo(8, 14); g.arc(20, 14, 12, Math.PI, 0); g.lineTo(32, 78); g.arc(22, 78, 10, 0, Math.PI); g.lineTo(12, 26); g.arc(20, 26, 8, Math.PI, 0); g.lineTo(28, 66); g.stroke();
  g.shadowColor = "transparent"; g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(7, 88); g.lineTo(7, 16); g.stroke();
  g.restore();
}
function anchorFinal(o, i) {
  const [fx, fy, place] = FINAL[o.img], cam = camera(FINAL_T0 + 0.9), z = W / cam[2];
  o.fwx = cam[0] + (fx * W - W / 2) / z; o.fwy = cam[1] + (fy * H - H / 2) / z; o.fz = z;
  o.fk = Math.min(210 / o.cw, 150 / o.ch); o.place = P(...place); o.ft = FINAL_T0 + i * 0.07;
}
function anchorObject(o) {
  const tr = o.tRef ?? (o.td + 0.6), cam = camera(tr), z = W / cam[2];
  o.wx = cam[0] + (o.sx * W - W / 2) / z; o.wy = cam[1] + (o.sy * H - H / 2) / z; o.zRef = z;
}
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
  OBJECTS.forEach((o, i) => { prerenderObject(o); anchorObject(o); anchorFinal(o, i); });
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

function dimAt(t) {
  let d = 0;
  for (const h of HEROES) d = Math.max(d, heroAlpha(h, t));
  for (const o of OBJECTS) d = Math.max(d, objLive(o, t));
  return d;
}
function drawObjects(g, t, cam, dim) {
  const zNow = W / cam[2];
  const rotCam = (0.14 * Math.PI / 180) * noise1(t + 23, 1.4, 2.8, 0.2);
  for (const o of OBJECTS) {
    if (t < o.td || t > o.t1) continue;
    const p = easeOut((t - o.td) / 0.45), a = clamp((t - o.td) / 0.12) * (1 - smooth((t - (o.t1 - 0.45)) / 0.45));
    const [sx, sy] = toScreen(cam, t, o.wx, o.wy);
    const sc = zNow / o.zRef * (1 + 0.1 * (1 - p));
    g.save();
    g.translate(sx, sy - 70 * (1 - p) * sc); g.rotate(rotCam + (o.rot + 5 * (1 - p)) * Math.PI / 180); g.scale(sc, sc);
    g.globalAlpha = a;
    g.shadowColor = "rgba(0,4,8,0.6)"; g.shadowBlur = (16 + 34 * (1 - p)) * sc; g.shadowOffsetY = (10 + 34 * (1 - p)) * sc;
    const x0 = -o.cw / 2 - o.pad, y0 = -o.ch / 2 - o.pad;
    g.drawImage(o.canvas, x0, y0, o.canvas.width / o.Q, o.canvas.height / o.Q);
    g.shadowColor = "transparent";
    if (o.caption && t >= o.capT) { // caption written on the polaroid strip, letter by letter
      g.font = `600 64px ${SERIF}`; g.letterSpacing = "5px"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = "#1C2730";
      const chars = [...o.caption], ws = chars.map((c) => g.measureText(c).width), tot = ws.reduce((x, y) => x + y, 0);
      let x = -tot / 2;
      chars.forEach((c, i) => { const ci = clamp((t - o.capT - i * 0.045) / 0.2); if (ci > 0) { g.globalAlpha = a * ci; g.fillText(c, x, -o.ch / 2 + o.capY); } x += ws[i]; });
      g.globalAlpha = a;
    }
    // darken documents under a typed overlay
    let shade = 0;
    if (o.overlay) shade = Math.max(shade, 0.6 * clamp((t - o.overlay) / 0.3) * objLive(o, t));
    if (shade > 0.001) { g.globalAlpha = shade * 0.62; g.fillStyle = "rgb(8,20,30)"; g.fillRect(-o.cw / 2 - 2, -o.ch / 2 - 2, o.cw + 4, o.ch + 4); }
    g.restore();
  }
}

function drawFinal(g, t, cam) {
  if (t < FINAL_T0) return;
  const zNow = W / cam[2];
  let heroDim = 0; for (const h of HEROES) if (h.kind !== "endcard") heroDim = Math.max(heroDim, heroAlpha(h, t));
  const out = 1 - smooth((t - (END + 0.2)) / 0.6); // thumbnails clear the stage for the end card
  if (out <= 0) return;
  for (const o of OBJECTS) {
    if (t < o.ft) continue;
    const p = easeOut((t - o.ft) / 0.4), a = clamp((t - o.ft) / 0.2) * out;
    const [sx, sy] = toScreen(cam, t, o.fwx, o.fwy), [px, py] = toScreen(cam, t, ...o.place);
    // red connector to the place, drawn on
    const lp = easeOut((t - o.ft - 0.15) / 0.5);
    if (lp > 0) { g.save(); g.strokeStyle = RED; g.globalAlpha = 0.75 * (1 - 0.6 * heroDim) * out; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(lerp(sx, px, lp), lerp(sy, py, lp)); g.stroke(); g.restore(); }
    const sc = (zNow / o.fz) * o.fk * (1 + 0.15 * (1 - p));
    g.save(); g.translate(sx, sy - 20 * (1 - p)); g.rotate(o.rot * Math.PI / 180); g.scale(sc, sc);
    g.globalAlpha = a; g.shadowColor = "rgba(0,4,8,0.6)"; g.shadowBlur = 14 / sc * 0.5; g.shadowOffsetY = 6 / sc * 0.5;
    g.drawImage(o.canvas, -o.cw / 2 - o.pad, -o.ch / 2 - o.pad, o.canvas.width / o.Q, o.canvas.height / o.Q);
    g.shadowColor = "transparent";
    if (heroDim > 0) { g.globalAlpha = 0.55 * heroDim; g.fillStyle = "rgb(8,20,30)"; g.fillRect(-o.cw / 2 - 2, -o.ch / 2 - 2, o.cw + 4, o.ch + 4); }
    g.restore();
  }
}

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
  // arrows: drawn on over 0.7 s, curved, with a head
  for (const ar of ARROWS) {
    const p = easeInOutSine((t - ar.t0) / 0.7), fa = 1 - smooth((t - (ar.t1 - 0.4)) / 0.4);
    if (p <= 0 || fa <= 0) continue;
    const A = toScreen(cam, t, ...P(...ar.from)), B = toScreen(cam, t, ...P(...ar.to));
    const mx = (A[0] + B[0]) / 2 - (B[1] - A[1]) * ar.bend, my = (A[1] + B[1]) / 2 + (B[0] - A[0]) * ar.bend;
    const pts = []; for (let k = 0; k <= 40; k++) { const u = k / 40, v = 1 - u; pts.push([v * v * A[0] + 2 * v * u * mx + u * u * B[0], v * v * A[1] + 2 * v * u * my + u * u * B[1]]); }
    g.save(); g.globalAlpha = fa; g.strokeStyle = RED; g.fillStyle = RED; g.lineWidth = 5; g.lineCap = "round"; g.lineJoin = "round";
    strokePartial(g, pts, p);
    const k = Math.max(1, Math.round(40 * p)), [hx, hy] = pts[k], [qx, qy] = pts[k - 1], ang = Math.atan2(hy - qy, hx - qx);
    if (p > 0.05) { g.translate(hx, hy); g.rotate(ang); g.beginPath(); g.moveTo(10, 0); g.lineTo(-14, -11); g.lineTo(-14, 11); g.closePath(); g.fill(); }
    g.restore();
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
  const dim = dimAt(t);
  if (dim > 0) { g.fillStyle = `rgba(8,20,30,${0.5 * dim})`; g.fillRect(0, 0, W, H); }
  drawObjects(g, t, cam, dim);
  drawFinal(g, t, cam);
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
    else if (h.kind === "counter") drawCounter(g, h, t, a, cy);
    else if (h.kind === "endcard") drawEndCard(g, h, t, a, cy);
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

function drawCounter(g, h, t, a, cy) {
  const v = Math.round(700000 * easeOut((t - h.t0) / 1.0));
  const txt = v.toLocaleString("en-US");
  g.font = `500 230px ${MONO}`; g.letterSpacing = "6px"; g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.globalAlpha = a; g.fillText(txt, W / 2, cy + 40);
  const sa = clamp((t - h.subT) / 0.3);
  if (sa > 0) { g.font = `500 56px ${MONO}`; g.letterSpacing = "18px"; g.globalAlpha = a * sa; g.fillText(h.sub, W / 2 + 9, cy + 140); }
  g.textAlign = "left";
}
function drawEndCard(g, h, t, a, cy) {
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  const ta = clamp((t - h.t0) / 0.6);
  g.globalAlpha = a * ta; g.font = `600 230px ${SERIF}`; g.letterSpacing = "40px"; g.fillText("KOREA", W / 2 + 20, cy + 60 - 12 * (1 - easeOut(ta)));
  g.shadowBlur = 0; g.fillStyle = RED; const u = easeOut((t - h.t0 - 0.5) / 0.6); g.fillRect(W / 2 - 150, cy + 110, 300 * u, 6);
  g.fillStyle = PAPER; g.shadowBlur = 20;
  const ca = clamp((t - h.t0 - 1.0) / 0.6); g.globalAlpha = a * ca * 0.85;
  g.font = `500 30px ${MONO}`; g.letterSpacing = "3px";
  ["IMAGES: WIKIMEDIA COMMONS", "TAEWANGKOREA, YUMETO, TRAINHOLIC (CC BY-SA 4.0)", "BRADY BELLINI (CC0), PUBLIC DOMAIN SCANS",
   "MAP: NATURAL EARTH. MUSIC AND SOUND MADE IN CODE"].forEach((l, i) => g.fillText(l, W / 2, cy + 230 + i * 46));
  g.textAlign = "left";
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

// ---------- sound cue list (used by the audio build, not by the picture) ----------
export function audioEvents() {
  const ev = [];
  for (let i = 0; i + 1 < ST.length; i++) { // camera moves
    const s = ST[i], n = ST[i + 1];
    if (n.arrive > DURATION) { ev.push({ type: "whoosh", t: s.depart, dur: DURATION - s.depart, soft: 1 }); continue; }
    if (s.name === "Han0") continue;
    ev.push({ type: "whoosh", t: s.depart, dur: n.arrive - s.depart });
  }
  for (const p of PINS) ev.push({ type: "pin", t: p.on });
  for (const o of OBJECTS) {
    ev.push({ type: "paper", t: o.td + 0.3 });
    if (o.caption) [...o.caption].forEach((c, i) => ev.push({ type: "key", t: o.capT + i * 0.045 }));
    ev.push({ type: "paper_soft", t: o.ft + 0.25 });
  }
  for (const h of HEROES) {
    if (h.kind === "type") [...h.text].forEach((c, i) => { if (c !== " ") ev.push({ type: "key", t: h.t0 + i * 0.075 }); });
    if (h.kind === "hangeul") for (let i = 0; i < 6; i++) ev.push({ type: "key", t: h.t0 + i * 0.085 });
    if (h.kind === "circle") ev.push({ type: "pen", t: h.circle, dur: 0.5 });
    if (h.kind === "ships") { ev.push({ type: "slam", t: h.t0 + 0.11 }); ev.push({ type: "paper_soft", t: h.t133 }); }
    if (h.kind === "stamp") ev.push({ type: "stamp", t: h.t0 + 0.11 });
  }
  ev.push({ type: "pen", t: LINE38.t0, dur: 0.5 });
  for (const ar of ARROWS) ev.push({ type: "pen", t: ar.t0, dur: 0.7 });
  for (let i = 0; i < 12; i++) ev.push({ type: "key", t: HEROES[0].t0 + i * 0.07 });
  ev.push({ type: "pen", t: TERR_IN + 0.3, dur: 1.3, soft: 1 });
  return ev.sort((a, b) => a.t - b.t);
}
