import { useState } from "react";
import { FEATURED, type Creature, CourierSprite, CreatureAvatar, CreaturePicker } from "../cast.tsx";
import { useLoft } from "../state.tsx";
import { ErrorLine, Label, LoftMark, Point, errorText } from "./ui.tsx";

export function Welcome({ returning }: { returning: boolean }) {
  const { create, unlock, busy } = useLoft();
  const [name, setName] = useState("");
  const [creature, setCreature] = useState<Creature | null>(null);
  const [mode, setMode] = useState<"start" | "create">("start");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="welcome">
      <header className="brand-bar">
        <span className="brand">
          <LoftMark /> Loft
        </span>
        <button className="link-button" onClick={() => run(unlock)} disabled={Boolean(busy)}>
          {returning ? "Unlock" : "Sign in"}
        </button>
      </header>

      <div className="hero welcome-hero" aria-label="Loft">
        <div className="welcome-courier" aria-hidden>
          <CourierSprite pose="fly-up" size={150} />
        </div>
        <Label live>Live on Monad · AUSD</Label>
        <h1 className="display">
          Send dollars home <em>in one tap.</em>
        </h1>
        <div className="hero-points">
          <Point icon="lock">You hold your money, not us</Point>
          <Point icon="dollar">Family keeps real dollars</Point>
          <Point icon="phone">No bank or app needed to receive</Point>
        </div>
        <div className="faces">
          <span className="stack-avatars" aria-hidden>
            {FEATURED.map((c) => (
              <CreatureAvatar key={c} kind={c} name={c} />
            ))}
          </span>
          <span>For families in Lagos, London, Houston and everywhere between</span>
        </div>
      </div>

      <div className="card form-card">
        <Label>Get started</Label>
        <h2>{mode === "create" ? "Create your Loft" : "One passkey. That's the account."}</h2>
        <p className="muted">No seed phrase, no password, no app store. Your face or fingerprint is the only key.</p>
        {mode === "create" ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && creature) run(() => create(name.trim(), creature));
            }}
          >
            <label className="field">
              <span>What should we call you?</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your first name"
                autoComplete="given-name"
                maxLength={40}
              />
            </label>
            <span className="field-label">Pick your creature</span>
            <CreaturePicker value={creature} onChange={setCreature} />
            <button className="primary big" disabled={!name.trim() || !creature || Boolean(busy)}>
              Create with passkey
            </button>
            <button type="button" className="ghost" onClick={() => setMode("start")}>
              Back
            </button>
          </form>
        ) : (
          <div className="stack">
            <button className="primary big" onClick={() => setMode("create")} disabled={Boolean(busy)}>
              Create my Loft
            </button>
            <button className="secondary big" onClick={() => run(unlock)} disabled={Boolean(busy)}>
              {returning ? "Unlock" : "I already have one"}
            </button>
          </div>
        )}
        <ErrorLine error={error} />
      </div>
      {mode === "start" && <Compare />}
      <p className="fineprint center">Agora dollars (AUSD) on Monad · passkeys by Mera · unaudited, use small amounts</p>
    </section>
  );
}


/** What changes when the money never leaves your own account. Kept to claims the contracts back up. */
const DIFFERENCES = [
  ["Who holds the money", "The company", "You do"],
  ["Family receives", "Naira, at the app's rate", "Dollars they keep"],
  ["To receive, they need", "A bank account", "Just a phone"],
  ["If the company closes", "Wait for a refund", "Open it in any wallet"],
] as const;

function Compare() {
  return (
    <div className="compare" role="table" aria-label="How Loft is different">
      <h3>How it's different</h3>
      <div className="compare-row head" role="row">
        <span role="columnheader" />
        <span role="columnheader">Most money apps</span>
        <span role="columnheader">Loft</span>
      </div>
      {DIFFERENCES.map(([what, them, us]) => (
        <div className="compare-row" role="row" key={what}>
          <span role="rowheader">{what}</span>
          <span role="cell" className="them">
            {them}
          </span>
          <strong role="cell">{us}</strong>
        </div>
      ))}
    </div>
  );
}

export function HouseMark() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48">
      <path d="M8 22 24 9l16 13v17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2Z" fill="var(--accent)" />
      <path d="M19 41V29h10v12" fill="var(--paper)" />
      <circle cx="24" cy="21" r="3" fill="var(--paper)" />
    </svg>
  );
}
