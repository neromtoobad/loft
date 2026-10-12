// Adding money. Most people abroad hold USDC on Base or Arbitrum (or USDT on
// Tron), not AUSD on Monad, so the default is "from another chain": Aurora
// Intents opens a deposit address there, delivers USDC to this Loft address
// on Monad, and LoftConvert turns it into AUSD with one signature, no gas.
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { navigate } from "../app.tsx";
import { type TopUpQuote, type TopUpSource, type TopUpStatus, api } from "../lib/api.ts";
import { seconds, usd } from "../lib/format.ts";
import { type Settled, useLoft } from "../state.tsx";
import { ErrorLine, Label, Point, Postmark, TopBar, TxLink, errorText } from "./ui.tsx";

const SAVED = "loft.topup.v1";
type Active = { quote: TopUpQuote; source: TopUpSource; startedAt: number };

function loadActive(): Active | null {
  try {
    const a = JSON.parse(localStorage.getItem(SAVED) ?? "null") as Active | null;
    // Deposit addresses are quoted for an hour; past that, start over.
    return a && Date.now() - a.startedAt < 2 * 3600_000 ? a : null;
  } catch {
    return null;
  }
}

function saveActive(a: Active | null) {
  try {
    if (a) localStorage.setItem(SAVED, JSON.stringify(a));
    else localStorage.removeItem(SAVED);
  } catch {
    // Storage can be off (private mode); the top-up still works in this tab.
  }
}

function Qr({ value }: { value: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [value]);
  return <div className="qr" aria-label="QR code of the deposit address" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function CopyButton({ value, label, className = "secondary" }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function Add() {
  const { session, config } = useLoft();
  const crossChain = Boolean(config?.topup);
  const [tab, setTab] = useState<"chain" | "monad">("chain");
  if (!session) return null;
  const mode = crossChain ? tab : "monad";

  return (
    <section className="add">
      <TopBar title="Add money" />
      {crossChain && (
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === "chain"} className={mode === "chain" ? "on" : ""} onClick={() => setTab("chain")}>
            From any chain
          </button>
          <button role="tab" aria-selected={mode === "monad"} className={mode === "monad" ? "on" : ""} onClick={() => setTab("monad")}>
            AUSD on Monad
          </button>
        </div>
      )}
      {mode === "chain" ? <FromAnyChain /> : <OnMonad />}
    </section>
  );
}

function OnMonad() {
  const { session, config } = useLoft();
  const address = session?.account.address ?? "";
  return (
    <>
      <p className="lede">
        Send Agora dollars (AUSD) on Monad to this address from any wallet or exchange. They show up here in about a second.
      </p>
      <Qr value={address} />
      <p className="mono address">{address}</p>
      <CopyButton value={address} label="Copy address" className="primary big" />
      <p className="fineprint">
        Only send AUSD on {config?.network === "testnet" ? "Monad testnet" : "Monad"}. Other tokens or networks sent here won't show as dollars.
      </p>
    </>
  );
}

const STEPS: { key: string; label: string }[] = [
  { key: "deposit", label: "Waiting for your deposit" },
  { key: "seen", label: "Deposit seen" },
  { key: "bridge", label: "Crossing to Monad" },
  { key: "dollars", label: "Turned into Loft dollars" },
];

function stepIndex(status: TopUpStatus["status"] | null, converted: boolean) {
  if (converted) return 4;
  switch (status) {
    case "KNOWN_DEPOSIT_TX":
      return 1;
    case "PROCESSING":
      return 2;
    case "SUCCESS":
      return 3;
    default:
      return 0;
  }
}

function FromAnyChain() {
  const { session, config, usdc, convertUsdc, busy } = useLoft();
  const [sources, setSources] = useState<TopUpSource[]>([]);
  const [source, setSource] = useState<TopUpSource | null>(null);
  const [amount, setAmount] = useState("20");
  const [refundTo, setRefundTo] = useState("");
  const [preview, setPreview] = useState<TopUpQuote | null>(null);
  const [active, setActive] = useState<Active | null>(loadActive);
  const [status, setStatus] = useState<TopUpStatus | null>(null);
  const [converted, setConverted] = useState<(Settled & { ausdOut: bigint }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    api
      .topupSources()
      .then((r) => {
        setSources(r.sources);
        setSource((s) => s ?? r.sources[0] ?? null);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  const n = Number(amount);
  const needsRefund = source ? !source.evm : false;

  // A live, no-commitment quote while the amount is being picked.
  useEffect(() => {
    setPreview(null);
    if (!session || !source || !(n >= 1) || active) return;
    // Quotes take a second or two; one for an amount or chain that's since changed must not land.
    let current = true;
    const t = setTimeout(() => {
      api
        .topupQuote({ source: source.id, amount: n, address: session.account.address, refundTo: refundTo || undefined, dry: true })
        .then((q) => current && setPreview(q))
        .catch((e) => current && setError(errorText(e)));
    }, 400);
    setError(null);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [session, source, n, refundTo, active]);

  // Follow the deposit through to Monad.
  useEffect(() => {
    if (!active || converted) return;
    let stop = false;
    const tick = () =>
      api
        .topupStatus(active.quote.depositAddress, active.quote.depositMemo)
        .then((s) => !stop && setStatus(s))
        .catch(() => undefined);
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, converted]);

  // Once the USDC is on this address, make it dollars. The user asked for
  // dollars when they started the top-up, so this needs no second tap.
  useEffect(() => {
    if (!active || converted || busy || status?.status !== "SUCCESS" || usdc === 0n) return;
    convertUsdc()
      .then((r) => {
        setConverted(r);
        saveActive(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [active, converted, busy, status, usdc, convertUsdc]);

  async function open() {
    if (!session || !source) return;
    setOpening(true);
    setError(null);
    try {
      const quote = await api.topupQuote({ source: source.id, amount: n, address: session.account.address, refundTo: refundTo || undefined });
      const a = { quote, source, startedAt: Date.now() };
      saveActive(a);
      setActive(a);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOpening(false);
    }
  }

  function reset() {
    saveActive(null);
    setActive(null);
    setStatus(null);
    setConverted(null);
  }

  const provider = config?.topup === "aurora" ? "Aurora Intents" : "NEAR Intents";

  if (active) {
    const { quote, source: src } = active;
    const step = stepIndex(status?.status ?? null, Boolean(converted));
    const failed = status?.status === "REFUNDED" || status?.status === "FAILED";
    return (
      <>
        {converted ? (
          <div className="card paid-card">
            <span className="receipt-mark static">
              <Postmark top="Arrived" bottom={src.chain.toUpperCase()} />
            </span>
            <h3>{usd(converted.ausdOut)} added</h3>
            <p className="muted">
              From {src.symbol} on {src.chain}, now Loft dollars on Monad. The last step took {seconds(converted.ms)} and cost you nothing.
            </p>
            <TxLink hash={converted.hash} explorer={config?.explorer} />
          </div>
        ) : (
          <>
            <p className="lede">
              Send <strong>exactly {quote.amountInFormatted} {src.symbol}</strong> on <strong>{src.chain}</strong> to this address, from any
              wallet or exchange.
            </p>
            <Qr value={quote.depositAddress} />
            <p className="mono address">{quote.depositAddress}</p>
            <div className="inline even">
              <CopyButton value={quote.depositAddress} label="Copy address" />
              <CopyButton value={quote.amountInFormatted} label="Copy amount" />
            </div>
            {quote.depositMemo && (
              <p className="fineprint">
                Memo: <span className="mono">{quote.depositMemo}</span> (include it or the deposit can't be matched)
              </p>
            )}
          </>
        )}

        <ol className="track card">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < step ? "done" : i === step && !failed ? "now" : ""}>
              <span className="dot" aria-hidden />
              {s.label}
              {i === 3 && busy && !converted ? " …" : ""}
            </li>
          ))}
        </ol>
        {failed && (
          <p className="error" role="alert">
            {status?.status === "REFUNDED"
              ? `The swap couldn't complete, so your ${src.symbol} went back to ${src.evm ? "your address" : "your refund address"} on ${src.chain}.`
              : "The swap failed. Nothing was taken; try again."}
          </p>
        )}
        {!converted && !failed && (
          <div className="card points">
            <Point icon="check">
              You'll get about {usd(Number(quote.amountOut) / 1e6)} in Loft dollars, usually within {Math.max(1, Math.round(quote.timeEstimate / 60))}{" "}
              min.
            </Point>
            <Point icon="lock">Routed by {provider}. If it can't complete, it refunds on {src.chain}.</Point>
          </div>
        )}
        <ErrorLine error={error} />
        {converted ? (
          <button className="primary big" onClick={() => navigate("/")}>
            Done
          </button>
        ) : (
          <button className="ghost" onClick={reset}>
            {failed ? "Start again" : "Cancel and pick another chain"}
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <p className="lede">Top up from the stablecoins you already have. They arrive here as dollars on Monad.</p>
      {usdc > 0n && (
        <UsdcWaiting />
      )}
      <span className="field-label">From</span>
      <div className="reason-chips">
        {sources.map((s) => (
          <button key={s.id} type="button" className={`chip-btn ${source?.id === s.id ? "on" : ""}`} onClick={() => setSource(s)}>
            {s.symbol} · {s.chain}
          </button>
        ))}
      </div>
      <div className="converter">
        <div className="leg">
          <label htmlFor="topup-amount">You send</label>
          <div className="leg-row">
            <input id="topup-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            <span className="ccy static">{source?.symbol ?? "USDC"}</span>
          </div>
          <div className="leg-sub">on {source?.chain ?? "…"}</div>
        </div>
        <div className="leg">
          <span className="leg-label">You get</span>
          <div className="leg-row">
            <span className="leg-value">{preview ? usd(Number(preview.amountOut) / 1e6) : "…"}</span>
            <span className="ccy static">USD</span>
          </div>
          <div className="leg-sub">{preview ? `in Loft · about ${Math.max(1, Math.round(preview.timeEstimate / 60))} min` : "Getting a quote"}</div>
        </div>
      </div>
      {needsRefund && (
        <label className="field">
          <span>Your {source?.chain} address, for refunds</span>
          <input value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} placeholder="Only used if the swap can't complete" />
        </label>
      )}
      <ErrorLine error={error} />
      <button className="primary big" disabled={!(n >= 1) || opening || (needsRefund && !refundTo)} onClick={open}>
        {opening ? "Opening…" : "Get a deposit address"}
      </button>
      <p className="fineprint">
        Cross-chain by {provider}. The USDC lands on your Loft address on Monad and becomes AUSD through a public Trader Joe pool, one signature, no
        gas.
      </p>
    </>
  );
}

/** USDC that's already here (an earlier top-up, or sent directly) and one tap to make it dollars. */
export function UsdcWaiting() {
  const { usdc, convertUsdc, busy, config } = useLoft();
  const [done, setDone] = useState<(Settled & { ausdOut: bigint }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return (
      <div className="card usdc-card">
        <Label>Added</Label>
        <p>
          {usd(done.ausdOut)} is now in your Loft. Took {seconds(done.ms)}.
        </p>
        <TxLink hash={done.hash} explorer={config?.explorer} />
      </div>
    );
  }
  if (usdc === 0n) return null;
  return (
    <div className="card usdc-card">
      <Label live>USDC arrived</Label>
      <p>{usd(usdc)} in USDC is on your address. Make it Loft dollars to send it.</p>
      <ErrorLine error={error} />
      <button
        className="primary"
        disabled={Boolean(busy)}
        onClick={() =>
          convertUsdc()
            .then(setDone)
            .catch((e) => setError(errorText(e)))
        }
      >
        Make it dollars
      </button>
    </div>
  );
}
