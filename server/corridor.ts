// The public corridor page: how much has moved London → Lagos on Loft, how
// fast it confirmed, and what it would have cost through the usual routes.
// Volumes come from the Envio indexer when ENVIO_GRAPHQL_URL is set;
// otherwise a small follower reads the same events from the chain itself.
// Either way that includes Chainlink-run orders the relayer never touches.
// Confirmation times are the relayer's own measurement, since they aren't
// onchain.
import { type Abi, type Address, type Log, type PublicClient, parseEventLogs } from "viem";
import { type Network, convertAbi, escrowAbi } from "../shared/config.ts";
import type { Store } from "./store.ts";

/**
 * World Bank Remittance Prices Worldwide, Q1 2025: the average total cost of
 * sending $200 to Sub-Saharan Africa, the most expensive region.
 */
export const BENCHMARK_PCT = 8.78;
export const BENCHMARK_SOURCE = "https://remittanceprices.worldbank.org/";

export type Kind = "DIRECT" | "LINK" | "ORDER" | "POT" | "TOPUP";

const abi = [...(escrowAbi as Abi), ...convertAbi] as Abi;

/** The payments in a batch of LoftEscrow / LoftConvert logs. */
export function moves(logs: Log[]): { id: string; kind: Kind; amount: bigint; txHash: string; blockNumber: bigint }[] {
  const out = [];
  for (const log of parseEventLogs({ abi, logs, strict: false }) as any[]) {
    const a = log.args ?? {};
    let m: { kind: Kind; amount: bigint } | null = null;
    switch (log.eventName) {
      case "Sent":
        m = { kind: "DIRECT", amount: a.amount };
        break;
      case "LinkClaimed":
        // A sender reclaiming their own link isn't a payment.
        if (String(a.recipient).toLowerCase() !== String(a.sender).toLowerCase()) m = { kind: "LINK", amount: a.amount };
        break;
      case "Remitted":
        m = { kind: "ORDER", amount: a.amount };
        break;
      case "PotReleased":
        if (a.amount > 0n) m = { kind: "POT", amount: a.amount };
        break;
      case "Converted":
        m = { kind: "TOPUP", amount: a.ausdOut };
        break;
    }
    if (m) out.push({ ...m, id: `${log.transactionHash}-${log.logIndex}`, txHash: log.transactionHash, blockNumber: log.blockNumber });
  }
  return out;
}

/**
 * Reads payments from the chain into the store, 100 blocks at a time (the
 * public RPC's limit), from the escrow's deploy block. Only used when the
 * Envio indexer isn't configured.
 */
export function followChain(pc: PublicClient, network: Network, store: Store) {
  if (!network.escrow || !network.escrowBlock) return;
  const addresses = [network.escrow, network.convert].filter(Boolean) as Address[];
  const key = `follow:${network.escrow.toLowerCase()}`;
  let cursor = BigInt(store.get(key) ?? network.escrowBlock);
  const times = new Map<bigint, number>();
  const at = async (n: bigint) => {
    if (!times.has(n)) times.set(n, Number((await pc.getBlock({ blockNumber: n })).timestamp) * 1000);
    if (times.size > 500) times.clear();
    return times.get(n)!;
  };
  const step = async () => {
    const head = await pc.getBlockNumber();
    while (cursor <= head) {
      const to = cursor + 99n > head ? head : cursor + 99n;
      const logs = await pc.getLogs({ address: addresses, fromBlock: cursor, toBlock: to });
      for (const m of moves(logs)) store.addChainPayment({ id: m.id, kind: m.kind, amount: m.amount, txHash: m.txHash, at: await at(m.blockNumber) });
      cursor = to + 1n;
      store.set(key, cursor.toString());
    }
  };
  const loop = async () => {
    try {
      await step();
    } catch (err) {
      console.error("follower:", (err as Error).message);
    }
    setTimeout(loop, 15_000);
  };
  loop();
}

export type Corridor = {
  source: "envio" | "chain";
  totals: { volume: string; payments: number; accounts: number | null; topups: number; topupVolume: string };
  days: { day: string; volume: string; topupVolume: string; payments: number }[];
  recent: { kind: Kind; amount: string; at: number; txHash: string }[];
  confirm: { samples: number; avgMs: number | null; medianMs: number | null; fastestMs: number | null };
  gasWei: string;
  benchmark: { pct: number; source: string };
};

const QUERY = `query Corridor($since: String!) {
  Totals(where: {id: {_eq: "all"}}) { volume payments accounts topups topupVolume }
  DailyStats(where: {id: {_gte: $since}}, order_by: {id: asc}) { id volume topupVolume payments }
  Payment(order_by: {timestamp: desc}, limit: 12) { kind amount timestamp txHash }
  TopUp(order_by: {timestamp: desc}, limit: 6) { ausdOut timestamp txHash }
}`;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function lastDays(n: number) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(Date.now() - i * 86400_000));
  return out;
}

function gasPaid(store: Store) {
  return store
    .relays()
    .reduce((s, r) => s + BigInt(r.gas_wei), 0n)
    .toString();
}

function confirmations(store: Store) {
  const ms = store
    .relays()
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  return {
    samples: ms.length,
    avgMs: ms.length ? Math.round(ms.reduce((s, x) => s + x, 0) / ms.length) : null,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    fastestMs: ms.length ? ms[0] : null,
  };
}

async function fromEnvio(url: string, store: Store): Promise<Corridor> {
  const days = lastDays(30);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { since: days[0] } }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (!res.ok || json.errors) throw new Error(json.errors?.[0]?.message ?? `indexer ${res.status}`);
  const d = json.data;
  const t = d.Totals[0] ?? { volume: "0", payments: 0, accounts: 0, topups: 0, topupVolume: "0" };
  const byDay = new Map<string, any>(d.DailyStats.map((x: any) => [x.id, x]));
  const recent = [
    ...d.Payment.map((p: any) => ({ kind: p.kind, amount: String(p.amount), at: p.timestamp * 1000, txHash: p.txHash })),
    ...d.TopUp.map((p: any) => ({ kind: "TOPUP" as const, amount: String(p.ausdOut), at: p.timestamp * 1000, txHash: p.txHash })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  return {
    source: "envio",
    totals: { volume: String(t.volume), payments: t.payments, accounts: t.accounts, topups: t.topups, topupVolume: String(t.topupVolume) },
    days: days.map((day) => {
      const x = byDay.get(day);
      return { day, volume: String(x?.volume ?? 0), topupVolume: String(x?.topupVolume ?? 0), payments: x?.payments ?? 0 };
    }),
    recent,
    confirm: confirmations(store),
    gasWei: gasPaid(store),
    benchmark: { pct: BENCHMARK_PCT, source: BENCHMARK_SOURCE },
  };
}

function fromChain(store: Store): Corridor {
  const rows = store.chainPayments();
  const pay = rows.filter((r) => r.kind !== "TOPUP");
  const topups = rows.filter((r) => r.kind === "TOPUP");
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + BigInt(r.amount), 0n);
  const days = lastDays(30).map((day) => {
    const on = rows.filter((r) => dayOf(r.at) === day);
    return {
      day,
      volume: sum(on.filter((r) => r.kind !== "TOPUP")).toString(),
      topupVolume: sum(on.filter((r) => r.kind === "TOPUP")).toString(),
      payments: on.filter((r) => r.kind !== "TOPUP").length,
    };
  });
  return {
    source: "chain",
    totals: { volume: sum(pay).toString(), payments: pay.length, accounts: null, topups: topups.length, topupVolume: sum(topups).toString() },
    days,
    recent: rows.slice(0, 12).map((r) => ({ kind: r.kind as Kind, amount: r.amount, at: r.at, txHash: r.tx_hash })),
    confirm: confirmations(store),
    gasWei: gasPaid(store),
    benchmark: { pct: BENCHMARK_PCT, source: BENCHMARK_SOURCE },
  };
}

let cache: { at: number; value: Corridor } | null = null;

export async function corridor(store: Store): Promise<Corridor> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const url = process.env.ENVIO_GRAPHQL_URL;
  let value: Corridor;
  try {
    value = url ? await fromEnvio(url, store) : fromChain(store);
  } catch (err) {
    console.error("corridor:", (err as Error).message);
    value = fromChain(store);
  }
  cache = { at: Date.now(), value };
  return value;
}
