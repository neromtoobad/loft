// "Ask the family": the person at home asks, anyone abroad pays in one tap.
// The request is a public link (who asks, for what, how much); paying it is
// an ordinary direct send that carries the request's id.
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { fromUnits } from "../../../shared/money.ts";
import { navigate } from "../app.tsx";
import { type Creature, CreatureSprite, isCreature } from "../cast.tsx";
import { type RequestInfo, api } from "../lib/api.ts";
import { ago, ngn, usd } from "../lib/format.ts";
import { useLoft } from "../state.tsx";
import { JoinInline, ShareButtons, hashId } from "./join.tsx";
import { Done } from "./send.tsx";
import { ErrorLine, Label, Money, Point, Postmark, TopBar, errorText } from "./ui.tsx";

const REASONS = ["School fees", "Rent", "Food this week", "Hospital", "Transport", "Data and airtime"];

export function Ask() {
  const { session, rate, askFamily, busy } = useLoft();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "NGN">("USD");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [mine, setMine] = useState<RequestInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) api.requests(session.account.address).then(setMine).catch(() => undefined);
  }, [session, url]);

  const n = Number(amount);
  const usdAmount = currency === "USD" ? n : rate ? n / rate : 0;
  const valid = usdAmount >= 1 && note.trim().length > 0;

  async function submit() {
    setError(null);
    try {
      setUrl(await askFamily(Math.round(usdAmount * 100) / 100, note.trim()));
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (url) {
    return (
      <section className="done">
        <TopBar title="Ask the family" />
        <div className="card airmail letter">
          <Label>Request · ready to share</Label>
          <span className="letter-text">
            “{note.trim()}” · {usd(usdAmount)}
          </span>
          <span className="muted small">Anyone with the link can pay it in one tap, from anywhere. You'll see who did.</span>
        </div>
        <ShareButtons text={`Could you help with ${note.trim().toLowerCase()}? ${usd(usdAmount)} on Loft:`} url={url} />
        <button className="ghost big" onClick={() => navigate("/")}>
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="ask-screen">
      <TopBar title="Ask the family" />
      <p className="lede intro">Ask for what you need. Anyone abroad pays it in one tap, and it lands as dollars.</p>
      <div className="converter">
        <div className="leg">
          <label htmlFor="ask-amount">You're asking for</label>
          <div className="leg-row">
            <input
              id="ask-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              autoFocus
            />
            <button
              type="button"
              className="ccy"
              disabled={!rate}
              onClick={() => {
                if (!rate) return;
                if (n) setAmount(currency === "USD" ? String(Math.round(n * rate)) : (n / rate).toFixed(2));
                setCurrency(currency === "USD" ? "NGN" : "USD");
              }}
            >
              <span className="flag">{currency === "USD" ? "$" : "₦"}</span>
              {currency}
            </button>
          </div>
          <div className="leg-sub">
            {rate && n ? (currency === "USD" ? `≈ ${ngn(usdAmount * rate)}` : `≈ ${usd(usdAmount)} in dollars`) : "Tap the currency to switch"}
          </div>
        </div>
      </div>
      <label className="field">
        <span>What's it for?</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="School fees" maxLength={140} />
      </label>
      <div className="reason-chips">
        {REASONS.map((r) => (
          <button key={r} type="button" className={`chip-btn ${note === r ? "on" : ""}`} onClick={() => setNote(r)}>
            {r}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <button className="primary big" disabled={!valid || Boolean(busy)} onClick={submit}>
        {valid ? `Ask for ${usd(usdAmount)}` : "Enter an amount and a reason"}
      </button>

      {mine.length > 0 && (
        <div className="card recent">
          <div className="card-head">
            <h3>Your requests</h3>
          </div>
          {mine.map((r) => (
            <button key={r.id} className="row activity" onClick={() => navigate(`/r#${r.id}`)}>
              <span className="who">
                {r.note}
                <small>{r.paid ? `Paid ${ago(r.paid.at)}` : `Asked ${ago(r.createdAt)} · waiting`}</small>
              </span>
              <span className={`amt ${r.paid ? "in" : ""}`}>{usd(r.amount)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The page a relative opens: who asks, for what, and one tap to pay it. */
export function RequestPage() {
  const { session, vault, rate, config, sendTo, busy } = useLoft();
  const [id] = useState(hashId);
  const [req, setReq] = useState<RequestInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ name: string; to: Creature | null } | null>(null);
  const [done, setDone] = useState<{ hash: Hex; ms: number } | null>(null);

  useEffect(() => {
    if (id) api.request(id).then(setReq).catch((e) => setError(errorText(e)));
  }, [id, done]);

  if (!id) {
    return (
      <section className="claim">
        <h2 className="display">This request link is incomplete</h2>
        <p className="lede">Ask the person who sent it to share it again.</p>
      </section>
    );
  }

  const dollars = req ? fromUnits(req.amount) : 0;
  const theirs: Creature | null = isCreature(req?.character) ? req.character : null;
  const mine = session && req && req.requester.toLowerCase() === session.account.address.toLowerCase();

  if (paying && vault) {
    return (
      <Done
        from={isCreature(vault.character) ? vault.character : "cheetah"}
        flight={{ to: paying.to, toRoof: !paying.to, name: paying.name }}
        done={done}
        amount={dollars}
        note={req?.note}
        explorer={config?.explorer}
      />
    );
  }

  async function pay() {
    if (!req) return;
    setError(null);
    const name = req.handle ? `@${req.handle}` : req.name;
    setPaying({ name, to: theirs });
    try {
      const settled = await sendTo(
        { name, address: req.requester, handle: req.handle ?? undefined, character: req.character ?? undefined },
        dollars,
        req.note,
        req.id,
      );
      setDone(settled);
    } catch (e) {
      setPaying(null);
      setError(errorText(e));
    }
  }

  return (
    <section className="claim">
      <div className="hero claim-hero" data-creature={theirs ?? undefined}>
        <div className="hero-top">
          <Label live={!req?.paid}>{req ? `${req.name} asks` : "Opening the request"}</Label>
        </div>
        <div className="hero-amount">{req ? <Money value={dollars} /> : <span className="shimmer" />}</div>
        {req && rate && <p className="hero-sub">≈ {ngn(dollars * rate)} · lands as dollars on Monad</p>}
        {theirs && (
          <div className="claim-cast" aria-hidden>
            <CreatureSprite kind={theirs} pose={req?.paid ? "cheer" : "wait"} size={124} />
          </div>
        )}
      </div>
      {req && (
        <blockquote className="note airmail letter">
          <Label>For</Label>
          <span className="letter-text">“{req.note}”</span>
        </blockquote>
      )}
      {req?.paid ? (
        <div className="card paid-card">
          <span className="receipt-mark static">
            <Postmark top="Paid" bottom={new Date(req.paid.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()} />
          </span>
          <h3>Paid</h3>
          <p className="muted">{req.paid.name ?? "Someone"} sent it {ago(req.paid.at)}.</p>
        </div>
      ) : req && mine ? (
        <>
          <p className="lede">This is your request. Share the link with family; you'll see it here once someone pays.</p>
          <ShareButtons text={`Could you help with ${req.note.toLowerCase()}? ${usd(dollars)} on Loft:`} url={location.href} />
        </>
      ) : req && session && vault ? (
        <>
          <div className="card points">
            <Point icon="lock">Goes straight to {req.name}'s own account.</Point>
            <Point icon="dollar">$0.00 fee. Lands in about a second.</Point>
          </div>
          <button className="primary big" disabled={Boolean(busy)} onClick={pay}>
            Pay {usd(dollars)} to {req.name}
          </button>
        </>
      ) : req ? (
        <JoinInline why={`Make your Loft to pay ${req.name}`} />
      ) : null}
      <ErrorLine error={error} />
    </section>
  );
}
