import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { fromUnits } from "../../../shared/money.ts";
import { cadence, ngn, usd, when } from "../lib/format.ts";
import type { Contact } from "../lib/vault.ts";
import { useLoft } from "../state.tsx";
import { CourierSprite, CreatureAvatar } from "../cast.tsx";
import { Assure, ErrorLine, TopBar, TxLink, errorText } from "./ui.tsx";

const PERIODS = { daily: 86400, weekly: 7 * 86400, monthly: 30 * 86400 } as const;
type Cadence = keyof typeof PERIODS;

/** The next occurrence of `weekday` (0 = Sunday) at 9am local, or 5 minutes from now. */
function firstDueFor(weekday: number | null) {
  const now = new Date();
  if (weekday === null) return Math.floor(now.getTime() / 1000) + 300;
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  const delta = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (delta === 0 && d <= now ? 7 : delta));
  return Math.floor(d.getTime() / 1000);
}

export function Schedule() {
  const { vault, rate, orders, config, session, schedule, cancelOrder, busy } = useLoft();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [contact, setContact] = useState<Contact | null>(() => {
    const to = params.get("to")?.toLowerCase();
    return vault?.contacts.find((c) => c.name.toLowerCase() === to) ?? null;
  });
  const [amount, setAmount] = useState(params.get("usd") ?? "");
  const [every, setEvery] = useState<Cadence>((params.get("cadence") as Cadence) ?? "weekly");
  const [count, setCount] = useState(params.get("count") ?? "4");
  const [mode, setMode] = useState<"fixed" | "topup">(params.get("mode") === "topup" ? "topup" : "fixed");
  const weekday = params.get("weekday") === null ? null : Number(params.get("weekday"));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Hex | null>(null);

  if (!vault || !session) return null;
  const me = session.account.address.toLowerCase();
  const mine = orders.filter((o) => o.sender.toLowerCase() === me);
  const n = Number(amount);
  const times = Math.max(1, Math.min(52, Number(count) || 1));
  const budget = n * times;
  const nameFor = (addr: string) =>
    vault.contacts.find((c) => c.address.toLowerCase() === addr.toLowerCase())?.name ?? `${addr.slice(0, 6)}…`;

  async function submit() {
    if (!contact) return;
    setError(null);
    try {
      setDone(
        await schedule({
          contact,
          amountUsd: Math.round(n * 100) / 100,
          count: times,
          period: PERIODS[every],
          firstDue: firstDueFor(weekday),
          mode: mode === "topup" ? 1 : 0,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="schedule">
      <TopBar title="Standing orders" />
      <div className="hero-panel">
        <CourierSprite pose="sleep" size={112} />
        <p>
          Set it once. The money is set aside up front, so a payment can't bounce, and Chainlink sends your courier out on time.
        </p>
      </div>

      {done ? (
        <div className="card">
          <h3>All set</h3>
          <p>The first payment goes out {when(firstDueFor(weekday))}.</p>
          <TxLink hash={done} explorer={config?.explorer} />
        </div>
      ) : (
        <div className="card">
          <h3>New</h3>
          {vault.contacts.length === 0 ? (
            <p className="muted">Send someone money once, then you can put them on a schedule.</p>
          ) : (
            <>
              <div className="contacts">
                {vault.contacts.map((c) => (
                  <button
                    key={c.address}
                    className={`contact ${contact?.address === c.address ? "on" : ""}`}
                    onClick={() => setContact(c)}
                  >
                    <CreatureAvatar kind={c.character} name={c.name} size={28} />
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="segmented" role="radiogroup">
                <button className={mode === "fixed" ? "on" : ""} onClick={() => setMode("fixed")}>
                  Fixed amount
                </button>
                <button className={mode === "topup" ? "on" : ""} onClick={() => setMode("topup")}>
                  Top them up
                </button>
              </div>
              <label className="field">
                <span>{mode === "topup" ? "Keep their balance at ($)" : "Amount each time ($)"}</span>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="50" />
                {rate && n > 0 && <small className="muted">≈ {ngn(n * rate)}</small>}
              </label>
              <div className="inline">
                <label className="field">
                  <span>How often</span>
                  <select value={every} onChange={(e) => setEvery(e.target.value as Cadence)}>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                  </select>
                </label>
                <label className="field">
                  <span>Times</span>
                  <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />
                </label>
              </div>
              <p className="muted small">
                Sets aside up to {usd(budget)} now. Anything unused comes back when you stop it.
              </p>
              <Assure>Held in a Monad contract, not by Loft. Each payment records that day's naira rate on-chain.</Assure>
              <ErrorLine error={error} />
              <button className="primary" disabled={!contact || !(n > 0) || Boolean(busy)} onClick={submit}>
                Start
              </button>
            </>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <div className="card">
          <h3>Yours</h3>
          {mine.map((o) => (
            <div key={o.id} className="row">
              <span>
                {nameFor(o.recipient)}: {o.mode === "topup" ? `keep at ${usd(o.amount)}` : usd(o.amount)} {cadence(o.period)}
                <small>
                  {o.active ? `${usd(fromUnits(o.budget))} left · next ${when(o.nextDue)}` : "finished"}
                </small>
              </span>
              {o.active && (
                <button className="ghost small" disabled={Boolean(busy)} onClick={() => cancelOrder(o.id).catch((e) => setError(errorText(e)))}>
                  Stop
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
