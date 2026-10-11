// "Add money from any chain": Aurora Intents swaps a stablecoin on another
// chain into USDC on the user's Loft address on Monad. The app then turns that
// USDC into AUSD through LoftConvert (one passkey signature, no gas).
//
// With AURORA_APP_KEY set, quotes go through Aurora's Intents API (and earn
// the app its fee share); without it, the same request goes to the public
// NEAR Intents 1Click API that Aurora builds on, so the flow still works.

/** Where USDC lands: Circle USDC on Monad, as NEAR Intents names it. */
const MONAD_USDC = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";

export type Source = {
  id: string;
  chain: string;
  symbol: "USDC" | "USDT";
  assetId: string;
  decimals: number;
  /** EVM chains refund to the user's own Loft address, which they control there too. */
  evm: boolean;
};

export const SOURCES: Source[] = [
  { id: "base-usdc", chain: "Base", symbol: "USDC", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, evm: true },
  { id: "arb-usdc", chain: "Arbitrum", symbol: "USDC", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, evm: true },
  { id: "eth-usdc", chain: "Ethereum", symbol: "USDC", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, evm: true },
  { id: "op-usdc", chain: "Optimism", symbol: "USDC", assetId: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ", decimals: 6, evm: true },
  { id: "pol-usdc", chain: "Polygon", symbol: "USDC", assetId: "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L", decimals: 6, evm: true },
  { id: "sol-usdc", chain: "Solana", symbol: "USDC", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, evm: false },
  { id: "tron-usdt", chain: "Tron", symbol: "USDT", assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", decimals: 6, evm: false },
];

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
  amountOut?: string;
};

function endpoints() {
  const key = process.env.AURORA_APP_KEY;
  return key
    ? {
        provider: "aurora" as const,
        quote: `https://intents-api.aurora.dev/api/quote/${key}`,
        status: (q: string) => `https://intents-api.aurora.dev/api/status/${key}?${q}`,
      }
    : {
        provider: "near-intents" as const,
        quote: "https://1click.chaindefuser.com/v0/quote",
        status: (q: string) => `https://1click.chaindefuser.com/v0/status?${q}`,
      };
}

export const topupProvider = () => endpoints().provider;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `intents ${res.status}`);
  return body as T;
}

/** A live deposit address that turns `amount` of `source` into USDC on `recipient`'s Monad address. */
export async function quoteTopUp(p: { source: Source; amount: number; recipient: string; refundTo: string; dry?: boolean }): Promise<TopUpQuote> {
  const e = endpoints();
  const units = BigInt(Math.round(p.amount * 10 ** p.source.decimals)).toString();
  const r = await call<{ quote: any }>(e.quote, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: Boolean(p.dry),
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: p.source.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: MONAD_USDC,
      amount: units,
      recipient: p.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: p.refundTo,
      refundType: "ORIGIN_CHAIN",
      // The deposit address stays open for an hour, time enough to move funds from an exchange.
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  const q = r.quote;
  return {
    provider: e.provider,
    depositAddress: q.depositAddress ?? "",
    depositMemo: q.depositMemo || undefined,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOut: q.minAmountOut,
    timeEstimate: q.timeEstimate,
    deadline: q.deadline,
  };
}

export async function topUpStatus(depositAddress: string, depositMemo?: string): Promise<TopUpStatus> {
  const q = new URLSearchParams({ depositAddress });
  if (depositMemo) q.set("depositMemo", depositMemo);
  const r = await call<any>(endpoints().status(q.toString()));
  const d = r.swapDetails ?? {};
  return {
    status: r.status,
    originTx: d.originChainTxHashes?.[0]?.hash,
    destinationTx: d.destinationChainTxHashes?.[0]?.hash,
    amountOut: d.amountOut,
  };
}
