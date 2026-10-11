// The app's signing helpers (shared/money.ts), checked against the deployed
// contract and real AUSD on a Monad testnet fork. If client and contract ever
// disagree about a nonce or digest, these fail.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { type Address, type Hex, encodeAbiParameters, keccak256, parseSignature, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Ctx, linkNonce, orderNonce, potNonce, sendNonce, signClaim, signClose, signContribution, signLink, signOrder, signPot, signSend } from "../shared/money.ts";
import { AUSD, WHALE, ausdAbi, balance, client, deployEscrow, escrowAbi, now, send, usd, warp } from "./fork.ts";

const alice = privateKeyToAccount(generatePrivateKey());
const mum = privateKeyToAccount(generatePrivateKey());
const relayer = privateKeyToAccount(generatePrivateKey());
const forwarder = privateKeyToAccount(generatePrivateKey());
let ctx: Ctx;

function vrs(signature: Hex) {
  const { v, r, s } = parseSignature(signature);
  return [Number(v), r, s] as const;
}

describe("client signing helpers against the escrow", () => {
  before(async () => {
    const escrow = await deployEscrow(relayer.address, forwarder.address);
    ctx = { chainId: await client.getChainId(), ausd: AUSD, escrow };
    await send(WHALE, AUSD, ausdAbi, "transfer", [alice.address, usd(300)]);
  });

  it("computes the same link and order nonces as the contract", async () => {
    const claimKey = privateKeyToAccount(generatePrivateKey()).address;
    const expiry = 1_900_000_000;
    assert.equal(
      linkNonce(ctx.escrow, claimKey, expiry),
      await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "linkNonce", args: [claimKey, expiry] }),
    );
    const o = {
      recipient: mum.address,
      amount: usd(10),
      budget: usd(40),
      firstDue: 1_900_000_000,
      period: 604800,
      mode: 1 as const,
      minRate: 1_400_000000n,
      salt: `0x${"ab".repeat(32)}` as Hex,
    };
    assert.equal(
      orderNonce(ctx.escrow, o),
      await client.readContract({
        address: ctx.escrow,
        abi: escrowAbi,
        functionName: "orderNonce",
        args: [o.recipient, o.amount, o.budget, o.firstDue, o.period, o.mode, o.minRate, o.salt],
      }),
    );
  });

  it("sends directly through the escrow, with the note hash onchain", async () => {
    const ref = keccak256(toBytes("sealed-note-ciphertext"));
    assert.equal(
      sendNonce(ctx.escrow, mum.address, ref),
      await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "sendNonce", args: [mum.address, ref] }),
    );
    const t = await signSend(alice, ctx, mum.address, usd(12.5), ref);
    const res = await send(relayer.address, ctx.escrow, escrowAbi, "send", [
      t.from, t.to, t.amount, t.validBefore, t.ref, ...vrs(t.signature),
    ]);
    assert.equal(await balance(mum.address), usd(12.5));
    assert.equal(await balance(ctx.escrow), 0n);
    const sent = res.logs?.find((l: any) => l.address.toLowerCase() === ctx.escrow.toLowerCase());
    assert.ok(sent, "Sent event emitted");
    assert.equal(sent.topics[3], ref);

    // The same authorization can't be replayed to someone else.
    await assert.rejects(
      send(relayer.address, ctx.escrow, escrowAbi, "send", [t.from, relayer.address, t.amount, t.validBefore, t.ref, ...vrs(t.signature)]),
    );
  });

  it("creates and claims a link", async () => {
    const claimAccount = privateKeyToAccount(generatePrivateKey());
    const expiry = Number(await now()) + 86400;
    const l = await signLink(alice, ctx, claimAccount.address, usd(40), expiry);
    await send(relayer.address, ctx.escrow, escrowAbi, "createLink", [
      l.sender, l.amount, l.validBefore, l.claimKey, l.expiry, ...vrs(l.signature),
    ]);
    const before = await balance(mum.address);
    const c = await signClaim(claimAccount, ctx, mum.address);
    await send(relayer.address, ctx.escrow, escrowAbi, "claim", [c.claimKey, c.recipient, ...vrs(c.signature)]);
    assert.equal(await balance(mum.address), before + usd(40));
  });

  it("creates, pays and closes a standing order", async () => {
    const firstDue = Number(await now()) + 10;
    const o = await signOrder(alice, ctx, {
      recipient: mum.address,
      amount: usd(15),
      budget: usd(45),
      firstDue,
      period: 86400,
      mode: 0,
      minRate: 0n,
    });
    await send(relayer.address, ctx.escrow, escrowAbi, "createOrder", [
      o.sender, o.recipient, o.amount, o.budget, o.firstDue, o.period, o.mode, o.minRate, o.salt, o.validBefore,
      ...vrs(o.signature),
    ]);
    const id = ((await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "ordersLength" })) as bigint) - 1n;
    await warp(11n);
    const before = await balance(mum.address);
    const report = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256[]" }], [[id], 1_329_000000n, []]);
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(mum.address), before + usd(15));

    const aliceBefore = await balance(alice.address as Address);
    const close = await signClose(alice, ctx, id);
    await send(relayer.address, ctx.escrow, escrowAbi, "closeOrder", [close.orderId, ...vrs(close.signature)]);
    assert.equal(await balance(alice.address), aliceBefore + usd(30));
  });

  it("holds a rate-triggered order until Chainlink's rate reaches the floor, then pays once", async () => {
    const o = await signOrder(alice, ctx, {
      recipient: mum.address,
      amount: usd(5),
      budget: usd(5),
      firstDue: Number(await now()),
      period: 86400,
      mode: 0,
      minRate: 1_400_000000n,
    });
    await send(relayer.address, ctx.escrow, escrowAbi, "createOrder", [
      o.sender, o.recipient, o.amount, o.budget, o.firstDue, o.period, o.mode, o.minRate, o.salt, o.validBefore,
      ...vrs(o.signature),
    ]);
    const id = ((await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "ordersLength" })) as bigint) - 1n;
    await warp(1n);
    const before = await balance(mum.address);
    const at = (rate: bigint) =>
      encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256[]" }], [[id], rate, []]);

    // Below the floor: still due, nothing moves.
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", at(1_330_000000n)]);
    assert.equal(await balance(mum.address), before);
    const due = (await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "dueOrders", args: [0n, 100n] })) as bigint[];
    assert.ok(due.includes(id));

    // The rate reaches the floor: it pays, and the order is spent.
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", at(1_402_500000n)]);
    assert.equal(await balance(mum.address), before + usd(5));
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", at(1_450_000000n)]);
    assert.equal(await balance(mum.address), before + usd(5));
  });

  it("collects a family pot from several people and pays out the moment it reaches its target", async () => {
    const bisi = privateKeyToAccount(generatePrivateKey());
    await send(WHALE, ctx.ausd, ausdAbi, "transfer", [bisi.address, usd(50)]);
    const deadline = Number(await now()) + 7 * 86400;
    const p = await signPot(alice, ctx, { beneficiary: mum.address, target: usd(30), deadline });
    await send(relayer.address, ctx.escrow, escrowAbi, "createPot", [
      p.organizer, p.beneficiary, p.target, p.deadline, p.salt, ...vrs(p.signature),
    ]);
    const potId = ((await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "potsLength" })) as bigint) - 1n;

    // Someone else can't open a pot in Alice's name.
    const forged = await signPot(bisi, ctx, { beneficiary: mum.address, target: usd(30), deadline });
    await assert.rejects(
      send(relayer.address, ctx.escrow, escrowAbi, "createPot", [alice.address, forged.beneficiary, forged.target, forged.deadline, forged.salt, ...vrs(forged.signature)]),
    );

    const c1 = await signContribution(alice, ctx, potId, usd(12));
    assert.equal(
      potNonce(ctx.escrow, potId, c1.ref),
      await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "potNonce", args: [potId, c1.ref] }),
    );
    const before = await balance(mum.address);
    await send(relayer.address, ctx.escrow, escrowAbi, "contribute", [c1.potId, c1.from, c1.amount, c1.validBefore, c1.ref, ...vrs(c1.signature)]);
    assert.equal(await balance(mum.address), before, "below target: held");

    const c2 = await signContribution(bisi, ctx, potId, usd(20));
    await send(relayer.address, ctx.escrow, escrowAbi, "contribute", [c2.potId, c2.from, c2.amount, c2.validBefore, c2.ref, ...vrs(c2.signature)]);
    assert.equal(await balance(mum.address), before + usd(32), "target reached: all of it to Mum");

    // Closed after release.
    const c3 = await signContribution(alice, ctx, potId, usd(1));
    await assert.rejects(
      send(relayer.address, ctx.escrow, escrowAbi, "contribute", [c3.potId, c3.from, c3.amount, c3.validBefore, c3.ref, ...vrs(c3.signature)]),
    );
  });

  it("releases a pot that missed its target on the deadline, via Chainlink's report", async () => {
    const deadline = Number(await now()) + 3600;
    const p = await signPot(alice, ctx, { beneficiary: mum.address, target: usd(100), deadline });
    await send(relayer.address, ctx.escrow, escrowAbi, "createPot", [
      p.organizer, p.beneficiary, p.target, p.deadline, p.salt, ...vrs(p.signature),
    ]);
    const potId = ((await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "potsLength" })) as bigint) - 1n;
    const c = await signContribution(alice, ctx, potId, usd(7));
    await send(relayer.address, ctx.escrow, escrowAbi, "contribute", [c.potId, c.from, c.amount, c.validBefore, c.ref, ...vrs(c.signature)]);

    const report = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256[]" }], [[], 1_330_000000n, [potId]]);
    const before = await balance(mum.address);
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(mum.address), before, "before the deadline a report can't release it");
    await assert.rejects(send(relayer.address, ctx.escrow, escrowAbi, "releasePot", [potId]));

    await warp(3601n);
    const due = (await client.readContract({ address: ctx.escrow, abi: escrowAbi, functionName: "duePots", args: [0n, 100n] })) as bigint[];
    assert.ok(due.includes(potId));
    await send(forwarder.address, ctx.escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(mum.address), before + usd(7));
  });
});
