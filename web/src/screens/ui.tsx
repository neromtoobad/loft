import type { ReactNode } from "react";
import { navigate } from "../app.tsx";
import { Icon } from "../icons.tsx";
import { ApiError } from "../lib/api.ts";
import { ngn, usdParts } from "../lib/format.ts";
import { isCreature } from "../cast.tsx";

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const err = e as { name?: string; code?: string; message?: string };
  if (err?.name === "NotAllowedError" || err?.code === "PASSKEY_OPERATION_FAILED") return "Passkey was cancelled.";
  if (err?.code === "PRF_UNAVAILABLE")
    return "This device's passkeys can't make Loft keys yet. Try iCloud Keychain on iOS 18+, Google Password Manager on Android, or 1Password.";
  return err?.message ?? "Something went wrong.";
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

export function TopBar({ title, back = "/" }: { title: string; back?: string }) {
  return (
    <header className="topbar">
      <button className="icon" onClick={() => navigate(back)} aria-label="Back">
        <Icon.back />
      </button>
      <h2>{title}</h2>
      <span className="icon" />
    </header>
  );
}

/** A plain promise about who holds the money. Only say what the contracts actually guarantee. */
export function Assure({ children }: { children: ReactNode }) {
  return (
    <p className="assure">
      <Icon.lock size={16} />
      <span>{children}</span>
    </p>
  );
}

export function Sheet({ children }: { children: ReactNode }) {
  return <div className="sheet">{children}</div>;
}

export function TxLink({ hash, explorer }: { hash: string; explorer?: string }) {
  if (!explorer) return null;
  return (
    <a className="txlink" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      View on Monad ↗
    </a>
  );
}

/** A money figure with quiet cents: $150<.00>. Naira has no cents to quiet. */
export function Money({ value, currency = "USD" }: { value: number; currency?: "USD" | "NGN" }) {
  if (currency === "NGN") return <span className="money">{ngn(value)}</span>;
  const [whole, cents] = usdParts(value);
  return (
    <span className="money">
      {whole}
      <span className="cents">{cents}</span>
    </span>
  );
}

/** Small uppercase monospace label, the way the screen names its parts. */
export function Label({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className="label">
      {live && <span className="dot-live" aria-hidden />}
      {children}
    </span>
  );
}

/** One reassurance with its icon, for the short lists that say who holds the money. */
export function Point({ icon, children }: { icon: "lock" | "check" | "phone" | "dollar" | "calendar"; children: ReactNode }) {
  const Glyph = Icon[icon];
  return (
    <p className="point">
      <span className="point-icon">
        <Glyph size={15} />
      </span>
      <span>{children}</span>
    </p>
  );
}

/** The mark: a loft roof over a doorway, with the courier's orange at its heart. */
export function LoftMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden>
      <path d="M3 13.5 14 4l11 9.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 12v11.5h14V12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="14" cy="15.5" r="2.3" fill="var(--accent)" />
    </svg>
  );
}

/** A postage stamp with perforated edges, carrying someone's creature (or the Loft mark). */
export function Stamp({ kind, value }: { kind?: string | null; value?: string }) {
  return (
    <span className="stamp" data-creature={isCreature(kind) ? kind : undefined} aria-hidden>
      <span className="stamp-face">{isCreature(kind) ? <img src={`/cast/${kind}/idle.webp`} alt="" /> : <LoftMark size={30} />}</span>
      {value && <span className="stamp-value">{value}</span>}
    </span>
  );
}

/** A postmark: two rings with the place and the time, and the cancel lines trailing off. */
export function Postmark({ top, bottom }: { top: string; bottom: string }) {
  return (
    <svg className="postmark" viewBox="0 0 132 66" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="99" cy="33" r="29" />
        <circle cx="99" cy="33" r="23" strokeWidth="0.8" />
        <path d="M2 17q7-5 14 0t14 0 14 0 14 0 14 0" />
        <path d="M2 27q7-5 14 0t14 0 14 0 14 0 14 0" />
        <path d="M2 37q7-5 14 0t14 0 14 0 14 0 14 0" />
        <path d="M2 47q7-5 14 0t14 0 14 0 14 0 14 0" />
      </g>
      <text x="99" y="30" textAnchor="middle">
        {top}
      </text>
      <text x="99" y="42" textAnchor="middle">
        {bottom}
      </text>
    </svg>
  );
}

/** Today as a postmark date: "11 OCT". */
export function stampDate(d = new Date()) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
}
