import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { type Address, type Hex, formatUnits, getAddress, isAddress, isHex, keccak256, toBytes, verifyMessage } from "viem";
import { AUTH_HEADER, AUTH_WINDOW_MS, authMessage, decodeAuth } from "../shared/auth.ts";
import { AUSD_DECIMALS, NETWORKS, type NetworkName, ausdAbi, escrowAbi, lbPairAbi } from "../shared/config.ts";
import { parseIntent, ruleIntent } from "./intent.ts";
import { corridor, followChain } from "./corridor.ts";
import { ngnPerUsd } from "./rate.ts";
import { createRelayer } from "./relayer.ts";
import { SOURCES, quoteTopUp, topUpStatus, topupProvider } from "./topup.ts";
import { openStore } from "./store.ts";

// Load .env when running locally; Railway injects variables directly.
if (existsSync(".env")) process.loadEnvFile(".env");

const base = NETWORKS[(process.env.NETWORK as NetworkName) ?? "mainnet"];
if (!base) throw new Error(`unknown NETWORK ${process.env.NETWORK}`);
// ESCROW_ADDRESS points at a local fork or a fresh deploy without editing deployments.json.
const network = { ...base, escrow: (process.env.ESCROW_ADDRESS as Address | undefined) ?? base.escrow };
const store = openStore(process.env.DATA_DIR ?? "./data");
// Every landed transaction goes in the relay log, for the corridor page's confirmation times.
const relayer = createRelayer(network, process.env.RELAYER_PRIVATE_KEY as Hex, process.env.RPC_URL, (c) =>
  store.recordRelay({ txHash: c.hash, fn: c.functionName, ms: c.ms, gasWei: c.gasWei }),
);
// Without the Envio indexer, the corridor page reads payments from the chain itself.
if (!process.env.ENVIO_GRAPHQL_URL && !process.env.ESCROW_ADDRESS) followChain(relayer.publicClient as any, network, store);

const app = new Hono();

// ------------------------------------------------------------------ helpers

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  // Simulation failures carry the revert reason, which is what the app needs.
  const message = (err as any).shortMessage ?? err.message;
  console.error(c.req.method, c.req.path, message);
  return c.json({ error: message }, 400);
});

function addr(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v)) throw new HttpError(400, `${field} must be an address`);
  return v;
}

function hex(v: unknown, field: string): Hex {
  if (typeof v !== "string" || !isHex(v)) throw new HttpError(400, `${field} must be hex`);
  return v;
}

function big(v: unknown, field: string): bigint {
  try {
    const n = BigInt(v as string);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new HttpError(400, `${field} must be a non-negative integer`);
  }
}

/** Verifies the account signature on a request and returns who made it. */
async function signer(c: Context, body: string): Promise<Address> {
  const auth = decodeAuth(c.req.header(AUTH_HEADER));
  if (!auth || !isAddress(auth.address)) throw new HttpError(401, "missing signature");
  if (Math.abs(Date.now() - auth.timestamp) > AUTH_WINDOW_MS) throw new HttpError(401, "signature expired");
  const ok = await verifyMessage({
    address: auth.address,
    message: authMessage(c.req.method, c.req.path, auth.timestamp, body),
    signature: auth.signature,
  });
  if (!ok) throw new HttpError(401, "bad signature");
  return auth.address;
}

// A small per-IP budget on anything that spends relayer gas.
const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimit(c: Context, perMinute = 20) {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) throw new HttpError(429, "slow down");
  b.tokens -= 1;
  buckets.set(ip, b);
}

// ------------------------------------------------------------------- config

app.get("/api/config", async (c) => {
  const gas = await relayer.gasBalance().catch(() => 0n);
  return c.json({
    network: network.name,
    chainId: network.chain.id,
    ausd: network.ausd,
    escrow: network.escrow ?? null,
    relayer: relayer.address,
    relayerGas: formatUnits(gas, 18),
    explorer: network.chain.blockExplorers?.default.url,
    kimi: Boolean(process.env.KIMI_API_KEY),
    indexer: Boolean(process.env.ENVIO_GRAPHQL_URL),
    usdc: network.usdc ?? null,
    convert: network.convert ?? null,
    topup: network.convert ? topupProvider() : null,
  });
});

app.get("/api/rate", async (c) => c.json(await ngnPerUsd()));

app.get("/api/balance/:address", async (c) => {
  const who = addr(c.req.param("address"), "address");
  const balance = (await relayer.publicClient.readContract({
    address: network.ausd,
    abi: ausdAbi,
    functionName: "balanceOf",
    args: [who],
  })) as bigint;
  const usdc = network.usdc
    ? ((await relayer.publicClient.readContract({ address: network.usdc, abi: ausdAbi, functionName: "balanceOf", args: [who] })) as bigint)
    : 0n;
  return c.json({ ausd: balance.toString(), usdc: usdc.toString() });
});

type OrderRow = [Address, Address, bigint, bigint, number, number, number, bigint];

/** Standing orders a person sends or receives. Small enough to scan for now. */
app.get("/api/orders/:address", async (c) => {
  const who = addr(c.req.param("address"), "address").toLowerCase();
  if (!network.escrow) return c.json([]);
  const escrow = network.escrow;
  const count = Number(
    await relayer.publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: "ordersLength" }),
  );
  const ids = Array.from({ length: Math.min(count, 500) }, (_, i) => count - 1 - i);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const o = (await relayer.publicClient.readContract({
        address: escrow,
        abi: escrowAbi,
        functionName: "orders",
        args: [BigInt(id)],
      })) as OrderRow;
      return { id, o };
    }),
  );
  return c.json(
    rows
      .filter(({ o }) => o[0].toLowerCase() === who || o[1].toLowerCase() === who)
      .map(({ id, o }) => ({
        id,
        sender: o[0],
        recipient: o[1],
        amount: o[2].toString(),
        budget: o[3].toString(),
        nextDue: o[4],
        period: o[5],
        mode: o[6] === 1 ? "topup" : "fixed",
        minRate: Number(o[7] ?? 0n) / 1e6,
        active: o[3] > 0n,
      })),
  );
});

// -------------------------------------------------------------------- relay

app.post("/api/relay/send", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  const ref = hex(b.ref, "ref");
  const sealed = typeof b.sealedNote === "string" && b.sealedNote.length < 4000 ? b.sealedNote : null;
  // A note is only accepted if the chain will vouch for it.
  if (sealed && keccak256(toBytes(sealed)) !== ref) throw new HttpError(400, "ref must be the hash of the sealed note");
  const result = await relayer.send({
    from: addr(b.from, "from"),
    to: addr(b.to, "to"),
    amount: big(b.amount, "amount"),
    validBefore: big(b.validBefore, "validBefore"),
    ref,
    signature: hex(b.signature, "signature"),
  });
  if (sealed) store.addNote(b.to, sealed, result.hash);
  if (typeof b.requestId === "string") {
    const r = store.getRequest(b.requestId);
    if (r && r.requester === String(b.to).toLowerCase() && BigInt(b.amount) >= BigInt(r.amount)) {
      const payerName = typeof b.payerName === "string" && b.payerName.trim() ? b.payerName.trim().slice(0, 40) : null;
      store.markRequestPaid(r.id, b.from, result.hash, payerName);
    }
  }
  return c.json(result);
});

app.post("/api/relay/link", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  const claimKey = addr(b.claimKey, "claimKey");
  const result = await relayer.createLink({
    sender: addr(b.sender, "sender"),
    amount: big(b.amount, "amount"),
    validBefore: big(b.validBefore, "validBefore"),
    claimKey,
    expiry: Number(big(b.expiry, "expiry")),
    signature: hex(b.signature, "signature"),
  });
  // The note is sealed with a key from the link itself, so only someone
  // holding the link can read it.
  const sealed = typeof b.sealedNote === "string" && b.sealedNote.length < 4000 ? b.sealedNote : null;
  store.putLink(claimKey, sealed, result.hash);
  return c.json(result);
});

app.get("/api/links/:claimKey", async (c) => {
  const claimKey = addr(c.req.param("claimKey"), "claimKey");
  if (!network.escrow) throw new HttpError(503, "escrow not deployed");
  const [sender, amount, expiry] = (await relayer.publicClient.readContract({
    address: network.escrow,
    abi: escrowAbi,
    functionName: "links",
    args: [claimKey],
  })) as [Address, bigint, number];
  if (sender === "0x0000000000000000000000000000000000000000") throw new HttpError(404, "no such link");
  const meta = store.getLink(claimKey);
  const profile = store.getProfile(sender);
  return c.json({
    sender,
    senderHandle: profile?.handle ?? null,
    senderCharacter: profile?.character ?? null,
    amount: amount.toString(),
    claimed: amount === 0n,
    expiry,
    sealedNote: meta?.sealed ?? null,
    txHash: meta?.tx_hash ?? null,
    recipient: meta?.recipient ?? null,
  });
});

app.post("/api/relay/claim", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  const claimKey = addr(b.claimKey, "claimKey");
  const recipient = addr(b.recipient, "recipient");
  const result = await relayer.claim({ claimKey, recipient, signature: hex(b.signature, "signature") });
  store.setLinkRecipient(claimKey, recipient);
  return c.json(result);
});

app.post("/api/relay/refund", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  return c.json(await relayer.refund(addr(b.claimKey, "claimKey")));
});

app.post("/api/relay/order", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  const mode = Number(b.mode);
  if (mode !== 0 && mode !== 1) throw new HttpError(400, "mode must be 0 or 1");
  return c.json(
    await relayer.createOrder({
      sender: addr(b.sender, "sender"),
      recipient: addr(b.recipient, "recipient"),
      amount: big(b.amount, "amount"),
      budget: big(b.budget, "budget"),
      firstDue: Number(big(b.firstDue, "firstDue")),
      period: Number(big(b.period, "period")),
      mode,
      minRate: b.minRate === undefined ? 0n : big(b.minRate, "minRate"),
      salt: hex(b.salt, "salt"),
      validBefore: big(b.validBefore, "validBefore"),
      signature: hex(b.signature, "signature"),
    }),
  );
});

// ---------------------------------------------------------------- pots

function short(text: unknown, field: string, max: number): string {
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, `${field} is required`);
  return text.trim().slice(0, max);
}

app.post("/api/relay/pot", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  if (!network.escrow) throw new HttpError(503, "escrow not deployed");
  const title = short(b.title, "title", 60);
  const organizer = addr(b.organizer, "organizer");
  const beneficiary = addr(b.beneficiary, "beneficiary");
  const result = await relayer.createPot({
    organizer,
    beneficiary,
    target: big(b.target, "target"),
    deadline: Number(big(b.deadline, "deadline")),
    salt: hex(b.salt, "salt"),
    signature: hex(b.signature, "signature"),
  });
  const beneficiaryName = typeof b.beneficiaryName === "string" && b.beneficiaryName.trim() ? b.beneficiaryName.trim().slice(0, 40) : "";
  store.putPot(network.escrow, result.potId, { title, organizer, beneficiary, beneficiaryName, txHash: result.hash });
  return c.json(result);
});

type PotRow = [Address, number, boolean, Address, bigint, bigint];

async function potView(potId: number) {
  if (!network.escrow) throw new HttpError(503, "escrow not deployed");
  const count = Number(await relayer.publicClient.readContract({ address: network.escrow, abi: escrowAbi, functionName: "potsLength" }));
  if (potId < 0 || potId >= count) throw new HttpError(404, "no such pot");
  const [beneficiary, deadline, released, organizer, target, raised] = (await relayer.publicClient.readContract({
    address: network.escrow,
    abi: escrowAbi,
    functionName: "pots",
    args: [BigInt(potId)],
  })) as PotRow;
  const meta = store.getPot(network.escrow, potId);
  const person = (a: Address) => {
    const p = store.getProfile(a);
    return { address: a, handle: p?.handle ?? null, character: p?.character ?? null };
  };
  return {
    id: potId,
    title: meta?.title ?? "Family pot",
    beneficiary: { ...person(beneficiary), name: meta?.beneficiary_name || null },
    organizer: person(organizer),
    target: target.toString(),
    raised: raised.toString(),
    deadline,
    released,
    txHash: meta?.tx_hash ?? null,
    contributions: store.contributions(network.escrow, potId).map((x) => ({
      from: x.contributor,
      name: x.name,
      amount: x.amount,
      txHash: x.tx_hash,
      at: x.created_at,
      character: store.getProfile(x.contributor)?.character ?? null,
    })),
  };
}

app.get("/api/pots/:id", async (c) => c.json(await potView(Number(big(c.req.param("id"), "id")))));

app.get("/api/pots", async (c) => {
  if (!network.escrow) return c.json([]);
  const who = addr(c.req.query("address"), "address");
  const ids = store.potsFor(network.escrow, who);
  return c.json(await Promise.all(ids.map(potView)));
});

app.post("/api/relay/contribute", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  if (!network.escrow) throw new HttpError(503, "escrow not deployed");
  const potId = big(b.potId, "potId");
  const from = addr(b.from, "from");
  const amount = big(b.amount, "amount");
  const result = await relayer.contribute({
    potId,
    from,
    amount,
    validBefore: big(b.validBefore, "validBefore"),
    ref: hex(b.ref, "ref"),
    signature: hex(b.signature, "signature"),
  });
  store.addContribution(network.escrow, Number(potId), {
    contributor: from,
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 40) : "Someone",
    amount: amount.toString(),
    txHash: result.hash,
  });
  return c.json(result);
});

// ------------------------------------------------- add money from any chain

app.get("/api/topup/sources", (c) =>
  c.json({ provider: topupProvider(), sources: SOURCES.map(({ id, chain, symbol, evm }) => ({ id, chain, symbol, evm })) }),
);

/** Opens a deposit address on the source chain that delivers USDC to the user's Loft address on Monad. */
app.post("/api/topup/quote", async (c) => {
  rateLimit(c, 10);
  const b = await c.req.json();
  if (!network.convert) throw new HttpError(503, "any-chain top-ups aren't set up on this network");
  const source = SOURCES.find((s) => s.id === b.source);
  if (!source) throw new HttpError(400, "unknown source");
  const amount = Number(b.amount);
  if (!(amount >= 1 && amount <= 2000)) throw new HttpError(400, "amount must be between $1 and $2,000");
  const recipient = addr(b.address, "address");
  // EVM refunds go back to the same address on the source chain, which the passkey controls there too.
  const refundTo = source.evm ? recipient : typeof b.refundTo === "string" && b.refundTo.trim() ? b.refundTo.trim() : null;
  if (!refundTo) throw new HttpError(400, `add a ${source.chain} address for refunds`);
  return c.json(await quoteTopUp({ source, amount, recipient, refundTo, dry: Boolean(b.dry) }));
});

app.get("/api/topup/status", async (c) => {
  const depositAddress = c.req.query("depositAddress");
  if (!depositAddress) throw new HttpError(400, "depositAddress is required");
  return c.json(await topUpStatus(depositAddress, c.req.query("depositMemo")));
});

/** What `amount` USDC fetches in AUSD right now, from the Liquidity Book pair. */
app.get("/api/convert/quote", async (c) => {
  if (!network.usdcPair) throw new HttpError(503, "no USDC pair on this network");
  const amount = big(c.req.query("amount"), "amount");
  const [left, out, fee] = (await relayer.publicClient.readContract({
    address: network.usdcPair,
    abi: lbPairAbi,
    functionName: "getSwapOut",
    args: [amount, false],
  })) as [bigint, bigint, bigint];
  return c.json({ amountIn: amount.toString(), ausdOut: out.toString(), fee: fee.toString(), filled: left === 0n });
});

app.post("/api/relay/convert", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  return c.json(
    await relayer.convert({
      owner: addr(b.owner, "owner"),
      amount: big(b.amount, "amount"),
      minOut: big(b.minOut, "minOut"),
      salt: hex(b.salt, "salt"),
      validBefore: big(b.validBefore, "validBefore"),
      signature: hex(b.signature, "signature"),
    }),
  );
});

// ------------------------------------------------------- ask the family

/** A request is public by design: whoever has the link sees who asks, for what, and how much. */
app.post("/api/requests", async (c) => {
  rateLimit(c, 10);
  const body = await c.req.text();
  const requester = await signer(c, body);
  const b = JSON.parse(body);
  const amount = big(b.amount, "amount");
  if (amount === 0n || amount > 10_000n * 10n ** BigInt(AUSD_DECIMALS)) throw new HttpError(400, "amount out of range");
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
  store.putRequest({ id, requester, name: short(b.name, "name", 40), amount: amount.toString(), note: short(b.note, "note", 140) });
  return c.json({ id });
});

function requestView(r: NonNullable<ReturnType<typeof store.getRequest>>) {
  const p = store.getProfile(r.requester);
  return {
    id: r.id,
    requester: getAddress(r.requester),
    name: r.name,
    handle: p?.handle ?? null,
    character: p?.character ?? null,
    amount: r.amount,
    note: r.note,
    createdAt: r.created_at,
    paid: r.paid_tx ? { by: r.paid_by, txHash: r.paid_tx, at: r.paid_at, name: r.paid_name ?? null } : null,
  };
}

app.get("/api/requests/:id", (c) => {
  const r = store.getRequest(c.req.param("id"));
  if (!r) throw new HttpError(404, "no such request");
  return c.json(requestView(r));
});

app.get("/api/requests", (c) => {
  const who = addr(c.req.query("address"), "address");
  return c.json(store.requestsBy(who).map(requestView));
});

app.post("/api/relay/close", async (c) => {
  rateLimit(c);
  const b = await c.req.json();
  return c.json(await relayer.closeOrder({ orderId: big(b.orderId, "orderId"), signature: hex(b.signature, "signature") }));
});

// --------------------------------------------------------------- activity

const PAYMENTS_QUERY = `query Activity($me: String!) {
  Payment(where: {_or: [{from_id: {_eq: $me}}, {to_id: {_eq: $me}}]}, order_by: {timestamp: desc}, limit: 100) {
    id kind from_id to_id amount ngnPerUsd ngnValue ref link_id order_id txHash timestamp
  }
}`;

/** Everything paid to or from an address, from the Envio indexer. */
app.get("/api/activity/:address", async (c) => {
  const url = process.env.ENVIO_GRAPHQL_URL;
  if (!url) throw new HttpError(503, "indexer not configured");
  const me = getAddress(addr(c.req.param("address"), "address"));
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: PAYMENTS_QUERY, variables: { me } }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { data?: { Payment: unknown[] }; errors?: { message: string }[] };
  if (!res.ok || json.errors) throw new Error(json.errors?.[0]?.message ?? `indexer ${res.status}`);
  return c.json(json.data?.Payment ?? []);
});

// ----------------------------------------------------------------- corridor

app.get("/api/corridor", async (c) => {
  const [stats, rate] = await Promise.all([corridor(store), ngnPerUsd().catch(() => null)]);
  return c.json({ ...stats, ngnPerUsd: rate?.ngnPerUsd ?? null });
});

// ------------------------------------------------------ profiles and notes

/** The creatures a person can choose (web/public/cast). */
const CHARACTERS = new Set(["cheetah", "fennec", "lion", "parrot", "pangolin", "tortoise", "hornbill", "badger", "chameleon"]);

app.get("/api/profiles/:address", (c) => {
  const p = store.getProfile(addr(c.req.param("address"), "address"));
  if (!p) throw new HttpError(404, "no profile");
  return c.json({ address: p.address, handle: p.handle, inboxKey: p.inbox_key, character: p.character });
});

app.get("/api/handles/:handle", (c) => {
  const p = store.findHandle(c.req.param("handle"));
  if (!p) throw new HttpError(404, "no such handle");
  return c.json({ address: p.address, handle: p.handle, inboxKey: p.inbox_key, character: p.character });
});

app.put("/api/profiles/:address", async (c) => {
  const body = await c.req.text();
  const who = await signer(c, body);
  if (who.toLowerCase() !== c.req.param("address").toLowerCase()) throw new HttpError(403, "not your profile");
  const b = JSON.parse(body);
  const handle = typeof b.handle === "string" && /^[a-z0-9_]{3,20}$/i.test(b.handle) ? b.handle : null;
  hex(b.inboxKey, "inboxKey");
  const character = CHARACTERS.has(b.character) ? (b.character as string) : null;
  if (!store.putProfile(who, handle, b.inboxKey, character)) throw new HttpError(409, "handle taken");
  return c.json({ ok: true });
});

app.get("/api/notes", async (c) => {
  const who = await signer(c, "");
  return c.json(store.notesFor(who, Number(c.req.query("after") ?? 0)));
});

// ------------------------------------------------------------------- vaults

app.get("/api/vault", async (c) => {
  const who = await signer(c, "");
  const v = store.getVault(who);
  return c.json(v ? { blob: v.blob, version: v.version } : { blob: null, version: 0 });
});

app.put("/api/vault", async (c) => {
  const body = await c.req.text();
  const who = await signer(c, body);
  const b = JSON.parse(body);
  if (typeof b.blob !== "string" || b.blob.length > 512_000) throw new HttpError(400, "bad blob");
  const result = store.putVault(who, b.blob, Number(b.version ?? 0));
  if (!result.ok) throw new HttpError(409, `vault is at version ${result.version}`);
  return c.json(result);
});

// ------------------------------------------------------------------ intents

app.post("/api/intent", async (c) => {
  rateLimit(c, 10);
  const b = await c.req.json();
  if (typeof b.text !== "string" || b.text.length > 500) throw new HttpError(400, "text required");
  const contacts = Array.isArray(b.contacts) ? b.contacts.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
  // Kimi reads it when configured; the rules cover the common phrasings otherwise, or if Kimi is down.
  let engine: "kimi" | "rules" = "rules";
  let intent = ruleIntent(b.text, contacts);
  if (process.env.KIMI_API_KEY) {
    try {
      intent = await parseIntent(b.text, contacts);
      engine = "kimi";
    } catch (err) {
      console.error("kimi:", (err as Error).message);
    }
  }
  const rate = await ngnPerUsd().catch(() => undefined);
  const usd =
    intent.amount === null
      ? null
      : intent.currency === "NGN"
        ? rate
          ? intent.amount / rate.ngnPerUsd
          : null
        : intent.amount;
  return c.json({ ...intent, usd, ngnPerUsd: rate?.ngnPerUsd ?? null, engine });
});

// -------------------------------------------------------------- web client

app.get("/.well-known/assetlinks.json", (c) =>
  c.json(existsSync("web/assetlinks.json") ? JSON.parse(readFileSync("web/assetlinks.json", "utf8")) : []),
);
// Hashed bundles never change, so they cache forever. The app shell and the
// cast sprites must be re-checked, or a phone keeps running the last deploy.
const cacheFor = (path: string) =>
  path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
app.use("/*", serveStatic({ root: "./web/dist", onFound: (path, c) => c.header("Cache-Control", cacheFor(path.replace(/^\.?\/?web\/dist/, ""))) }));
// Client-side routes (/c for claim links, /send, ...) all load the app shell.
app.get("*", serveStatic({ path: "./web/dist/index.html", onFound: (_p, c) => c.header("Cache-Control", "no-cache") }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`loft on :${port} · ${network.name} · relayer ${relayer.address}`);
  console.log(`AUSD ${network.ausd} · escrow ${network.escrow ?? "(not deployed)"} · ${AUSD_DECIMALS} decimals`);
});
