// A postcard for the moment money lands: airmail border, the recipient's
// creature on the stamp, a postmark with the real confirmation time, and the
// amount. Drawn on a canvas so it can be shared as an image on WhatsApp.

export type PostcardInput = {
  amount: string; // already formatted, e.g. "$20.00"
  naira?: string; // e.g. "≈ ₦26,640"
  from: string;
  to: string;
  creature?: string | null; // the recipient's
  seconds: string; // e.g. "1.9s"
  hash: string;
  note?: string;
};

const W = 1200;
const H = 800;
const RED = "#e4572e";
const BLUE = "#24325c";
const INK = "#16120e";
const PAPER = "#fbf8f1";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function stripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, band: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.rect(x + band, y + band, w - band * 2, h - band * 2);
  ctx.clip("evenodd");
  const step = 30;
  for (let i = -h, k = 0; i < w + h; i += step, k++) {
    ctx.fillStyle = k % 2 === 0 ? RED : BLUE;
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + 10, y);
    ctx.lineTo(x + i + 10 - h, y + h);
    ctx.lineTo(x + i - h, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function stamp(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((3 * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  // Perforated edge: the stamp body, then holes punched along every side.
  ctx.fillStyle = "#f3ead9";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  const r = 6;
  for (let i = 0; i <= w; i += 16) {
    ctx.beginPath();
    ctx.arc(i, 0, r, 0, Math.PI * 2);
    ctx.arc(i, h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let j = 0; j <= h; j += 16) {
    ctx.beginPath();
    ctx.arc(0, j, r, 0, Math.PI * 2);
    ctx.arc(w, j, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fde7c8";
  ctx.fillRect(14, 14, w - 28, h - 58);
  if (img) {
    const box = { x: 14, y: 14, w: w - 28, h: h - 58 };
    const scale = Math.max(box.w / img.width, box.h / (img.height * 0.62));
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y - dh * 0.04, dw, dh);
    ctx.restore();
  }
  ctx.fillStyle = INK;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("LOFT · AIRMAIL", w / 2, h - 20);
  ctx.restore();
}

function postmark(ctx: CanvasRenderingContext2D, cx: number, cy: number, top: string, bottom: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.strokeStyle = "rgba(22,18,14,0.55)";
  ctx.fillStyle = "rgba(22,18,14,0.6)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    const y = -36 + k * 24;
    for (let x = -260; x <= -80; x += 2) ctx.lineTo(x, y + Math.sin(x / 12) * 6);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText(top, 0, -6);
  ctx.fillText(bottom, 0, 22);
  ctx.restore();
}

export async function drawPostcard(p: PostcardInput): Promise<Blob> {
  await Promise.all([
    document.fonts.load('80px "Instrument Serif"'),
    document.fonts.load('italic 44px "Instrument Serif"'),
    document.fonts.load('500 18px "IBM Plex Mono"'),
    document.fonts.load('400 26px "Inter"'),
  ]).catch(() => undefined);
  const img = p.creature ? await loadImage(`/cast/${p.creature}/cheer.webp`) : null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  stripes(ctx, 0, 0, W, H, 22);

  // Divider, like the back of a postcard.
  ctx.strokeStyle = "rgba(22,18,14,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(760, 90);
  ctx.lineTo(760, H - 90);
  ctx.stroke();

  ctx.fillStyle = "rgba(22,18,14,0.55)";
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillText(`PAR AVION · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}`, 80, 120);

  ctx.fillStyle = INK;
  ctx.font = '400 150px "Instrument Serif", Georgia, serif';
  ctx.fillText(p.amount, 72, 285);
  if (p.naira) {
    ctx.fillStyle = "rgba(22,18,14,0.55)";
    ctx.font = '400 30px "Inter", system-ui, sans-serif';
    ctx.fillText(p.naira, 82, 335);
  }

  ctx.fillStyle = INK;
  ctx.font = 'italic 54px "Instrument Serif", Georgia, serif';
  ctx.fillText(`From ${p.from}, to ${p.to}.`, 80, 440);
  if (p.note) {
    ctx.fillStyle = "rgba(22,18,14,0.75)";
    ctx.font = 'italic 38px "Instrument Serif", Georgia, serif';
    const note = p.note.length > 46 ? `${p.note.slice(0, 45)}…` : p.note;
    ctx.fillText(`“${note}”`, 80, 500);
  }

  ctx.fillStyle = "rgba(22,18,14,0.6)";
  ctx.font = '400 26px "Inter", system-ui, sans-serif';
  ctx.fillText(`Landed in ${p.seconds} on Monad. No fees, no bank.`, 80, 600);
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText(`TX ${p.hash.slice(0, 10)}…${p.hash.slice(-6)}`, 80, 640);

  ctx.fillStyle = INK;
  ctx.font = '400 40px "Instrument Serif", Georgia, serif';
  ctx.fillText("Loft", 80, 712);
  ctx.fillStyle = "rgba(22,18,14,0.55)";
  ctx.font = '400 22px "Inter", system-ui, sans-serif';
  ctx.fillText("send dollars home in one tap", 160, 710);

  stamp(ctx, img, 900, 100, 210, 250);
  postmark(ctx, 905, 360, "LANDED", p.seconds.toUpperCase());

  // Address lines on the right half.
  ctx.strokeStyle = "rgba(22,18,14,0.18)";
  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(820, 520 + k * 70);
    ctx.lineTo(1120, 520 + k * 70);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = 'italic 44px "Instrument Serif", Georgia, serif';
  ctx.fillText(p.to, 830, 508);
  ctx.fillStyle = "rgba(22,18,14,0.55)";
  ctx.font = '400 24px "Inter", system-ui, sans-serif';
  ctx.fillText("Home", 830, 578);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no postcard"))), "image/png"));
}

/** Shares the postcard as an image where the browser can, else downloads it. */
export async function sharePostcard(p: PostcardInput) {
  const blob = await drawPostcard(p);
  const file = new File([blob], "loft-postcard.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: `${p.amount} from ${p.from} to ${p.to}, landed in ${p.seconds} on Loft.` }).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "loft-postcard.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
