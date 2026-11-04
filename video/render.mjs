// Usage:
//   node render.mjs stills <width> <outdir> t1 t2 ...        -> PNG stills at given times
//   node render.mjs video <width> <outdir> [endTime]         -> resumable 300-frame segments + concat + audio
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const FPS = 30, CHUNK = 300;
const wav = path.join(repo, "assets/korea/voiceover.wav");
const beats = JSON.parse(fs.readFileSync(path.join(repo, "beats.json"), "utf8"));

function wavDuration(p) {
  const b = fs.readFileSync(p); const sr = b.readUInt32LE(24), bits = b.readUInt16LE(34), ch = b.readUInt16LE(22);
  let o = 12; while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "data") return sz / (sr * ch * bits / 8); o += 8 + sz; }
  throw new Error("no data chunk");
}
const DUR = wavDuration(wav);
const NFRAMES = Math.round(DUR * FPS);

async function openPages(n, width) {
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--allow-file-access-from-files"] });
  const pages = [];
  for (let i = 0; i < n; i++) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    await page.goto("file://" + path.join(here, "index.html"));
    await page.evaluate(([w, d]) => window.setup(w, d), [width, DUR]);
    pages.push(page);
  }
  return { browser, pages };
}

async function stills(width, outdir, times) {
  fs.mkdirSync(outdir, { recursive: true });
  const { browser, pages } = await openPages(1, width);
  for (const t of times) {
    const b64 = await pages[0].evaluate((i) => window.frame(i), Math.round(t * FPS));
    fs.writeFileSync(path.join(outdir, `t${t.toFixed(2).padStart(6, "0")}.png`), Buffer.from(b64, "base64"));
  }
  await browser.close();
}

function renderSegment(page, f0, f1, out) {
  return new Promise(async (resolve, reject) => {
    const tmp = out + ".part.mp4";
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "png", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-threads", "1", "-r", String(FPS), tmp], { stdio: ["pipe", "inherit", "inherit"] });
    ff.on("error", reject);
    ff.on("close", (code) => { if (code === 0) { fs.renameSync(tmp, out); resolve(); } else reject(new Error("ffmpeg " + code)); });
    try {
      for (let i = f0; i < f1; i++) {
        const b64 = await page.evaluate((k) => window.frame(k), i);
        if (!ff.stdin.write(Buffer.from(b64, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
      }
      ff.stdin.end();
    } catch (e) { ff.kill(); reject(e); }
  });
}

async function video(width, outdir, endTime) {
  const segdir = path.join(outdir, "segments"); fs.mkdirSync(segdir, { recursive: true });
  for (const f of fs.readdirSync(segdir)) if (f.endsWith(".part.mp4")) fs.unlinkSync(path.join(segdir, f));
  const nframes = endTime ? Math.round(endTime * FPS) : NFRAMES;
  const jobs = [];
  for (let f0 = 0, k = 0; f0 < nframes; f0 += CHUNK, k++) {
    const out = path.join(segdir, `seg_${String(k).padStart(3, "0")}.mp4`);
    if (!fs.existsSync(out)) jobs.push({ f0, f1: Math.min(nframes, f0 + CHUNK), out });
  }
  console.log(`${nframes} frames, ${jobs.length} segments to render`);
  if (jobs.length) {
    const n = Math.min(jobs.length, Math.max(1, os.cpus().length - 1));
    const { browser, pages } = await openPages(n, width);
    const t0 = Date.now();
    await Promise.all(pages.map(async (page) => {
      while (jobs.length) { const j = jobs.shift(); await renderSegment(page, j.f0, j.f1, j.out); console.log("done", path.basename(j.out), ((Date.now() - t0) / 1000).toFixed(0) + "s"); }
    }));
    await browser.close();
  }
  // concat
  const segs = fs.readdirSync(segdir).filter((f) => /^seg_\d+\.mp4$/.test(f)).sort();
  const list = path.join(outdir, "list.txt");
  fs.writeFileSync(list, segs.map((s) => `file '${path.join(segdir, s)}'`).join("\n"));
  const silent = path.join(outdir, "video_silent.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  // audio: voiceover plus a low thud on the stamp
  const stamp = beats.find((b) => b.id === 10).cue_time;
  const audioDur = endTime ?? DUR;
  const thud = "aevalsrc='0.9*exp(-9*t)*sin(2*PI*52*t)+0.35*exp(-22*t)*sin(2*PI*96*t)':s=24000:d=0.7";
  return { silent, stamp, audioDur, thud };
}

async function finish(outfile, { silent, stamp, audioDur, thud }) {
  const ms = Math.round(stamp * 1000);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-f", "lavfi", "-i", thud,
    "-filter_complex", `[2:a]lowpass=f=180,adelay=${ms}|${ms},volume=0.9[th];[1:a][th]amix=inputs=2:duration=first:normalize=0,atrim=0:${audioDur.toFixed(3)}[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outfile]);
  console.log("wrote", outfile);
}

const [mode, w, outdir, ...rest] = process.argv.slice(2);
if (mode === "stills") await stills(+w, outdir, rest.map(Number));
else if (mode === "video") {
  const endTime = rest[0] ? +rest[0] : undefined;
  const r = await video(+w, outdir, endTime);
  await finish(rest[1] ?? path.join(outdir, "out.mp4"), r);
} else console.log("modes: stills | video");
