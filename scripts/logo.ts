// Draws every Loft brand file from the one geometry in shared/brand.ts:
// the favicon, the app icons, the social preview and the logo files.
//
//   npx tsx scripts/logo.ts
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { BRAND, COIN, doorPath, markPath } from "../shared/brand.ts";

const { ink, paper, orange } = BRAND;
const FONT = "art/fonts/Geist-500.ttf";

function png(svg: string, out: string) {
  const data = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Geist" } }).render().asPng();
  writeFileSync(out, data);
  console.log(`${out}  ${(data.length / 1024).toFixed(0)} KB`);
}

const coin = `<circle cx="${COIN.cx}" cy="${COIN.cy}" r="${COIN.r}" fill="${orange}"/>`;

/** The mark in its 100×100 box, at (x, y) and `size` pixels. `door` fills the doorway (else it's see-through). */
function mark(x: number, y: number, size: number, door?: string) {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">
    <path d="${markPath()}" fill="${ink}"/>${door ? `<path d="${doorPath()}" fill="${door}"/>` : ""}${coin}</g>`;
}

const wordmark = (x: number, y: number, size: number, fill = ink, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="Geist" font-weight="500" font-size="${size}" letter-spacing="${-size * 0.04}" fill="${fill}" text-anchor="${anchor}">Loft</text>`;

// Favicon: the mark alone, white instead of black when the browser is dark.
writeFileSync(
  "web/public/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 80 80"><style>path{fill:${ink}}@media (prefers-color-scheme:dark){path{fill:#fff}}</style><path d="${markPath()}"/>${coin}</svg>\n`,
);
console.log("web/public/icon.svg");

// Home-screen icons. The phone rounds the corners itself, so these fill the
// square: black, with the doorway open at the bottom edge and the coin inside.
const fullBleed = (px: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="10 10 80 80">
    <path d="${markPath(10, 0)}" fill="${ink}"/><path d="${doorPath()}" fill="${paper}"/>${coin}</svg>`;
png(fullBleed(180), "web/public/icon-180.png");
png(fullBleed(512), "web/public/icon-maskable-512.png");
// Install icons for browsers that show them as-is: the rounded mark itself.
const rounded = (px: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="10 10 80 80"><path d="${markPath()}" fill="${ink}"/><path d="${doorPath()}" fill="${paper}"/>${coin}</svg>`;
png(rounded(192), "web/public/icon-192.png");
png(rounded(512), "web/public/icon-512.png");

// The hackathon logo: mark over the wordmark, square, on paper.
png(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${paper}"/>
    ${mark(512 - 220, 210, 440, paper)}${wordmark(512, 820, 170, ink, "middle")}</svg>`,
  "art/logo.png",
);
// The mark alone, and a wide lockup for headers and slides.
png(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${paper}"/>${mark(112, 112, 800, paper)}</svg>`, "art/logo-mark.png");
png(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="560"><rect width="1600" height="560" fill="${paper}"/>
    ${mark(170, 100, 360, paper)}${wordmark(600, 375, 260)}</svg>`,
  "art/logo-wide.png",
);

// Link previews (WhatsApp, X, iMessage): what people see before they open a Loft link.
png(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${paper}"/>
    ${mark(96, 96, 150, paper)}${wordmark(268, 205, 92)}
    <text x="96" y="400" font-family="Geist" font-weight="500" font-size="76" letter-spacing="-3.4" fill="${ink}">Send dollars home</text>
    <text x="96" y="488" font-family="Geist" font-weight="500" font-size="76" letter-spacing="-3.4" fill="${ink}" fill-opacity="0.45">in one tap.</text>
    <circle cx="104" cy="551" r="8" fill="#2fbf71"/>
    <text x="124" y="560" font-family="Geist" font-weight="500" font-size="26" letter-spacing="2" fill="${ink}" fill-opacity="0.55">LIVE ON MONAD · AUSD · NO APP NEEDED</text></svg>`,
  "web/public/og.png",
);

const manifest = JSON.parse(readFileSync("web/public/manifest.webmanifest", "utf8"));
console.log(`manifest icons: ${manifest.icons.map((i: { src: string }) => i.src).join(", ")}`);
