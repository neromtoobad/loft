import { useState } from "react";
import { navigate } from "../app.tsx";
import { HIDDEN_LIMIT_MS, IDLE_LIMIT_MS, PROMPT_FREE_LIMIT_USD, exportPhrase } from "../lib/keys.ts";
import { short, usd } from "../lib/format.ts";
import { useLoft } from "../state.tsx";
import { CreaturePicker, isCreature } from "../cast.tsx";
import { ErrorLine, TopBar, errorText } from "./ui.tsx";

export function Me() {
  const { vault, session, config, setHandle, setCharacter, lock } = useLoft();
  const [handle, setHandleInput] = useState(vault?.handle ?? "");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!vault || !session) return null;

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="me">
      <TopBar title={vault.name || "You"} />

      <div className="card">
        <h3>Your creature</h3>
        <p className="muted small">It's who people see when they send to you, and when you send to them.</p>
        <CreaturePicker
          value={isCreature(vault.character) ? vault.character : null}
          onChange={(c) => run(() => setCharacter(c))}
        />
      </div>

      <div className="card">
        <h3>Your Loft name</h3>
        <p className="muted small">People can send to @name instead of a long address.</p>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await setHandle(handle.replace(/^@/, "").toLowerCase());
              setSaved(true);
            });
          }}
        >
          <input value={handle} onChange={(e) => setHandleInput(e.target.value)} placeholder="@yourname" pattern="@?[A-Za-z0-9_]{3,20}" />
          <button className="secondary small">{saved ? "Saved" : "Save"}</button>
        </form>
        <p className="muted small mono">{short(session.account.address)}</p>
      </div>

      <div className="card">
        <h3>How your passkey protects you</h3>
        <ul className="policy">
          <li>Loft can't move your money. Every payment needs a signature only your passkey can make.</li>
          <li>Sends up to {usd(PROMPT_FREE_LIMIT_USD)} go through while Loft is open. Anything larger asks for your passkey again.</li>
          <li>Loft locks itself after {IDLE_LIMIT_MS / 60000} minutes idle, or {HIDDEN_LIMIT_MS / 60000} minutes in the background.</li>
          <li>Your keys are never stored, not on this phone and not on our servers. Each unlock rebuilds them from your passkey.</li>
          <li>Your contacts and notes are encrypted with a separate key from the same passkey. We can't read them.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Take your money anywhere</h3>
        <p className="muted small">
          Your Loft is a standard wallet we never control. If Loft shut down tomorrow, this phrase would open your money in
          MetaMask or any other wallet. Keep it secret.
        </p>
        {phrase ? (
          <p className="phrase mono">{phrase}</p>
        ) : (
          <button className="secondary small" onClick={() => run(async () => setPhrase(await exportPhrase(session)))}>
            Show recovery phrase
          </button>
        )}
      </div>

      <ErrorLine error={error} />
      <button
        className="ghost"
        onClick={() => {
          lock();
          navigate("/");
        }}
      >
        Lock Loft
      </button>
      <p className="fineprint center">
        {config?.network === "mainnet" ? "Monad mainnet" : "Monad testnet"} · AUSD by Agora · passkeys by Mera
      </p>
    </section>
  );
}
