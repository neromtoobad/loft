// Connected components of an alpha channel, shared by the sprite slicer and the
// logo. A shape that crosses into a neighbouring cell still belongs to the cell
// holding its centre.
export const ALPHA = 40; // what counts as "the character"

export type Box = { x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number };

export function components(alpha: Uint8Array, w: number, h: number): Box[] {
  const label = new Int32Array(w * h);
  const boxes: Box[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (alpha[start] < ALPHA || label[start]) continue;
    const id = boxes.length + 1;
    const b: Box = { x0: w, y0: h, x1: 0, y1: 0, area: 0, cx: 0, cy: 0 };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      b.area++;
      b.cx += x;
      b.cy += y;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      const n = [p - 1, p + 1, p - w, p + w];
      const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
      for (let i = 0; i < 4; i++) {
        const q = n[i];
        if (ok[i] && !label[q] && alpha[q] >= ALPHA) {
          label[q] = id;
          stack[top++] = q;
        }
      }
    }
    b.cx /= b.area;
    b.cy /= b.area;
    boxes.push(b);
  }
  return boxes;
}

