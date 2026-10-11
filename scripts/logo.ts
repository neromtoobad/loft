// The Loft logo: the courier perched on a loft roof, cut at full resolution
// from the background-removed pose sheet (art/sheets/cut/pigeon.png, pose 3
// of 2 rows × 3 columns) and set on the app's sand colour. Writes art/logo.png.
import sharp from "sharp";
import { components } from "./components.ts";

const SIZE = 1024;
const SAND = "#f7f3ec";
const KEEP = 0.03; // like the slicer: drop labels and stray bits from neighbouring poses

const src = "art/sheets/cut/pigeon.png";
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h, channels } = info;
const alpha = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) alpha[i] = data[i * channels + 3];

// Shapes whose centre is in row 0, column 2 (the perch pose).
const mine = components(alpha, w, h).filter((b) => Math.floor((b.cx / w) * 3) === 2 && Math.floor((b.cy / h) * 2) === 0);
const biggest = Math.max(...mine.map((b) => b.area));
const kept = mine.filter((b) => b.area >= biggest * KEEP);
const x0 = Math.min(...kept.map((b) => b.x0));
const y0 = Math.min(...kept.map((b) => b.y0));
const x1 = Math.max(...kept.map((b) => b.x1));
const y1 = Math.max(...kept.map((b) => b.y1));

// Keep only pixels that belong to a kept shape's box, so nothing from the next pose sneaks in.
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const crop = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++)
  for (let x = 0; x < cw; x++) {
    const sx = x0 + x;
    const sy = y0 + y;
    const s = (sy * w + sx) * channels;
    const d = (y * cw + x) * 4;
    const inside = kept.some((b) => sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1);
    crop[d] = data[s];
    crop[d + 1] = data[s + 1];
    crop[d + 2] = data[s + 2];
    crop[d + 3] = inside ? data[s + 3] : 0;
  }

const bird = await sharp(crop, { raw: { width: cw, height: ch, channels: 4 } })
  .resize({ height: Math.round(SIZE * 0.78), width: Math.round(SIZE * 0.84), fit: "inside", withoutEnlargement: true })
  .png()
  .toBuffer();
const meta = await sharp(bird).metadata();

await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: SAND } })
  .composite([{ input: bird, left: Math.round((SIZE - meta.width!) / 2), top: Math.round((SIZE - meta.height!) / 2 + SIZE * 0.02) }])
  .png({ compressionLevel: 9 })
  .toFile("art/logo.png");

console.log(`art/logo.png ${SIZE}×${SIZE}, bird ${meta.width}×${meta.height} from ${cw}×${ch}, kept ${kept.length}/${mine.length} shapes`);
