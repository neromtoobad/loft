import type { Address, Hex, LocalAccount } from "viem";
import { AUTH_HEADER, authMessage, encodeAuth } from "../../../shared/auth.ts";

export type AppConfig = {
  network: "mainnet" | "testnet";
  chainId: number;
  ausd: Address;
  escrow: Address | null;
  relayer: Address;
  relayerGas: string;
  explorer: string;
  kimi: boolean;
  indexer: boolean;
  usdc: Address | null;
  convert: Address | null;
  /** Who quotes any-chain top-ups: Aurora Intents, or the NEAR Intents API it builds on. */
  topup: "aurora" | "near-intents" | null;
};

export type Corridor = {
  source: "envio" | "chain";
  totals: { volume: string; payments: number; accounts: number | null; topups: number; topupVolume: string };
  days: { day: string; volume: string; topupVolume: string; payments: number }[];
  recent: { kind: "DIRECT" | "LINK" | "ORDER" | "POT" | "TOPUP"; amount: string; at: number; txHash: string }[];
  confirm: { samples: number; avgMs: number | null; medianMs: number | null; fastestMs: number | null };
  gasWei: string;
  benchmark: { pct: number; source: string };
  ngnPerUsd: number | null;
};

export type TopUpSource = { id: string; chain: string; symbol: "USDC" | "USDT"; evm: boolean };

export type TopUpQuote = {
  provider: "aurora" | "near-intents";
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  timeEstimate: number;
  deadline?: string;
};

export type TopUpStatus = {
  status: "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
  originTx?: string;
  destinationTx?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, account?: LocalAccount): Promise<T> {
  const text = body === undefined ? "" : JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (account) {
    const timestamp = Date.now();
    const signature = await account.signMessage({ message: authMessage(method, path.split("?")[0], timestamp, text) });
    headers[AUTH_HEADER] = encodeAuth(account.address, timestamp, signature);
  }
  const res = await fetch(path, { method, headers, ...(body !== undefined ? { body: text } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText);
  return json as T;
}

export type TxResult = { hash: Hex; blockNumber: number };

export type LinkInfo = {
  sender: Address;
  senderHandle: string | null;
  senderCharacter: string | null;
  amount: string;
  claimed: boolean;
  expiry: number;
  sealedNote: string | null;
  txHash: string | null;
  recipient: Address | null;
};

export type Profile = { address: Address; handle: string | null; inboxKey: Hex; character: string | null };

export type OrderInfo = {
  id: number;
  sender: Address;
  recipient: Address;
  amount: string;
  budget: string;
  nextDue: number;
  period: number;
  mode: "fixed" | "topup";
  /** NGN per USD the rate must reach before a payment goes; 0 for none. */
  minRate: number;
  active: boolean;
};

export type PersonRef = { address: Address; handle: string | null; character: string | null; name?: string | null };

export type PotInfo = {
  id: number;
  title: string;
  beneficiary: PersonRef;
  organizer: PersonRef;
  target: string;
  raised: string;
  deadline: number;
  released: boolean;
  txHash: string | null;
  contributions: { from: Address; name: string; amount: string; txHash: Hex; at: number; character: string | null }[];
};

export type RequestInfo = {
  id: string;
  requester: Address;
  name: string;
  handle: string | null;
  character: string | null;
  amount: string;
  note: string;
  createdAt: number;
  paid: { by: Address; txHash: Hex; at: number; name: string | null } | null;
};

export type IndexedPayment = {
  id: string;
  kind: "DIRECT" | "LINK" | "ORDER" | "POT";
  from_id: Address;
  to_id: Address;
  amount: string;
  ngnPerUsd: string | null;
  ngnValue: string | null;
  ref: Hex | null;
  link_id: Address | null;
  order_id: string | null;
  txHash: Hex;
  timestamp: number;
};

export type ParsedIntent = {
  kind: "send" | "schedule" | "unknown";
  recipient: string | null;
  amount: number | null;
  currency: "USD" | "NGN" | null;
  mode: "fixed" | "topup";
  cadence: "daily" | "weekly" | "monthly" | null;
  weekday: number | null;
  count: number | null;
  note: string | null;
  explanation: string;
  usd: number | null;
  ngnPerUsd: number | null;
  /** Kimi when it's configured, else the built-in rules. */
  engine: "kimi" | "rules";
};

export const api = {
  config: () => call<AppConfig>("GET", "/api/config"),
  rate: () => call<{ ngnPerUsd: number; sources: string[] }>("GET", "/api/rate"),
  balance: (address: Address) => call<{ ausd: string; usdc: string }>("GET", `/api/balance/${address}`),

  corridor: () => call<Corridor>("GET", "/api/corridor"),

  topupSources: () => call<{ provider: string; sources: TopUpSource[] }>("GET", "/api/topup/sources"),
  topupQuote: (body: { source: string; amount: number; address: Address; refundTo?: string; dry?: boolean }) =>
    call<TopUpQuote>("POST", "/api/topup/quote", body),
  topupStatus: (depositAddress: string, depositMemo?: string) =>
    call<TopUpStatus>(
      "GET",
      `/api/topup/status?${new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) })}`,
    ),
  convertQuote: (amount: bigint) =>
    call<{ ausdOut: string; fee: string; filled: boolean }>("GET", `/api/convert/quote?amount=${amount}`),
  convert: (body: object) => call<TxResult & { ausdOut: string }>("POST", "/api/relay/convert", body),
  orders: (address: Address) => call<OrderInfo[]>("GET", `/api/orders/${address}`),
  activity: (address: Address) => call<IndexedPayment[]>("GET", `/api/activity/${address}`),

  send: (body: object) => call<TxResult>("POST", "/api/relay/send", body),
  createLink: (body: object) => call<TxResult>("POST", "/api/relay/link", body),
  link: (claimKey: Address) => call<LinkInfo>("GET", `/api/links/${claimKey}`),
  claim: (body: object) => call<TxResult>("POST", "/api/relay/claim", body),
  createOrder: (body: object) => call<TxResult>("POST", "/api/relay/order", body),
  closeOrder: (body: object) => call<TxResult>("POST", "/api/relay/close", body),

  createPot: (body: object) => call<TxResult & { potId: number }>("POST", "/api/relay/pot", body),
  pot: (id: number) => call<PotInfo>("GET", `/api/pots/${id}`),
  pots: (address: Address) => call<PotInfo[]>("GET", `/api/pots?address=${address}`),
  contribute: (body: object) => call<TxResult & { released: boolean }>("POST", "/api/relay/contribute", body),

  createRequest: (account: LocalAccount, body: { amount: string; note: string; name: string }) =>
    call<{ id: string }>("POST", "/api/requests", body, account),
  request: (id: string) => call<RequestInfo>("GET", `/api/requests/${encodeURIComponent(id)}`),
  requests: (address: Address) => call<RequestInfo[]>("GET", `/api/requests?address=${address}`),

  profile: (address: Address) => call<Profile>("GET", `/api/profiles/${address}`),
  handle: (handle: string) => call<Profile>("GET", `/api/handles/${encodeURIComponent(handle)}`),
  putProfile: (account: LocalAccount, handle: string | null, inboxKey: Hex, character: string | null) =>
    call<{ ok: true }>("PUT", `/api/profiles/${account.address}`, { handle, inboxKey, character }, account),
  notes: (account: LocalAccount, after = 0) =>
    call<{ id: number; sealed: string; tx_hash: string | null; created_at: number }[]>(
      "GET",
      `/api/notes?after=${after}`,
      undefined,
      account,
    ),

  getVault: (account: LocalAccount) => call<{ blob: string | null; version: number }>("GET", "/api/vault", undefined, account),
  putVault: (account: LocalAccount, blob: string, version: number) =>
    call<{ version: number }>("PUT", "/api/vault", { blob, version }, account),

  intent: (text: string, contacts: string[]) => call<ParsedIntent>("POST", "/api/intent", { text, contacts }),
};
