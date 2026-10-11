// The public corridor page: what has moved London → Lagos on Loft, how fast
// it confirmed, and what the same money would have cost the usual way.
// Anyone can open it; nothing on it identifies a person.
import { useEffect, useState } from "react";
import { navigate } from "../app.tsx";
import { type Corridor, api } from "../lib/api.ts";
import { ago, ngn, seconds, usd } from "../lib/format.ts";
import { useLoft } from "../state.tsx";
import { Label, LoftMark, Postmark, stampDate } from "./ui.tsx";

const KIND: Record<Corridor["recent"][number]["kind"], string> = {
  DIRECT: "Sent home",
  LINK: "Link claimed",
  ORDER: "Scheduled, by Chainlink",
  POT: "Family pot paid out",
  TOPUP: "Arrived from another chain",
};

function Bars({ days }: { days: Corridor["days"] }) {
  const max = Math.max(1, ...days.map((d) => Number(d.volume) + Number(d.topupVolume)));
  const W = 300;
  const H = 120;
  const gap = 2;
  const w = (W - gap * (days.length - 1)) / days.length;
  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Daily volume, last 30 days">
      {days.map((d, i) => {
        const sent = (Number(d.volume) / max) * H;
        const inflow = (Number(d.topupVolume) / max) * H;
        const x = i * (w + gap);
        return (
          <g key={d.day}>
            <title>
              {d.day}: {usd(d.volume)} sent{Number(d.topupVolume) ? `, ${usd(d.topupVolume)} arrived from other chains` : ""}
            </title>
            <rect x={x} y={0} width={w} height={H} rx={2} className="bar-bg" />
            <rect x={x} y={H - sent} width={w} height={sent} rx={2} className="bar-sent" />
            <rect x={x} y={H - sent - inflow} width={w} height={inflow} rx={2} className="bar-in" />
          </g>
        );
      })}
      <text x={0} y={H + 14} className="bar-axis">
        {days[0]?.day.slice(5)}
      </text>
      <text x={W} y={H + 14} textAnchor="end" className="bar-axis">
        Today
      </text>
    </svg>
  );
}

export function CorridorPage() {
  const { session, config } = useLoft();
  const [data, setData] = useState<Corridor | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .corridor()
        .then((d) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const volume = data ? Number(data.totals.volume) / 1e6 : 0;
  const saved = (volume * (data?.benchmark.pct ?? 0)) / 100;
  const bench200 = (200 * (data?.benchmark.pct ?? 8.78)) / 100;
  const median = data?.confirm.medianMs ?? null;

  return (
    <section className="corridor">
      <header className="corridor-head">
        <button className="brand" onClick={() => navigate("/")} aria-label="Loft home">
          <LoftMark size={26} /> Loft
        </button>
        <Label live>Live on Monad</Label>
      </header>

      <div className="hero corridor-hero">
        <Label>The corridor · {stampDate()}</Label>
        <h1 className="display">
          London <span className="arrow">→</span> <em>Lagos</em>
        </h1>
        <p className="hero-sub">Every dollar Loft has moved home, counted from the chain.</p>
        <span className="receipt-mark static corridor-mark">
          <Postmark top="Median" bottom={median ? seconds(median).toUpperCase() : "—"} />
        </span>
      </div>

      <div className="stat-grid">
        <div className="card stat">
          <span className="stat-label">Moved home</span>
          <strong>{data ? usd(data.totals.volume) : "…"}</strong>
          <span className="stat-sub">{data && data.ngnPerUsd ? `≈ ${ngn(volume * data.ngnPerUsd)}` : " "}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Payments</span>
          <strong>{data ? data.totals.payments.toLocaleString() : "…"}</strong>
          <span className="stat-sub">{data?.totals.accounts != null ? `${data.totals.accounts} people` : " "}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Tap to confirmed</span>
          <strong>{median ? seconds(median) : data ? "—" : "…"}</strong>
          <span className="stat-sub">
            {data?.confirm.fastestMs ? `fastest ${seconds(data.confirm.fastestMs)} · ${data.confirm.samples} txs` : " "}
          </span>
        </div>
        <div className="card stat accent">
          <span className="stat-label">Fees saved</span>
          <strong>{data ? usd(saved) : "…"}</strong>
          <span className="stat-sub">vs. {data?.benchmark.pct ?? 8.78}% average</span>
        </div>
      </div>

      <div className="card chart-card">
        <div className="card-head">
          <h3>Last 30 days</h3>
          <span className="legend">
            <i className="sent" /> Sent home <i className="in" /> From other chains
          </span>
        </div>
        {data ? <Bars days={data.days} /> : <div className="shimmer chart-shimmer" />}
        {data && Number(data.totals.topupVolume) > 0 && (
          <p className="muted small">
            {usd(data.totals.topupVolume)} arrived from Base, Arbitrum and other chains through Aurora Intents, across {data.totals.topups} top-ups.
          </p>
        )}
      </div>

      <div className="card compare">
        <h3>Sending $200 home</h3>
        <div className="compare-row">
          <span>The usual way</span>
          <span className="compare-bar">
            <span style={{ width: "100%" }} />
          </span>
          <strong>{usd(bench200)}</strong>
        </div>
        <div className="compare-row loft">
          <span>Loft</span>
          <span className="compare-bar">
            <span style={{ width: "2%" }} />
          </span>
          <strong>$0.00</strong>
        </div>
        <p className="muted small">
          The usual way: the World Bank's average total cost of sending $200 to Sub-Saharan Africa ({data?.benchmark.pct ?? 8.78}%,{" "}
          <a href={data?.benchmark.source ?? "https://remittanceprices.worldbank.org/"} target="_blank" rel="noreferrer">
            Remittance Prices Worldwide
          </a>
          , Q1 2025). On Loft the sender pays nothing; Loft covers the network fee.
        </p>
      </div>

      <div className="card recent">
        <div className="card-head">
          <h3>Just now</h3>
          <Label>{data?.source === "envio" ? "Indexed by Envio" : "Read from Monad"}</Label>
        </div>
        {data?.recent.length === 0 && <p className="muted small">Nothing yet. The first one is on its way.</p>}
        {data?.recent.map((r) => (
          <a
            key={r.txHash}
            className="row activity"
            href={`${config?.explorer ?? "https://monadvision.com"}/tx/${r.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="who">
              {KIND[r.kind]}
              <small>{ago(r.at)}</small>
            </span>
            <span className={`amt ${r.kind === "TOPUP" ? "in" : ""}`}>{usd(r.amount)}</span>
          </a>
        ))}
        {error && <p className="muted small">Couldn't refresh just now; showing the last numbers.</p>}
      </div>

      <p className="fineprint corridor-foot">
        Dollars are Agora AUSD on Monad. Payments are read from LoftEscrow{data?.source === "envio" ? " by an Envio HyperIndex indexer" : ""};
        confirmation times are measured by Loft's relayer from submission to receipt. Naira at today's rate.
      </p>
      {!session && (
        <button className="primary big" onClick={() => navigate("/")}>
          Send money home with Loft
        </button>
      )}
    </section>
  );
}
