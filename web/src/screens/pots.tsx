// Family pots: siblings abroad chip in for one person at home. The pot lives
// in the escrow: it pays out the moment it reaches its target, or Chainlink
// releases whatever was raised on the deadline.
import { useEffect, useState } from "react";
import { fromUnits } from "../../../shared/money.ts";
import { navigate } from "../app.tsx";
import { CreatureAvatar, CreatureSprite, isCreature } from "../cast.tsx";
import { type PotInfo, api } from "../lib/api.ts";
import { ago, ngn, seconds, usd, when } from "../lib/format.ts";
import type { Contact } from "../lib/vault.ts";
import { useLoft } from "../state.tsx";
import { JoinInline, ShareButtons, hashId } from "./join.tsx";
import { ErrorLine, Label, Money, Point, Postmark, TopBar, TxLink, errorText } from "./ui.tsx";

const IDEAS = ["Mum's rent", "School term", "Hospital bill", "Dad's birthday", "Generator fuel"];

function personName(p: PotInfo["beneficiary"], contacts: Contact[]) {
  const c = contacts.find((x) => x.address.toLowerCase() === p.address.toLowerCase());
  return c?.name.replace(/^@/, "") ?? p.name ?? (p.handle ? `@${p.handle}` : `${p.address.slice(0, 6)}…`);
}

function Progress({ raised, target }: { raised: number; target: number }) {
  const pct = Math.min(100, (raised / target) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pots() {
  const { session, vault, openPot, busy } = useLoft();
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<Contact | null>(vault?.contacts[0] ?? null);
  const [target, setTarget] = useState("");
  const [days, setDays] = useState(14);
  const [mine, setMine] = useState<PotInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) api.pots(session.account.address).then(setMine).catch(() => undefined);
  }, [session]);
  if (!vault || !session) return null;

  const t = Number(target);
  const valid = title.trim() && who && t >= 1;

  async function submit() {
    if (!who) return;
    setError(null);
    try {
      const { potId } = await openPot({
        title: title.trim(),
        beneficiary: who,
        targetUsd: Math.round(t * 100) / 100,
        deadline: Math.floor(Date.now() / 1000) + days * 86400,
      });
      navigate(`/p#${potId}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="pots">
      <TopBar title="Family pots" />
      <p className="lede intro">Siblings abroad chip in for one person at home. It pays out the moment it's full, or on the deadline.</p>

      <div className="card form-card">
        <Label>Open a pot</Label>
        <label className="field">
          <span>What's it for?</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mum's rent" maxLength={60} />
        </label>
        <div className="reason-chips">
          {IDEAS.map((r) => (
            <button key={r} type="button" className={`chip-btn ${title === r ? "on" : ""}`} onClick={() => setTitle(r)}>
              {r}
            </button>
          ))}
        </div>
        <span className="field-label">Who gets it</span>
        {vault.contacts.length === 0 ? (
          <p className="muted small">Send someone money once and they'll show up here.</p>
        ) : (
          <div className="contacts">
            {vault.contacts.map((c) => (
              <button key={c.address} type="button" className={`contact ${who?.address === c.address ? "on" : ""}`} onClick={() => setWho(c)}>
                <CreatureAvatar kind={c.character} name={c.name} size={28} />
                {c.name.replace(/^@/, "")}
              </button>
            ))}
          </div>
        )}
        <div className="inline">
          <label className="field">
            <span>Target ($)</span>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))} placeholder="300" />
          </label>
          <label className="field">
            <span>Deadline</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={3}>In 3 days</option>
              <option value={7}>In a week</option>
              <option value={14}>In 2 weeks</option>
              <option value={30}>In a month</option>
            </select>
          </label>
        </div>
        <ErrorLine error={error} />
        <button className="primary big" disabled={!valid || Boolean(busy)} onClick={submit}>
          Open the pot
        </button>
      </div>

      {mine.length > 0 && (
        <>
          <div className="section-head">
            <h3>Your pots</h3>
          </div>
          {mine.map((p) => (
            <button key={p.id} className="card pot-row" onClick={() => navigate(`/p#${p.id}`)}>
              <span className="pot-row-head">
                <span>
                  <strong>{p.title}</strong>
                  <small>
                    For {personName(p.beneficiary, vault.contacts)} · {p.released ? "paid out" : `closes ${when(p.deadline)}`}
                  </small>
                </span>
                <span className="amt">{usd(p.raised)}</span>
              </span>
              <Progress raised={fromUnits(p.raised)} target={fromUnits(p.target)} />
            </button>
          ))}
        </>
      )}
    </section>
  );
}

/** One pot: progress, who chipped in, and a one-tap way to add to it. */
export function PotPage() {
  const { session, vault, rate, config, chipIn, busy } = useLoft();
  const [id] = useState(() => Number(hashId()));
  const [pot, setPot] = useState<PotInfo | null>(null);
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ hash: string; ms: number; released: boolean } | null>(null);

  useEffect(() => {
    if (!Number.isInteger(id)) return;
    const load = () => api.pot(id).then(setPot).catch((e) => setError(errorText(e)));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id, landed]);

  if (!Number.isInteger(id)) {
    return (
      <section className="claim">
        <h2 className="display">This pot link is incomplete</h2>
      </section>
    );
  }

  const raised = pot ? fromUnits(pot.raised) : 0;
  const target = pot ? fromUnits(pot.target) : 0;
  const forName = pot ? personName(pot.beneficiary, vault?.contacts ?? []) : "";
  const kind = isCreature(pot?.beneficiary.character) ? pot.beneficiary.character : null;
  const isBeneficiary = Boolean(session && pot && pot.beneficiary.address.toLowerCase() === session.account.address.toLowerCase());
  const n = Number(amount);

  async function give() {
    setError(null);
    try {
      setLanded(await chipIn(id, Math.round(n * 100) / 100));
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="claim pot-page">
      {session && <TopBar title="Family pot" back="/pots" />}
      <div className="hero claim-hero" data-creature={kind ?? undefined}>
        <div className="hero-top">
          <Label live={pot ? !pot.released : false}>{pot ? (pot.released ? "Paid out" : `Family pot · for ${forName}`) : "Opening the pot"}</Label>
        </div>
        <h2 className="display pot-title">{pot?.title ?? "…"}</h2>
        <div className="hero-amount small-amount">
          {pot ? <Money value={raised} /> : <span className="shimmer" />}
          {pot && <span className="of"> of {usd(target)}</span>}
        </div>
        {pot && <Progress raised={raised} target={target} />}
        {pot && (
          <p className="hero-sub">
            {pot.released ? "Delivered to " + forName : `Closes ${when(pot.deadline)}`}
            {rate ? ` · ≈ ${ngn(raised * rate)}` : ""}
          </p>
        )}
        {kind && (
          <div className="claim-cast" aria-hidden>
            <CreatureSprite kind={kind} pose={pot?.released ? "cheer" : "wait"} size={112} />
          </div>
        )}
      </div>

      {landed && (
        <div className="card paid-card">
          <span className="receipt-mark static">
            <Postmark top={landed.released ? "Delivered" : "Added"} bottom={seconds(landed.ms)} />
          </span>
          <h3>{landed.released ? `That filled it. ${forName} has it.` : "You chipped in."}</h3>
          <p className="muted">Confirmed on Monad in {seconds(landed.ms)}.</p>
        </div>
      )}

      {pot && pot.contributions.length > 0 && (
        <div className="card recent">
          <div className="card-head">
            <h3>Who chipped in</h3>
            <Label>{pot.contributions.length} so far</Label>
          </div>
          {pot.contributions.map((c) => (
            <div key={c.txHash} className="row activity">
              <span className="glyph" data-creature={isCreature(c.character) ? c.character : undefined} aria-hidden>
                {isCreature(c.character) ? <img className="glyph-img" src={`/cast/${c.character}/idle.webp`} alt="" /> : c.name.slice(0, 1)}
              </span>
              <span className="who">
                {c.name}
                <small>{ago(c.at)}</small>
              </span>
              <span className="amt">{usd(c.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {pot && !pot.released && session && vault && !isBeneficiary && (
        <div className="card form-card">
          <Label>Chip in</Label>
          <div className="reason-chips">
            {[5, 10, 20, 50].map((v) => (
              <button key={v} type="button" className={`chip-btn ${n === v ? "on" : ""}`} onClick={() => setAmount(String(v))}>
                ${v}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Amount ($)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <button className="primary big" disabled={!(n > 0) || Boolean(busy)} onClick={give}>
            Chip in {n > 0 ? usd(n) : ""}
          </button>
        </div>
      )}

      {pot && !pot.released && (
        <>
          <div className="card points">
            <Point icon="lock">Held in a Monad contract, not by Loft.</Point>
            <Point icon="check">Pays {forName} the moment it's full, or on the deadline. Chainlink runs it.</Point>
          </div>
          <ShareButtons text={`Let's chip in for ${pot.title.toLowerCase()} on Loft:`} url={`${location.origin}/p#${pot.id}`} />
        </>
      )}
      {pot && !session && !pot.released && <JoinInline why="Make your Loft to chip in" />}
      {pot?.txHash && <TxLink hash={pot.txHash} explorer={config?.explorer} />}
      <ErrorLine error={error} />
    </section>
  );
}
