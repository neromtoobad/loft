import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { fromUnits } from "../../../shared/money.ts";
import { navigate } from "../app.tsx";
import { api } from "../lib/api.ts";
import { ngn, seconds, short, usd } from "../lib/format.ts";
import { PROMPT_FREE_LIMIT_USD } from "../lib/keys.ts";
import type { Contact } from "../lib/vault.ts";
import { useLoft } from "../state.tsx";
import { type Creature, CreatureAvatar, Delivery, isCreature } from "../cast.tsx";
import { Icon } from "../icons.tsx";
import { Assure, ErrorLine, TopBar, TxLink, errorText } from "./ui.tsx";

type Target = { kind: "contact"; contact: Contact } | { kind: "link"; label: string };

export function Send() {
  const { vault, rate, balance, config, sendTo, makeLink, resolveRecipient, busy } = useLoft();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [currency, setCurrency] = useState<"USD" | "NGN">("USD");
  const [amount, setAmount] = useState(params.get("usd") ?? "");
  const [note, setNote] = useState(params.get("note") ?? "");
  const [target, setTarget] = useState<Target | null>(() => {
    const to = params.get("to")?.toLowerCase();
    const c = vault?.contacts.find((x) => x.name.toLowerCase() === to);
    if (c) return { kind: "contact", contact: c };
    return params.get("link") ? { kind: "link", label: params.get("to")?.trim() ?? "" } : null;
  });
  const [lookup, setLookup] = useState(params.get("to") ?? "");
  const [linkLabel, setLinkLabel] = useState(params.get("to") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; ms: number; url?: string } | null>(null);
  // Set the moment Send is tapped, so the courier takes off before the payment lands.
  const [flight, setFlight] = useState<{ to: Creature | null; toRoof: boolean; name: string } | null>(null);

  if (!vault) return null;
  const n = Number(amount);
  const usdAmount = currency === "USD" ? n : rate ? n / rate : 0;
  const tooMuch = balance !== null && usdAmount > fromUnits(balance);
  const valid = usdAmount >= 0.01 && !tooMuch;

  async function find() {
    setError(null);
    try {
      const c = await resolveRecipient(lookup);
      setTarget({ kind: "contact", contact: c });
    } catch (e) {
      setError(errorText(e).includes("no such handle") ? "Nobody on Loft has that name. Send them a link instead." : errorText(e));
    }
  }

  async function submit() {
    if (!target) return;
    setError(null);
    try {
      const rounded = Math.round(usdAmount * 100) / 100;
      if (target.kind === "contact") {
        // Contacts saved before creatures existed don't know theirs yet.
        const known = target.contact.character ?? (await api.profile(target.contact.address).catch(() => null))?.character;
        const to = isCreature(known) ? known : null;
        setFlight({ to, toRoof: !to, name: target.contact.name });
        setDone(await sendTo(target.contact, rounded, note));
      } else {
        setFlight({ to: null, toRoof: true, name: target.label || "them" });
        setDone(await makeLink(rounded, note, target.label));
      }
    } catch (e) {
      setFlight(null);
      setError(errorText(e));
    }
  }

  if (flight) {
    return (
      <Done
        from={isCreature(vault.character) ? vault.character : "pangolin"}
        flight={flight}
        done={done}
        amount={usdAmount}
        explorer={config?.explorer}
      />
    );
  }

  const recipientName =
    target?.kind === "contact" ? target.contact.name.replace(/^@/, "") : target?.kind === "link" ? target.label || "They" : "They";
  const ngnValue = rate ? usdAmount * rate : null;

  return (
    <section className="send">
      <TopBar title="Send money" />

      <div className="converter">
        <div className="leg">
          <label htmlFor="amount">You send</label>
          <div className="leg-row">
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              aria-label="Amount"
              autoFocus
            />
            <span className="ccy">
              <span className="flag">{currency === "USD" ? "$" : "₦"}</span>
              {currency}
            </span>
          </div>
          <div className="leg-sub">
            {balance !== null && <span className={tooMuch ? "over" : undefined}>Balance {usd(balance)} · </span>}
            <button
              className="link-button"
              type="button"
              disabled={!rate}
              onClick={() => {
                if (!rate) return;
                if (n) setAmount(currency === "USD" ? String(Math.round(n * rate)) : (n / rate).toFixed(2));
                setCurrency(currency === "USD" ? "NGN" : "USD");
              }}
            >
              {currency === "USD" ? "Enter in naira" : "Enter in dollars"}
            </button>
          </div>
        </div>

        <div className="rail">
          <span className="chip">
            <span className="dot-live" aria-hidden />
            {rate ? <>1 USD = {ngn(rate)} · live rate</> : "Getting today's rate…"}
          </span>
        </div>

        <div className="leg">
          <span className="leg-label">{recipientName} gets</span>
          <div className="leg-row">
            <span className="leg-value">{valid || n ? usd(usdAmount).replace("$", "") : "0"}</span>
            <span className="ccy">
              <span className="flag">$</span>
              USD
            </span>
          </div>
          <div className="leg-sub">{ngnValue ? <>Stays in dollars · worth {ngn(ngnValue)} today</> : "Stays in dollars, not converted to naira"}</div>
        </div>

        <div className="facts">
          <div>
            <span>Fee</span>
            <strong className="free">$0.00</strong>
          </div>
          <div>
            <span>Arrives</span>
            <strong>In about a second</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{usd(usdAmount || 0)}</strong>
          </div>
        </div>
        <Assure>
          {target?.kind === "link"
            ? "Waits in a Monad contract until they tap. Loft never holds it."
            : `Goes straight to ${target ? `${recipientName}'s` : "their"} own account. Loft never holds it.`}
        </Assure>
      </div>

      <div className="section-head">
        <h3>Who's it for?</h3>
      </div>
      <div className="recipients" role="radiogroup">
        {vault.contacts.map((c) => {
          const on = target?.kind === "contact" && target.contact.address === c.address;
          return (
            <button key={c.address} role="radio" aria-checked={on} className={`recipient ${on ? "on" : ""}`} onClick={() => setTarget({ kind: "contact", contact: c })}>
              <CreatureAvatar kind={c.character} name={c.name} />
              <span>
                {c.name}
                <small>{c.handle ? `@${c.handle}` : short(c.address)}</small>
              </span>
              {on && <span className="tick">✓</span>}
            </button>
          );
        })}
        <button
          role="radio"
          aria-checked={target?.kind === "link"}
          className={`recipient ${target?.kind === "link" ? "on" : ""}`}
          onClick={() => setTarget({ kind: "link", label: linkLabel.trim() })}
        >
          <span className="avatar">
            <Icon.link size={20} />
          </span>
          <span>
            Someone new
            <small>Send a link. No app or bank account needed.</small>
          </span>
          {target?.kind === "link" && <span className="tick">✓</span>}
        </button>
      </div>

      {target?.kind === "link" && (
        <label className="field">
          <span>Who is the link for?</span>
          <input
            value={linkLabel}
            onChange={(e) => {
              setLinkLabel(e.target.value);
              setTarget({ kind: "link", label: e.target.value.trim() });
            }}
            placeholder="Mum"
            maxLength={40}
          />
        </label>
      )}

      <div className="or">or find someone on Loft</div>
      <div className="inline">
        <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="@name or 0x address" aria-label="Find by name or address" />
        <button className="secondary small" disabled={!lookup.trim()} onClick={find}>
          Find
        </button>
      </div>

      <label className="field">
        <span>Add a note (only they can read it)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For school fees" maxLength={140} />
      </label>

      <ErrorLine error={error} />
      <button className="primary big" disabled={!valid || !target || Boolean(busy)} onClick={submit}>
        {tooMuch ? "Not enough balance" : !valid ? "Enter an amount" : target?.kind === "link" ? `Create link for ${usd(usdAmount)}` : target ? `Send ${usd(usdAmount)} to ${recipientName}` : `Send ${usd(usdAmount)}`}
      </button>
      {usdAmount > PROMPT_FREE_LIMIT_USD && <p className="muted small center">Over {usd(PROMPT_FREE_LIMIT_USD)} asks for your passkey again.</p>}
    </section>
  );
}

function Done({
  from,
  flight,
  done,
  amount,
  explorer,
}: {
  from: Creature;
  flight: { to: Creature | null; toRoof: boolean; name: string };
  done: { hash: Hex; ms: number; url?: string } | null;
  amount: number;
  explorer?: string;
}) {
  const { rate } = useLoft();
  const url = done?.url;
  const message = `I sent you ${usd(amount)} on Loft. Tap to receive it: ${url}`;
  return (
    <section className="done">
      <Delivery from={from} to={flight.to} toRoof={flight.toRoof} confirmed={Boolean(done)} />
      <h2 className="display">
        {!done ? `On its way to ${flight.name}…` : url ? "Waiting on their roof" : `${flight.name} has it`}
      </h2>
      {!done ? (
        <p className="lede">Your courier lands the moment Monad confirms.</p>
      ) : url ? (
        <>
          <p className="lede">
            Your courier is holding {usd(amount)} on their roof. Send them the link and it hands it over when they tap. Only share it with
            them. It flies back to you after 14 days if nobody opens it.
          </p>
          <Assure>It waits in a Monad contract, not with Loft. Only this link can open it.</Assure>
          <div className="stack">
            <a className="primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              Share on WhatsApp
            </a>
            {"share" in navigator && (
              <button className="secondary" onClick={() => navigator.share({ text: message }).catch(() => {})}>
                Share another way
              </button>
            )}
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(url ?? "")}>
              Copy link
            </button>
          </div>
        </>
      ) : (
        <p className="lede">
          {usd(amount)} arrived. Confirmed on Monad in {seconds(done.ms)}.
        </p>
      )}
      {done && !url && <Assure>It's in {flight.name}'s own account now. Only their passkey can move it.</Assure>}
      {done && (
        <div className="card receipt">
          <div className="row">
            <span>To</span>
            <strong>{flight.name}</strong>
          </div>
          <div className="row">
            <span>{url ? "Held for them" : "They got"}</span>
            <strong>{usd(amount)}</strong>
          </div>
          {rate && (
            <div className="row">
              <span>Worth in naira</span>
              <strong>{ngn(amount * rate)}</strong>
            </div>
          )}
          <div className="row">
            <span>Fee</span>
            <strong className="free">$0.00</strong>
          </div>
          <div className="row">
            <span>Confirmed in</span>
            <strong>{seconds(done.ms)}</strong>
          </div>
          <div className="row">
            <TxLink hash={done.hash} explorer={explorer} />
          </div>
        </div>
      )}
      {done && (
        <button className={url ? "ghost" : "primary big"} onClick={() => navigate("/")}>
          Done
        </button>
      )}
    </section>
  );
}
