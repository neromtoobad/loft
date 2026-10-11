// Loft's mark: the door of a pigeon loft (a rounded square with an arched
// doorway open at the bottom) with the courier home inside, as an orange coin.
// One geometry, used by the in-app mark, the icons and the logo files.

export const BRAND = {
  ink: "#0b0b0c",
  paper: "#f2f2f0",
  orange: "#ff5b1f",
} as const;

/** In a 100×100 box: the square spans 10–90. */
const R = 24; // corner radius
const DOOR = 32; // doorway width
const ARCH_Y = 54; // centre of the doorway's arch
export const COIN = { cx: 50, cy: ARCH_Y, r: 9 };

/**
 * The outline of the mark with the doorway cut out, as one path. `inset` is
 * where the square starts (10 leaves a margin; 0 fills the box), and
 * `radius` overrides the corner radius (0 for a full-bleed app icon, which
 * the phone rounds itself).
 */
export function markPath(inset = 10, radius = R): string {
  const a = inset;
  const b = 100 - inset;
  const r = radius;
  const dl = 50 - DOOR / 2;
  const dr = 50 + DOOR / 2;
  const half = DOOR / 2;
  const corner = (x: number, y: number) => (r ? `A${r} ${r} 0 0 1 ${x} ${y}` : `L${x} ${y}`);
  return [
    `M${a} ${a + r}`,
    corner(a + r, a),
    `H${b - r}`,
    corner(b, a + r),
    `V${b - r}`,
    corner(b - r, b),
    `H${dr} V${ARCH_Y} A${half} ${half} 0 0 0 ${dl} ${ARCH_Y} V${b}`,
    `H${a + r}`,
    corner(a, b - r),
    "Z",
  ].join(" ");
}

/** The doorway alone, for filling it with a colour where transparency won't do. */
export function doorPath(bottom = 90): string {
  const dl = 50 - DOOR / 2;
  const dr = 50 + DOOR / 2;
  const half = DOOR / 2;
  return `M${dr} ${bottom} V${ARCH_Y} A${half} ${half} 0 0 0 ${dl} ${ARCH_Y} V${bottom} Z`;
}
