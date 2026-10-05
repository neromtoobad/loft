// The Loft logo: the courier perched on a loft roof, cut at full resolution
// from the background-removed pose sheet (art/sheets/cut/pigeon.png, pose 3
// of 2 rows × 3 columns) and set on the app's sand colour. Writes art/logo.png.
import sharp from "sharp";

const SIZE = 1024;
const SAND = "#f7f3ec";
const ALPHA = 40;

const { data, info } = await sharp("art/sheets/cut/pigeon.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h, channels } = info;

// The perch pose sits in row 0, column 2. Bound everything opaque in that cell,
// ignoring stray specks that don't reach a few pixels.
const cx0 = Math.floor((2 * w) / 3);
const cy1 = Math.floor(h / 2);
let x0 = w, y0 = h, x1 = 0, y1 = 0;
const rows = new Uint32Array(h);
const cols = new Uint32Array(w);
for (let y = 0; y < cy1; y++)
  for (let x = cx0; x < w; x++)
    if (data[(y * w + x) * channels + 3] >= ALPHA) {
      rows[y]++;
      cols[x]++;
    }
for (let y = 0; y < cy1; y++) if (rows[y] > 3) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
for (let x = cx0; x < w; x++) if (cols[x] > 3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }

const bird = await sharp("art/sheets/cut/pigeon.png")
  .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
  .resize({ height: Math.round(SIZE * 0.78), width: Math.round(SIZE * 0.84), fit: "inside" })
  .png()
  .toBuffer();
const meta = await sharp(bird).metadata();

await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: SAND } })
  .composite([{ input: bird, left: Math.round((SIZE - meta.width!) / 2), top: Math.round((SIZE - meta.height!) / 2 + SIZE * 0.02) }])
  .png({ compressionLevel: 9 })
  .toFile("art/logo.png");

console.log(`art/logo.png ${SIZE}×${SIZE}, bird ${meta.width}×${meta.height} from ${x1 - x0 + 1}×${y1 - y0 + 1}`);
