import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fromUnits } from "../../../shared/money.ts";
import { navigate } from "../app.tsx";
import { type OrderInfo, type ParsedIntent, api } from "../lib/api.ts";
import { type Creature, CreatureAvatar, CreatureSprite, type Pose, isCreature } from "../cast.tsx";
import { Icon } from "../icons.tsx";
import { buildActivity } from "../lib/activity.ts";
import { ago, cadence, ngn, usd, when } from "../lib/format.ts";
import { useLoft } from "../state.tsx";
import type { SentItem } from "../lib/vault.ts";
import { ErrorLine, TxLink, errorText } from "./ui.tsx";

export function Home() {
  const { vault, balance, rate, orders, config, session, payments, arrivedAt } = useLoft();
  // Re-render once the celebration is over.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!arrivedAt) return;
    const t = setTimeout(() => setTick((n) => n + 1), CHEER_MS + 50);
    return () => clearTimeout(t);
  }, [arrivedAt]);
  const [open, setOpen] = useState<string | null>(null);
  if (!vault || !session) return null;
  const dollars = balance === null ? null : fromUnits(balance);
  const me = session.account.address.toLowerCase();
  const outgoing = orders.filter((o) => o.active && o.sender.toLowerCase() === me);

  const activity = buildActivity(vault, session.account.address, payments);
  const creature: Creature = isCreature(vault.character) ? vault.character : "pangolin";
  const pose = moodFor(balance, orders, me, arrivedAt);

  const character = (address?: string) =>
    address ? vault.contacts.find((c) => c.address.toLowerCase() === address.toLowerCase())?.character : undefined;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className="home">
      <header className="app-head">
        <button className="avatar" onClick={() => navigate("/me")} aria-label="Your profile">
          <img src={`/cast/${creature}/idle.webp`} alt="" />
        </button>
        <div className="hello">
          <span>{greeting}</span>
          <strong>{vault.name || "there"}</strong>
        </div>
        <span className="wordmark">Loft</span>
      </header>

      <div className="balance-card">
        <span className="label">Your balance</span>
        <span className="amount">{dollars === null ? <span className="shimmer" aria-label="Loading balance" /> : usd(dollars)}</span>
        {rate && dollars !== null && <span className="sub">≈ {ngn(dollars * rate)}</span>}
        {rate && (
          <div>
            <span className="chip">
              <span className="dot-live" aria-hidden />1 USD = {ngn(rate)}
            </span>
          </div>
        )}
        <button className="own" onClick={() => navigate("/me")}>
          <Icon.lock size={14} />
          Only you can move it
        </button>
        <CreatureSprite kind={creature} pose={pose} size={124} label={`Your ${creature}`} />
      </div>

      <div className="quick">
        <button onClick={() => navigate("/send")}>
          <span className="disc">
            <Icon.send />
          </span>
          Send
        </button>
        <button onClick={() => navigate("/send?link=1")}>
          <span className="disc">
            <Icon.link />
          </span>
          Link
        </button>
        <button onClick={() => navigate("/add")}>
          <span className="disc">
            <Icon.plus />
          </span>
          Add money
        </button>
        <button onClick={() => navigate("/schedule")}>
          <span className="disc">
            <Icon.calendar />
          </span>
          Schedule
        </button>
      </div>

      {config?.kimi && <Ask />}

      {vault.contacts.length > 0 && (
        <>
          <div className="section-head">
            <h3>Send again</h3>
          </div>
          <div className="people">
            {vault.contacts.slice(0, 10).map((c) => (
              <button key={c.address} onClick={() => navigate(`/send?to=${encodeURIComponent(c.name)}`)}>
                <CreatureAvatar kind={c.character} name={c.name} />
                <span>{c.name.replace(/^@/, "")}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <div className="section-head">
            <h3>Standing orders</h3>
            <button className="link-button" onClick={() => navigate("/schedule")}>
              Manage
            </button>
          </div>
          <div className="card">
            {outgoing.map((o) => (
              <div key={o.id} className="row">
                <span>
                  {o.mode === "topup" ? `Keep at ${usd(o.amount)}` : usd(o.amount)} {cadence(o.period)}
                </span>
                <span className="muted small">next {when(o.nextDue)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h3>Activity</h3>
      </div>
      {activity.length === 0 ? (
        <p className="empty">Nothing yet. Send someone a few dollars and it shows up here.</p>
      ) : (
        <div className="list">
          {activity.map((a) => {
            const kind = character(a.other);
            return (
              <div key={a.key}>
                <button className="row activity" onClick={() => setOpen(open === a.key ? null : a.key)} aria-expanded={open === a.key}>
                  <span className={`glyph ${a.dir}`} aria-hidden>
                    {isCreature(kind) ? (
                      <img src={`/cast/${kind}/idle.webp`} alt="" className="glyph-img" />
                    ) : a.dir === "in" ? (
                      <Icon.receive size={20} />
                    ) : a.sent?.kind === "link" ? (
                      <Icon.link size={20} />
                    ) : (
                      <Icon.send size={20} />
                    )}
                  </span>
                  <span className="who">
                    {a.label}
                    {a.note ? <small>“{a.note}”</small> : <small>{ago(a.at)}</small>}
                    {a.ngn && (
                      <small>
                        ≈ {ngn(a.ngn.value)} at {ngn(a.ngn.rate)}/$
                      </small>
                    )}
                  </span>
                  <span className={`amt ${a.dir}`}>
                    {a.dir === "in" ? "+" : "−"}
                    {usd(a.amount)}
                    {a.note && <small>{ago(a.at)}</small>}
                  </span>
                </button>
                {open === a.key &&
                  (a.sent?.kind === "link" && a.sent.claimSecret ? (
                    <LinkDetail item={a.sent} />
                  ) : (
                    <div className="detail">
                      <TxLink hash={a.txHash} explorer={config?.explorer} />
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const CHEER_MS = 4000;

/**
 * Your creature's mood, from real numbers only: it cheers for a few seconds
 * when money actually lands, and worries when someone keeps you topped up
 * and your balance has fallen under a quarter of that target.
 */
function moodFor(balance: bigint | null, orders: OrderInfo[], me: string, arrivedAt: number): Pose {
  if (arrivedAt && Date.now() - arrivedAt < CHEER_MS) return "cheer";
  const topUp = orders.find((o) => o.active && o.mode === "topup" && o.recipient.toLowerCase() === me);
  if (topUp && balance !== null && balance * 4n < BigInt(topUp.amount)) return "worried";
  return "idle";
}

/** A link you sent: whether it was received, and a way to re-share or take it back from any device. */
function LinkDetail({ item }: { item: SentItem }) {
  const { config, cancelLink, busy } = useLoft();
  const secret = item.claimSecret as Hex;
  const [status, setStatus] = useState<"loading" | "waiting" | "received">("loading");
  const [error, setError] = useState<string | null>(null);
  const url = `${location.origin}/c#${secret.slice(2)}`;

  useEffect(() => {
    api
      .link(privateKeyToAccount(secret).address)
      .then((l) => setStatus(l.claimed ? "received" : "waiting"))
      .catch((e) => setError(errorText(e)));
  }, [secret]);

  return (
    <div className="detail">
      <p className="muted small">
        {status === "loading" ? "Checking…" : status === "received" ? "This link has been received." : "Not opened yet."}
      </p>
      {status === "waiting" && (
        <div className="inline">
          <a
            className="primary small"
            href={`https://wa.me/?text=${encodeURIComponent(`I sent you ${usd(item.amount)} on Loft. Tap to receive it: ${url}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share again
          </a>
          <button className="ghost small" onClick={() => navigator.clipboard?.writeText(url)}>
            Copy
          </button>
          <button
            className="ghost small"
            disabled={Boolean(busy)}
            onClick={() =>
              cancelLink(secret)
                .then(() => setStatus("received"))
                .catch((e) => setError(errorText(e)))
            }
          >
            Take it back
          </button>
        </div>
      )}
      <TxLink hash={item.txHash} explorer={config?.explorer} />
      <ErrorLine error={error} />
    </div>
  );
}

/** Plain-language requests, read by Kimi and always confirmed before anything moves. */
function Ask() {
  const { vault } = useLoft();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<ParsedIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setThinking(true);
    setError(null);
    try {
      setIntent(await api.intent(text, vault?.contacts.map((c) => c.name) ?? []));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setThinking(false);
    }
  }

  function go() {
    if (!intent) return;
    const params = new URLSearchParams();
    if (intent.usd) params.set("usd", intent.usd.toFixed(2));
    if (intent.recipient) params.set("to", intent.recipient);
    if (intent.note) params.set("note", intent.note);
    if (intent.kind === "schedule") {
      if (intent.cadence) params.set("cadence", intent.cadence);
      if (intent.count) params.set("count", String(intent.count));
      if (intent.weekday !== null) params.set("weekday", String(intent.weekday));
      params.set("mode", intent.mode);
      navigate(`/schedule?${params}`);
    } else {
      navigate(`/send?${params}`);
    }
  }

  return (
    <form className="ask" onSubmit={ask}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setIntent(null);
        }}
        placeholder="Try “send mum ₦50k every Friday”"
        aria-label="Ask Loft"
      />
      <button className="icon-btn" disabled={thinking || !text.trim()} aria-label="Ask">
        {thinking ? <span className="spinner" /> : "→"}
      </button>
      {intent && (
        <div className="intent">
          {intent.kind === "unknown" ? (
            <p>I can help send money or set up a regular transfer. Try naming who and how much.</p>
          ) : (
            <>
              <p>{intent.explanation}</p>
              <button type="button" className="primary small" onClick={go}>
                Review
              </button>
            </>
          )}
        </div>
      )}
      <ErrorLine error={error} />
    </form>
  );
}
