// Cuts each background-removed pose sheet (art/sheets/cut, 2 rows × 3 columns)
// into one trimmed WebP sprite per pose under web/public/cast/<name>/.
//
// Shapes are found as connected components of the alpha channel and assigned
// to the grid cell holding their centre, so a wing that crosses a cell line
// still belongs to its own pose. Anything far smaller than the pose itself
// (the "(1)" labels) is dropped.
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { ALPHA, components } from "./components.ts";

const POSES: Record<string, string[]> = {
  pigeon: ["fly-up", "fly-down", "perch", "handoff", "salute", "sleep"],
  cheetah: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  fennec: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  lion: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  parrot: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  pangolin: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  tortoise: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  hornbill: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  badger: ["idle", "wave", "catch", "cheer", "wait", "worried"],
  chameleon: ["idle", "wave", "catch", "cheer", "wait", "worried"],
};
const ROWS = 2;
const COLS = 3;
const KEEP = 0.03; // components under 3% of the pose's main shape are labels or dust
const PAD = 16;
const HEIGHT = 480; // sprite height in the app, before devicePixelRatio

const only = process.argv.slice(2);
for (const [name, poses] of Object.entries(POSES)) {
  if (only.length && !only.includes(name)) continue;
  const src = `art/sheets/cut/${name}.png`;
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * channels + 3];

  const comps = components(alpha, w, h);
  const outDir = `web/public/cast/${name}`;
  mkdirSync(outDir, { recursive: true });

  for (let cell = 0; cell < ROWS * COLS; cell++) {
    const r = Math.floor(cell / COLS);
    const c = cell % COLS;
    const mine = comps.filter(
      (b) => Math.floor((b.cx / w) * COLS) === c && Math.floor((b.cy / h) * ROWS) === r,
    );
    const biggest = Math.max(...mine.map((b) => b.area));
    const kept = mine.filter((b) => b.area >= biggest * KEEP);
    const x0 = Math.max(0, Math.min(...kept.map((b) => b.x0)) - PAD);
    const y0 = Math.max(0, Math.min(...kept.map((b) => b.y0)) - PAD);
    const x1 = Math.min(w - 1, Math.max(...kept.map((b) => b.x1)) + PAD);
    const y1 = Math.min(h - 1, Math.max(...kept.map((b) => b.y1)) + PAD);

    // Erase what we dropped (labels) inside the crop before exporting.
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const crop = Buffer.alloc(cw * ch * 4);
    const keepSet = new Set(kept);
    const dropped = mine.filter((b) => !keepSet.has(b));
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        const s = (sy * w + sx) * channels;
        const d = (y * cw + x) * 4;
        const inDropped = dropped.some((b) => sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1);
        crop[d] = data[s];
        crop[d + 1] = data[s + 1];
        crop[d + 2] = data[s + 2];
        crop[d + 3] = inDropped ? 0 : data[s + 3];
      }
    }
    const out = `${outDir}/${poses[cell]}.webp`;
    await sharp(crop, { raw: { width: cw, height: ch, channels: 4 } })
      .resize({ height: HEIGHT, withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 90, effort: 6 })
      .toFile(out);
    console.log(`${out}  ${cw}×${ch}  kept ${kept.length}/${mine.length} shapes`);
  }
}
