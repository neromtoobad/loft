import type { ReactNode } from "react";
import { navigate } from "../app.tsx";
import { Icon } from "../icons.tsx";
import { ApiError } from "../lib/api.ts";

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
