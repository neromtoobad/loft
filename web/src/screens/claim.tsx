import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fromUnits } from "../../../shared/money.ts";
import { navigate } from "../app.tsx";
import { type LinkInfo, api } from "../lib/api.ts";
import { openFromLink } from "../lib/crypto.ts";
import { ngn, seconds, short, usd } from "../lib/format.ts";
import { type Settled, useLoft } from "../state.tsx";
import { type Creature, CourierSprite, CreaturePicker, CreatureSprite, isCreature } from "../cast.tsx";
import { HouseMark } from "./welcome.tsx";
import { Assure, ErrorLine, TxLink, errorText } from "./ui.tsx";

function secretFromHash(): Hex | null {
  const raw = location.hash.replace(/^#/, "");
  return /^[0-9a-f]{64}$/i.test(raw) ? (`0x${raw}` as Hex) : null;
}

export function Claim() {
  const { session, vault, rate, config, create, unlock, claim, busy } = useLoft();
  const [secret] = useState(secretFromHash);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [message, setMessage] = useState<{ from: string; note: string } | null>(null);
  const [name, setName] = useState("");
  const [creature, setCreature] = useState<Creature | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Settled | null>(null);
  const wantsClaim = useRef(false);

  useEffect(() => {
    if (!secret) return;
    const claimKey = privateKeyToAccount(secret).address;
    api
      .link(claimKey)
      .then(async (i) => {
        setInfo(i);
        if (i.sealedNote) setMessage(JSON.parse(await openFromLink(secret, i.sealedNote)));
      })
      .catch((e) => setError(errorText(e)));
  }, [secret]);

  const from = message?.from || (info?.senderHandle ? `@${info.senderHandle}` : info ? short(info.sender) : "");

  // After a new account is created (or an old one unlocked), finish the claim.
  useEffect(() => {
    if (!wantsClaim.current || !session || !vault || !secret || done) return;
    wantsClaim.current = false;
    setReceiving(true);
    claim(secret, from, message?.note || undefined)
      .then((settled) => {
        setDone(settled);
        history.replaceState(null, "", "/c");
      })
      .catch((e) => {
        setReceiving(false);
        setError(errorText(e));
      });
  }, [session, vault, secret, done, claim, from, message]);

  async function receive(fn?: () => Promise<void>) {
    setError(null);
    wantsClaim.current = true;
    try {
      if (fn) await fn();
      else if (session && vault && secret) {
        wantsClaim.current = false;
        setReceiving(true);
        setDone(await claim(secret, from, message?.note || undefined));
        history.replaceState(null, "", "/c");
      }
    } catch (e) {
      wantsClaim.current = false;
      setReceiving(false);
      setError(errorText(e));
    }
  }

  const dollars = info ? fromUnits(info.amount) : 0;
  const mine: Creature = isCreature(vault?.character) ? vault.character : (creature ?? "pangolin");
  const theirs: Creature | null = isCreature(info?.senderCharacter) ? info.senderCharacter : null;

  if (done) {
    return (
      <section className="done">
        <div className="stage">
          <CreatureSprite kind={mine} pose="cheer" size={150} label="You" />
          <CourierSprite pose="salute" size={110} />
        </div>
        <h2 className="display">{usd(dollars)} is yours</h2>
        <p className="lede">
          It's in your Loft as real dollars, confirmed on Monad in {seconds(done.ms)}. Keep it as dollars or send it on.
        </p>
        <Assure>Only your face or fingerprint can move it.</Assure>
        <Assure>Nobody can take it back. Not the sender, not Loft.</Assure>
        <TxLink hash={done.hash} explorer={config?.explorer} />
        <button className="primary" onClick={() => navigate("/")}>
          See my Loft
        </button>
      </section>
    );
  }

  if (!secret) {
    return (
      <section className="claim">
        <HouseMark />
        <h2 className="display">This link is incomplete</h2>
        <p className="lede">Ask the person who sent it to share it again.</p>
      </section>
    );
  }

  return (
    <section className="claim">
      <div className="stage claim-stage">
        {receiving ? (
          <>
            <CourierSprite pose="handoff" size={104} />
            <CreatureSprite kind={mine} pose="catch" size={140} flip label="You" />
          </>
        ) : (
          <>
            {theirs && <CreatureSprite kind={theirs} pose="wave" size={96} label={from} />}
            <CourierSprite pose="perch" size={140} />
          </>
        )}
      </div>
      {!info && !error && <p className="muted">Opening your link…</p>}
      {info && (
        <>
          <p className="label">{from} sent you</p>
          <p className="amount display">{usd(dollars)}</p>
          {rate && <p className="sub">≈ {ngn(dollars * rate)}</p>}
          {message?.note && <blockquote className="note">“{message.note}”</blockquote>}

          {info.claimed ? (
            <p className="lede">This money has already been received.</p>
          ) : session && vault ? (
            <button className="primary big" disabled={Boolean(busy)} onClick={() => receive()}>
              Receive into my Loft
            </button>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && creature) receive(() => create(name.trim(), creature));
              }}
            >
              <div className="trust">
                <span>No bank account</span>
                <span>No app to install</span>
                <span>No fees</span>
              </div>
              <label className="field">
                <span>Your first name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="So they know it reached you" maxLength={40} />
              </label>
              <span className="field-label">Pick your creature</span>
              <CreaturePicker value={creature} onChange={setCreature} />
              <button className="primary big" disabled={!name.trim() || !creature || Boolean(busy)}>
                Receive with passkey
              </button>
              <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => receive(unlock)}>
                I already have a Loft
              </button>
              <p className="fineprint">One tap with your face or fingerprint makes your Loft. The money is yours alone, and stays in dollars.</p>
            </form>
          )}
        </>
      )}
      <ErrorLine error={error} />
    </section>
  );
}
