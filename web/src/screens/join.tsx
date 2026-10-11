// For pages someone opens from a shared link (a request, a pot): if they
// don't have a Loft yet, one passkey ceremony makes one right here.
import { useState } from "react";
import { type Creature, CreaturePicker } from "../cast.tsx";
import { useLoft } from "../state.tsx";
import { ErrorLine, Label, errorText } from "./ui.tsx";

export function JoinInline({ why }: { why: string }) {
  const { create, unlock, busy } = useLoft();
  const [name, setName] = useState("");
  const [creature, setCreature] = useState<Creature | null>(null);
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
    <form
      className="card form-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && creature) run(() => create(name.trim(), creature));
      }}
    >
      <Label>{why}</Label>
      <label className="field">
        <span>Your first name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="So they know it's you" maxLength={40} />
      </label>
      <span className="field-label">Pick your creature</span>
      <CreaturePicker value={creature} onChange={setCreature} />
      <button className="primary big" disabled={!name.trim() || !creature || Boolean(busy)}>
        Create with passkey
      </button>
      <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => run(unlock)}>
        I already have a Loft
      </button>
      <ErrorLine error={error} />
    </form>
  );
}

/** The id after the `#` of a shared link (/r#abc, /p#12). */
export function hashId(): string | null {
  const raw = location.hash.replace(/^#/, "");
  return raw ? decodeURIComponent(raw) : null;
}

/** Share text on WhatsApp, or the system sheet when there is one. */
export function ShareButtons({ text, url }: { text: string; url: string }) {
  return (
    <div className="stack">
      <a className="primary big" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer">
        Share on WhatsApp
      </a>
      <div className="inline even">
        {"share" in navigator && (
          <button className="secondary" onClick={() => navigator.share({ text, url }).catch(() => {})}>
            Share
          </button>
        )}
        <button className="secondary" onClick={() => navigator.clipboard?.writeText(url)}>
          Copy link
        </button>
      </div>
    </div>
  );
}
