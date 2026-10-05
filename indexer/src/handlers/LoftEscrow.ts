// Turns LoftEscrow events into the entities Loft's Activity screen and
// receipts read: payments of every kind, link lifecycles, standing orders with
// their payout history, and per-day and all-time totals.
import { type Account, type DailyStats, type EvmOnEventContext, type Payment, type Totals, indexer } from "envio";

const RATE_ONE = 1_000_000n; // rates carry 6 decimals

type Ctx = EvmOnEventContext;
type Ev = { block: { number: number; timestamp: number }; transaction: { hash: string }; logIndex: number };

async function totals(context: Ctx): Promise<Totals> {
  return (
    (await context.Totals.get("all")) ?? {
      id: "all",
      volume: 0n,
      payments: 0,
      accounts: 0,
      linksCreated: 0,
      linksClaimed: 0,
      ordersCreated: 0,
    }
  );
}

/** Loads an account, creating it (and counting it) the first time it appears. */
async function touch(context: Ctx, id: string, at: number): Promise<Account> {
  const existing = await context.Account.get(id);
  if (existing) return { ...existing, lastSeen: at };
  const t = await totals(context);
  context.Totals.set({ ...t, accounts: t.accounts + 1 });
  return { id, sentTotal: 0n, receivedTotal: 0n, sentCount: 0, receivedCount: 0, firstSeen: at, lastSeen: at };
}

function day(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/** Records a payment and rolls it into both accounts, the day, and the totals. */
async function recordPayment(
  context: Ctx,
  event: Ev,
  p: Omit<Payment, "id" | "txHash" | "blockNumber" | "timestamp">,
) {
  const at = event.block.timestamp;
  context.Payment.set({
    ...p,
    id: `${event.transaction.hash}-${event.logIndex}`,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: at,
  });

  const from = await touch(context, p.from_id, at);
  context.Account.set({ ...from, sentTotal: from.sentTotal + p.amount, sentCount: from.sentCount + 1 });
  // Re-read so a payment to yourself counts both ways on the same row.
  const to = p.to_id === p.from_id ? { ...from, sentTotal: from.sentTotal + p.amount, sentCount: from.sentCount + 1 } : await touch(context, p.to_id, at);
  context.Account.set({ ...to, receivedTotal: to.receivedTotal + p.amount, receivedCount: to.receivedCount + 1 });

  const id = day(at);
  const d: DailyStats = (await context.DailyStats.get(id)) ?? {
    id,
    volume: 0n,
    payments: 0,
    direct: 0,
    links: 0,
    orders: 0,
    rateSum: 0n,
    rateSamples: 0,
  };
  context.DailyStats.set({
    ...d,
    volume: d.volume + p.amount,
    payments: d.payments + 1,
    direct: d.direct + (p.kind === "DIRECT" ? 1 : 0),
    links: d.links + (p.kind === "LINK" ? 1 : 0),
    orders: d.orders + (p.kind === "ORDER" ? 1 : 0),
    rateSum: d.rateSum + (p.ngnPerUsd ?? 0n),
    rateSamples: d.rateSamples + (p.ngnPerUsd ? 1 : 0),
  });

  const t = await totals(context);
  context.Totals.set({ ...t, volume: t.volume + p.amount, payments: t.payments + 1 });
}

// ------------------------------------------------------------------ sends

indexer.onEvent({ contract: "LoftEscrow", event: "Sent" }, async ({ event, context }) => {
  await recordPayment(context, event, {
    kind: "DIRECT",
    from_id: event.params.from,
    to_id: event.params.to,
    amount: event.params.amount,
    ngnPerUsd: undefined,
    ngnValue: undefined,
    ref: event.params.ref,
    link_id: undefined,
    order_id: undefined,
  });
});

// ------------------------------------------------------------------ links

indexer.onEvent({ contract: "LoftEscrow", event: "LinkCreated" }, async ({ event, context }) => {
  const at = event.block.timestamp;
  const sender = await touch(context, event.params.sender, at);
  context.Account.set(sender);
  context.Link.set({
    id: event.params.claimKey,
    sender_id: event.params.sender,
    recipient_id: undefined,
    amount: event.params.amount,
    expiry: Number(event.params.expiry),
    status: "OPEN",
    createdAt: at,
    settledAt: undefined,
    createdTx: event.transaction.hash,
    settledTx: undefined,
  });
  const t = await totals(context);
  context.Totals.set({ ...t, linksCreated: t.linksCreated + 1 });
});

indexer.onEvent({ contract: "LoftEscrow", event: "LinkClaimed" }, async ({ event, context }) => {
  const link = await context.Link.getOrThrow(event.params.claimKey);
  // The sender claiming their own link is how a link is taken back.
  const cancelled = event.params.recipient.toLowerCase() === event.params.sender.toLowerCase();
  context.Link.set({
    ...link,
    recipient_id: event.params.recipient,
    status: cancelled ? "CANCELLED" : "CLAIMED",
    settledAt: event.block.timestamp,
    settledTx: event.transaction.hash,
  });
  if (cancelled) return;
  await recordPayment(context, event, {
    kind: "LINK",
    from_id: event.params.sender,
    to_id: event.params.recipient,
    amount: event.params.amount,
    ngnPerUsd: undefined,
    ngnValue: undefined,
    ref: undefined,
    link_id: link.id,
    order_id: undefined,
  });
  const t = await totals(context);
  context.Totals.set({ ...t, linksClaimed: t.linksClaimed + 1 });
});

indexer.onEvent({ contract: "LoftEscrow", event: "LinkRefunded" }, async ({ event, context }) => {
  const link = await context.Link.getOrThrow(event.params.claimKey);
  context.Link.set({ ...link, status: "REFUNDED", settledAt: event.block.timestamp, settledTx: event.transaction.hash });
});

// ----------------------------------------------------------------- orders

indexer.onEvent({ contract: "LoftEscrow", event: "OrderCreated" }, async ({ event, context }) => {
  const at = event.block.timestamp;
  const p = event.params;
  context.Account.set(await touch(context, p.sender, at));
  if (p.recipient !== p.sender) context.Account.set(await touch(context, p.recipient, at));
  context.Order.set({
    id: p.orderId.toString(),
    sender_id: p.sender,
    recipient_id: p.recipient,
    mode: Number(p.mode) === 1 ? "TOPUP" : "FIXED",
    amount: p.amount,
    budget: p.budget,
    budgetLeft: p.budget,
    period: Number(p.period),
    nextDue: Number(p.firstDue),
    paidCount: 0,
    paidTotal: 0n,
    skippedCount: 0,
    lastRate: undefined,
    active: true,
    refunded: 0n,
    createdAt: at,
  });
  const t = await totals(context);
  context.Totals.set({ ...t, ordersCreated: t.ordersCreated + 1 });
});

indexer.onEvent({ contract: "LoftEscrow", event: "Remitted" }, async ({ event, context }) => {
  const p = event.params;
  const order = await context.Order.getOrThrow(p.orderId.toString());
  context.Order.set({
    ...order,
    budgetLeft: order.budgetLeft - p.amount,
    nextDue: order.nextDue + order.period,
    paidCount: order.paidCount + 1,
    paidTotal: order.paidTotal + p.amount,
    lastRate: p.ngnPerUsd,
  });
  await recordPayment(context, event, {
    kind: "ORDER",
    from_id: p.sender,
    to_id: p.recipient,
    amount: p.amount,
    ngnPerUsd: p.ngnPerUsd,
    ngnValue: (p.amount * p.ngnPerUsd) / RATE_ONE,
    ref: undefined,
    link_id: undefined,
    order_id: order.id,
  });
});

indexer.onEvent({ contract: "LoftEscrow", event: "OrderSkipped" }, async ({ event, context }) => {
  const order = await context.Order.getOrThrow(event.params.orderId.toString());
  context.Order.set({
    ...order,
    nextDue: order.nextDue + order.period,
    skippedCount: order.skippedCount + 1,
    lastRate: event.params.ngnPerUsd,
  });
});

indexer.onEvent({ contract: "LoftEscrow", event: "OrderClosed" }, async ({ event, context }) => {
  const order = await context.Order.getOrThrow(event.params.orderId.toString());
  context.Order.set({ ...order, active: false, budgetLeft: 0n, refunded: event.params.refunded });
});
