import { init, drawFrame, setDuration, camSpeed, W, H, FPS } from "./scene.js";
window.camSpeed = camSpeed;
let canvas, ctx, scale = 1;
window.setup = async (w, duration) => {
  const faces = ["600 100px 'Cormorant Garamond'", "500 40px 'IBM Plex Mono'", "600 40px 'IBM Plex Mono'", "700 100px 'Noto Serif KR'"];
  for (const f of faces) await document.fonts.load(f, f.includes("KR") ? "한글ㅎㄱ하그" : "ABC123°,'");
  scale = w / W; canvas = document.getElementById("c"); canvas.width = w; canvas.height = Math.round(H * scale);
  ctx = canvas.getContext("2d"); setDuration(duration); init(); return true;
};
window.frame = (i, fmt = "image/png") => { drawFrame(ctx, i / FPS, scale); return canvas.toDataURL(fmt).split(",")[1]; };
