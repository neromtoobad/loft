import { TestHelpers, createTestIndexer } from "envio";
import { describe, it } from "vitest";

const [dimeji, mum, claimKey, otherKey] = TestHelpers.Addresses.mockAddresses as string[];
const REF = `0x${"ab".repeat(32)}`;
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const DAY = 1_790_000_000; // a fixed UTC moment

let log = 0;
function ev(event: string, params: Record<string, unknown>, timestamp = DAY, contract: "LoftEscrow" | "LoftConvert" = "LoftEscrow") {
  log += 1;
  return {
    contract,
    event,
    params,
    // Above config.yaml's start_block, or the simulator filters the event out.
    block: { number: 200_000_000 + log, timestamp },
    transaction: { hash: `0x${log.toString(16).padStart(64, "0")}` },
    logIndex: 0,
  };
}

async function run(events: ReturnType<typeof ev>[]) {
  const indexer = createTestIndexer();
  await indexer.process({ chains: { 143: { simulate: events as any } } });
  return indexer;
}

describe("Loft indexer", () => {
  it("records a direct send with its note hash, and both sides' totals", async (t) => {
    const indexer = await run([ev("Sent", { from: dimeji, to: mum, amount: usd(5), ref: REF })]);
    const payments = await indexer.Payment.getAll();
    t.expect(payments).toHaveLength(1);
    t.expect(payments[0]).toMatchObject({ kind: "DIRECT", from_id: dimeji, to_id: mum, amount: usd(5), ref: REF });
    t.expect(await indexer.Account.getOrThrow(dimeji)).toMatchObject({ sentTotal: usd(5), sentCount: 1, receivedCount: 0 });
    t.expect(await indexer.Account.getOrThrow(mum)).toMatchObject({ receivedTotal: usd(5), receivedCount: 1 });
    t.expect(await indexer.Totals.getOrThrow("all")).toMatchObject({ accounts: 2, payments: 1, volume: usd(5) });
  });

  it("follows a link from made to claimed, and counts only real payouts", async (t) => {
    const indexer = await run([
      ev("LinkCreated", { claimKey, sender: dimeji, amount: usd(25), expiry: BigInt(DAY + 14 * 86400) }),
      ev("LinkClaimed", { claimKey, sender: dimeji, recipient: mum, amount: usd(25) }),
      // A second link the sender takes back: not a payment.
      ev("LinkCreated", { claimKey: otherKey, sender: dimeji, amount: usd(10), expiry: BigInt(DAY + 86400) }),
      ev("LinkClaimed", { claimKey: otherKey, sender: dimeji, recipient: dimeji, amount: usd(10) }),
    ]);
    t.expect(await indexer.Link.getOrThrow(claimKey)).toMatchObject({ status: "CLAIMED", recipient_id: mum });
    t.expect(await indexer.Link.getOrThrow(otherKey)).toMatchObject({ status: "CANCELLED" });
    const payments = await indexer.Payment.getAll();
    t.expect(payments).toHaveLength(1);
    t.expect(payments[0]).toMatchObject({ kind: "LINK", link_id: claimKey, to_id: mum, amount: usd(25) });
    t.expect(await indexer.Totals.getOrThrow("all")).toMatchObject({ linksCreated: 2, linksClaimed: 1, payments: 1 });
  });

  it("marks an expired link refunded", async (t) => {
    const indexer = await run([
      ev("LinkCreated", { claimKey, sender: dimeji, amount: usd(20), expiry: BigInt(DAY + 3600) }),
      ev("LinkRefunded", { claimKey, sender: dimeji, amount: usd(20) }, DAY + 7200),
    ]);
    t.expect(await indexer.Link.getOrThrow(claimKey)).toMatchObject({ status: "REFUNDED", settledAt: DAY + 7200 });
    t.expect(await indexer.Payment.getAll()).toHaveLength(0);
  });

  it("tracks a standing order: payouts with the naira value, a skip, and closing", async (t) => {
    const week = 7 * 86400;
    const indexer = await run([
      ev("OrderCreated", {
        orderId: 0n, sender: dimeji, recipient: mum, amount: usd(10), budget: usd(30),
        firstDue: BigInt(DAY), period: BigInt(week), mode: 0n, minRate: 0n,
      }),
      ev("Remitted", { orderId: 0n, sender: dimeji, recipient: mum, amount: usd(10), ngnPerUsd: 1_329_264038n }, DAY + 60),
      ev("OrderSkipped", { orderId: 0n, ngnPerUsd: 1_331_000000n }, DAY + week + 60),
      ev("OrderClosed", { orderId: 0n, sender: dimeji, refunded: usd(20) }, DAY + week + 120),
    ]);
    const order = await indexer.Order.getOrThrow("0");
    t.expect(order).toMatchObject({
      mode: "FIXED", paidCount: 1, paidTotal: usd(10), skippedCount: 1,
      nextDue: DAY + 2 * week, active: false, budgetLeft: 0n, refunded: usd(20), lastRate: 1_331_000000n,
    });
    const [payment] = await indexer.Payment.getAll();
    // $10 at ₦1,329.264038 is ₦13,292.64038, kept with 6 decimals.
    t.expect(payment).toMatchObject({ kind: "ORDER", order_id: "0", ngnPerUsd: 1_329_264038n, ngnValue: 13_292_640380n });
    const today = await indexer.DailyStats.getOrThrow(new Date(DAY * 1000).toISOString().slice(0, 10));
    t.expect(today).toMatchObject({ orders: 1, rateSamples: 1, rateSum: 1_329_264038n });
  });

  it("follows a family pot from contributions to its release as one payment to the beneficiary", async (t) => {
    const indexer = await run([
      ev("PotCreated", { potId: 0n, organizer: dimeji, beneficiary: mum, target: usd(30), deadline: BigInt(DAY + 86400) }),
      ev("PotContributed", { potId: 0n, from: dimeji, amount: usd(12), ref: REF }),
      ev("PotContributed", { potId: 0n, from: otherKey, amount: usd(20), ref: REF }),
      ev("PotReleased", { potId: 0n, beneficiary: mum, amount: usd(32) }),
    ]);
    const pot = await indexer.Pot.getOrThrow("0");
    t.expect(pot.raised).toBe(usd(32));
    t.expect(pot.contributors).toBe(2);
    t.expect(pot.released).toBe(true);
    const payments = await indexer.Payment.getAll();
    const toMum = payments.filter((p: any) => p.kind === "POT");
    t.expect(toMum).toHaveLength(1);
    t.expect(toMum[0].amount).toBe(usd(32));
    t.expect((await indexer.Totals.getOrThrow("all")).potsCreated).toBe(1);
  });

  it("counts USDC that arrived from another chain as a top-up, not a payment", async (t) => {
    const indexer = await run([
      ev("Converted", { owner: dimeji, usdcIn: usd(20), ausdOut: usd(20.001), salt: REF }, DAY, "LoftConvert"),
      ev("Sent", { from: dimeji, to: mum, amount: usd(20), ref: REF }),
    ]);
    const topups = await indexer.TopUp.getAll();
    t.expect(topups).toHaveLength(1);
    t.expect(topups[0]).toMatchObject({ owner_id: dimeji, usdcIn: usd(20), ausdOut: usd(20.001) });
    t.expect(await indexer.Totals.getOrThrow("all")).toMatchObject({ topups: 1, topupVolume: usd(20.001), payments: 1, volume: usd(20) });
    const day = (await indexer.DailyStats.getAll())[0];
    t.expect(day).toMatchObject({ topupVolume: usd(20.001), volume: usd(20), payments: 1 });
  });
});
