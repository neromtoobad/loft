import { useEffect, useMemo, useRef, useState } from "react";
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
import { UsdcWaiting } from "./add.tsx";
import { InstallCard } from "./install.tsx";
import { ErrorLine, Label, Money, Postmark, Stamp, TxLink, errorText, stampDate } from "./ui.tsx";

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
  const [show, setShow] = useState<"USD" | "NGN">("USD");
  if (!vault || !session) return null;
  const dollars = balance === null ? null : fromUnits(balance);
  const me = session.account.address.toLowerCase();
  const outgoing = orders.filter((o) => o.active && o.sender.toLowerCase() === me);

  const activity = buildActivity(vault, session.account.address, payments);
  const creature: Creature = isCreature(vault.character) ? vault.character : "cheetah";
  const pose = moodFor(balance, orders, me, arrivedAt);

  const contact = (address?: string) =>
    address ? vault.contacts.find((c) => c.address.toLowerCase() === address.toLowerCase()) : undefined;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const total = (dir: "in" | "out") =>
    activity.filter((a) => a.dir === dir && a.at > monthAgo).reduce((sum, a) => sum + fromUnits(a.amount), 0);

  return (
    <section className="home">
      <header className="app-head">
        <div className="hello">
          <Label>
            {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ·{" "}
            {config?.network === "mainnet" ? "Monad" : "Testnet"}
          </Label>
          <h1 className="greet">
            {greeting()}, <em>{vault.name || "you"}</em>
          </h1>
        </div>
        <button className="avatar" data-creature={creature} onClick={() => navigate("/me")} aria-label="Your profile">
          <img src={`/cast/${creature}/idle.webp`} alt="" />
        </button>
      </header>

      <div className="hero" data-creature={creature}>
        <div className="hero-top">
          <Label>Your dollars</Label>
          <div className="seg" role="tablist" aria-label="Show balance in">
            {(["USD", "NGN"] as const).map((c) => (
              <button key={c} role="tab" aria-selected={show === c} className={show === c ? "on" : ""} onClick={() => setShow(c)} disabled={c === "NGN" && !rate}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="hero-amount">
          {dollars === null ? (
            <span className="shimmer" aria-label="Loading balance" />
          ) : show === "NGN" && rate ? (
            <Money value={dollars * rate} currency="NGN" />
          ) : (
            <Money value={dollars} />
          )}
        </div>
        <p className="hero-sub">
          {dollars !== null && rate ? (show === "USD" ? `≈ ${ngn(dollars * rate)} today` : `${usd(dollars)} held as AUSD`) : "Held as AUSD on Monad"}
        </p>
        <p className="hero-sub dim">
          <Icon.lock size={13} /> Only your passkey can move it
        </p>
        <p className="hero-meta">
          Sent {usd(total("out"))} · Received {usd(total("in"))} · 30 days
        </p>
        <div className="hero-creature" aria-hidden>
          <CreatureSprite kind={creature} pose={pose} size={128} label={`Your ${creature}`} />
        </div>
        <div className="hero-actions">
          <button className="pill light" onClick={() => navigate("/send")}>
            Send
          </button>
          <button className="pill glass" onClick={() => navigate("/send?link=1")}>
            Link
          </button>
          <button className="pill glass" onClick={() => navigate("/add")}>
            Add
          </button>
        </div>
      </div>

      <UsdcWaiting />

      <NextUp outgoing={outgoing} />

      <div className="ways">
        <button className="way" onClick={() => navigate("/ask")}>
          <span className="way-icon">
            <Icon.receive size={18} />
          </span>
          <strong>Ask the family</strong>
          <span>Request, they pay</span>
        </button>
        <button className="way" onClick={() => navigate("/pots")}>
          <span className="way-icon">
            <Icon.user size={18} />
          </span>
          <strong>Family pot</strong>
          <span>Chip in together</span>
        </button>
        <button className="way" onClick={() => navigate("/schedule?mode=rate")}>
          <span className="way-icon">
            <Icon.dollar size={18} />
          </span>
          <strong>At a rate</strong>
          <span>Send when ₦ is right</span>
        </button>
      </div>

      <Ask />

      <InstallCard where="home" />

      {vault.contacts.length > 0 && (
        <div className="family">
          <div className="section-head">
            <h3>Family</h3>
            <Label>{vault.contacts.length} on Loft</Label>
          </div>
          <div className="family-strip">
            {vault.contacts.slice(0, 12).map((c) => {
              const last = activity.find((a) => a.other?.toLowerCase() === c.address.toLowerCase());
              return (
                <button key={c.address} className="member" onClick={() => navigate(`/send?to=${encodeURIComponent(c.name)}`)}>
                  <CreatureAvatar kind={c.character} name={c.name} />
                  <span className="member-name">{c.name.replace(/^@/, "")}</span>
                  <span className={`member-last ${last?.dir ?? ""}`}>
                    {last ? `${last.dir === "in" ? "+" : "−"}${usd(last.amount)}` : "Say hi"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card recent">
        <div className="card-head">
          <h3>Recent</h3>
          <Label>Newest first</Label>
        </div>
        {activity.length === 0 ? (
          <p className="empty">Nothing yet. Send someone a few dollars and it shows up here.</p>
        ) : (
          <div className="list">
            {activity.map((a, i) => {
              const who = contact(a.other);
              const day = dayLabel(a.at);
              return (
                <div key={a.key}>
                  {(i === 0 || dayLabel(activity[i - 1].at) !== day) && <div className="day">{day}</div>}
                  <button className="row activity" onClick={() => setOpen(open === a.key ? null : a.key)} aria-expanded={open === a.key}>
                    <span className={`glyph ${a.dir}`} data-creature={isCreature(who?.character) ? who.character : undefined} aria-hidden>
                      {isCreature(who?.character) ? (
                        <img src={`/cast/${who.character}/idle.webp`} alt="" className="glyph-img" />
                      ) : a.dir === "in" ? (
                        <Icon.receive size={18} />
                      ) : a.sent?.kind === "link" ? (
                        <Icon.link size={18} />
                      ) : (
                        <Icon.send size={18} />
                      )}
                    </span>
                    <span className="who">
                      {a.label}
                      <small>
                        {a.note ? `“${a.note}” · ` : ""}
                        {a.ngn ? `≈ ${ngn(a.ngn.value)} · ` : ""}
                        {ago(a.at)}
                      </small>
                    </span>
                    <span className={`amt ${a.dir}`}>
                      {a.dir === "in" ? "+" : "−"}
                      {usd(a.amount)}
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
      </div>
    </section>
  );
}

/**
 * The one thing worth doing next, from real state: the next standing-order
 * payment, else sending again to the last person, else a first link.
 */
function NextUp({ outgoing }: { outgoing: OrderInfo[] }) {
  const { vault, rate } = useLoft();
  if (!vault) return null;
  const name = (addr: string) => vault.contacts.find((c) => c.address.toLowerCase() === addr.toLowerCase());
  let label: string, title: string, chips: string[], to: string, kind: string | null | undefined;
  const order = [...outgoing].sort((a, b) => a.nextDue - b.nextDue)[0];
  if (order && order.minRate > 0) {
    const who = name(order.recipient);
    label = "Rate trigger";
    title = `${who?.name ?? "They"} gets ${usd(order.amount)} when $1 buys ₦${Math.round(order.minRate).toLocaleString("en-NG")}`;
    chips = [rate ? `Today ₦${Math.round(rate).toLocaleString("en-NG")}` : "Waiting", "Watched by Chainlink"];
    to = "/schedule";
    kind = who?.character;
  } else if (order) {
    const who = name(order.recipient);
    label = `Standing order · ${cadence(order.period)}`;
    title = `${who?.name ?? "They"} ${order.mode === "topup" ? `stays at ${usd(order.amount)}` : `gets ${usd(order.amount)}`} ${when(order.nextDue)}`;
    chips = [`${usd(fromUnits(order.budget))} left`, "Run by Chainlink"];
    to = "/schedule";
    kind = who?.character;
  } else if (vault.contacts[0]) {
    const c = vault.contacts[0];
    label = "Send again";
    title = `Send to ${c.name.replace(/^@/, "")}`;
    chips = ["$0.00 fee", "Lands in ~1s"];
    to = `/send?to=${encodeURIComponent(c.name)}`;
    kind = c.character;
  } else {
    label = "Start here";
    title = "Send your first dollars home";
    chips = ["No bank needed", "$0.00 fee"];
    to = "/send?link=1";
    kind = null;
  }
  return (
    <button className="next airmail" onClick={() => navigate(to)}>
      <span className="next-body">
        <Label>Par avion · {label}</Label>
        <span className="next-title">{title}</span>
        <span className="next-chips">
          {chips.map((c) => (
            <span key={c} className="mono-chip">
              {c}
            </span>
          ))}
        </span>
      </span>
      <span className="next-post">
        <Stamp kind={kind} value={order ? usd(order.amount) : "$0"} />
        <Postmark top="Monad" bottom={stampDate()} />
      </span>
      <span className="next-go" aria-hidden>
        <Icon.arrow size={18} />
      </span>
    </button>
  );
}

const CHEER_MS = 4000;

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
}

/** "Today", "Yesterday", or a short date: Activity is grouped by the day money moved. */
function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

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

/** Browsers name it differently; Safari and Chrome both still prefix it. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Plain-language requests, typed or spoken ("send Mum fifty thousand naira").
 * Claude or Kimi reads them into a transfer; nothing moves until the user reviews and
 * confirms it on the send screen with their passkey.
 */
function Ask() {
  const { vault } = useLoft();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<ParsedIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<Recognition | null>(null);
  const canListen = useMemo(() => Boolean(speechRecognition()), []);

  async function read(sentence: string, spoken: boolean) {
    if (!sentence.trim()) return;
    setThinking(true);
    setError(null);
    try {
      const parsed = await api.intent(sentence, vault?.contacts.map((c) => c.name) ?? []);
      setIntent(parsed);
      // Said aloud, so answer aloud: the confirmation is read back before the review.
      if (spoken && parsed.kind !== "unknown" && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(`${parsed.explanation} Tap review to confirm.`);
        u.rate = 1.05;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setThinking(false);
    }
  }

  function listen() {
    const SR = speechRecognition();
    if (!SR) return;
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = navigator.language || "en-GB";
    r.interimResults = true;
    r.continuous = false;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(" ");
      setText(heard);
      setIntent(null);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Allow the microphone to talk to Loft.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("Didn't catch that. Try again, or type it.");
    };
    r.onend = () => {
      setListening(false);
      recognizer.current = null;
      if (heard.trim()) read(heard, true);
    };
    recognizer.current = r;
    setError(null);
    setIntent(null);
    setText("");
    setListening(true);
    r.start();
  }

  useEffect(() => () => recognizer.current?.stop(), []);

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
    <form
      className={`ask ${canListen ? "with-mic" : ""} ${listening ? "listening" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        read(text, false);
      }}
    >
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setIntent(null);
        }}
        placeholder={listening ? "Listening…" : canListen ? "Say “send Mum ₦50k”" : "Try “send mum ₦50k every Friday”"}
        aria-label="Ask Loft"
      />
      {canListen && (
        <button type="button" className={`mic-btn ${listening ? "on" : ""}`} onClick={listen} aria-label={listening ? "Stop listening" : "Speak"} aria-pressed={listening}>
          <Icon.mic size={18} />
        </button>
      )}
      <button className="icon-btn" disabled={thinking || !text.trim() || listening} aria-label="Ask">
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
