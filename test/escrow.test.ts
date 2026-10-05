// Runs LoftEscrow against a local fork of Monad testnet and the real AUSD
// contract, so the EIP-3009 flows are checked against Agora's implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  hexToSignature,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AUSD, WHALE, ausdAbi, balance, client, deployEscrow, escrowAbi, now, send, usd, warp } from "./fork.ts";

const sender = privateKeyToAccount(generatePrivateKey());
const recipient = privateKeyToAccount(generatePrivateKey());
const relayer = privateKeyToAccount(generatePrivateKey());
const forwarder = privateKeyToAccount(generatePrivateKey());
let escrow: Address;
let chainId: number;

/** The sender's EIP-3009 ReceiveWithAuthorization signature, as a Mera account would produce it. */
async function authorize(value: bigint, nonce: Hex) {
  const validBefore = (await now()) + 3600n;
  const sig = await sender.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId, verifyingContract: AUSD },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: sender.address, to: escrow, value, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = hexToSignature(sig);
  return { validBefore, v: Number(v), r, s };
}

describe("LoftEscrow on a Monad testnet fork", () => {
  before(async () => {
    chainId = await client.getChainId();
    escrow = await deployEscrow(relayer.address, forwarder.address);
    await send(WHALE, AUSD, ausdAbi, "transfer", [sender.address, usd(500)]);
    assert.equal(await balance(sender.address), usd(500));
  });

  it("funds a claim link gaslessly and releases it to whoever the link names", async () => {
    const claimKey = privateKeyToAccount(generatePrivateKey());
    const expiry = (await now()) + 7n * 86400n;
    const nonce = (await client.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "linkNonce",
      args: [claimKey.address, Number(expiry)],
    })) as Hex;
    const auth = await authorize(usd(50), nonce);

    await send(relayer.address, escrow, escrowAbi, "createLink", [
      sender.address, usd(50), auth.validBefore, claimKey.address, Number(expiry), auth.v, auth.r, auth.s,
    ]);
    assert.equal(await balance(escrow), usd(50));
    assert.equal(await balance(sender.address), usd(450));

    // A relayer can't redirect the deposit to a claim key it controls.
    const thief = privateKeyToAccount(generatePrivateKey());
    await assert.rejects(
      send(relayer.address, escrow, escrowAbi, "createLink", [
        sender.address, usd(50), auth.validBefore, thief.address, Number(expiry), auth.v, auth.r, auth.s,
      ]),
    );

    // The claim key signs for the recipient; the relayer pays the gas.
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
        [escrow, BigInt(chainId), claimKey.address, recipient.address],
      ),
    );
    const claimSig = hexToSignature(await claimKey.signMessage({ message: { raw: toBytes(inner) } }));

    // A front-runner who sees the claim can't reuse it for another address.
    await assert.rejects(
      send(relayer.address, escrow, escrowAbi, "claim", [
        claimKey.address, relayer.address, Number(claimSig.v), claimSig.r, claimSig.s,
      ]),
    );
    await send(relayer.address, escrow, escrowAbi, "claim", [
      claimKey.address, recipient.address, Number(claimSig.v), claimSig.r, claimSig.s,
    ]);
    assert.equal(await balance(recipient.address), usd(50));
    assert.equal(await balance(escrow), 0n);

    // Claiming twice fails.
    await assert.rejects(
      send(relayer.address, escrow, escrowAbi, "claim", [
        claimKey.address, recipient.address, Number(claimSig.v), claimSig.r, claimSig.s,
      ]),
    );
  });

  it("returns an unclaimed link to the sender after it expires", async () => {
    const claimKey = privateKeyToAccount(generatePrivateKey());
    const expiry = (await now()) + 3600n;
    const nonce = (await client.readContract({
      address: escrow, abi: escrowAbi, functionName: "linkNonce", args: [claimKey.address, Number(expiry)],
    })) as Hex;
    const auth = await authorize(usd(20), nonce);
    await send(relayer.address, escrow, escrowAbi, "createLink", [
      sender.address, usd(20), auth.validBefore, claimKey.address, Number(expiry), auth.v, auth.r, auth.s,
    ]);
    const before = await balance(sender.address);
    await assert.rejects(send(relayer.address, escrow, escrowAbi, "refund", [claimKey.address]));
    await warp(3601n);
    await send(relayer.address, escrow, escrowAbi, "refund", [claimKey.address]);
    assert.equal(await balance(sender.address), before + usd(20));
  });

  it("pays a fixed standing order when CRE reports, once per period, with the rate on record", async () => {
    const firstDue = (await now()) + 60n;
    const period = 7 * 86400;
    const salt = keccak256(toBytes("order-1"));
    const params = [recipient.address, usd(25), usd(100), Number(firstDue), period, 0, salt] as const;
    const nonce = (await client.readContract({
      address: escrow, abi: escrowAbi, functionName: "orderNonce", args: [...params],
    })) as Hex;
    const auth = await authorize(usd(100), nonce);
    await send(relayer.address, escrow, escrowAbi, "createOrder", [
      sender.address, ...params, auth.validBefore, auth.v, auth.r, auth.s,
    ]);

    const report = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], [[0n], 1_530_250000n]);
    // Only a registered forwarder may deliver reports.
    await assert.rejects(send(relayer.address, escrow, escrowAbi, "onReport", ["0x", report]));

    // Not due yet: nothing moves.
    const start = await balance(recipient.address);
    await send(forwarder.address, escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(recipient.address), start);

    await warp(61n);
    const due = (await client.readContract({
      address: escrow, abi: escrowAbi, functionName: "dueOrders", args: [0n, 50n],
    })) as bigint[];
    assert.deepEqual(due, [0n]);
    await send(forwarder.address, escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(recipient.address), start + usd(25));

    // A duplicate report in the same period pays nothing.
    await send(forwarder.address, escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(recipient.address), start + usd(25));

    // The sender closes the order and gets the rest back.
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "string" }, { type: "uint256" }],
        [escrow, BigInt(chainId), "close", 0n],
      ),
    );
    const closeSig = hexToSignature(await sender.signMessage({ message: { raw: toBytes(inner) } }));
    const beforeClose = await balance(sender.address);
    await send(relayer.address, escrow, escrowAbi, "closeOrder", [0n, Number(closeSig.v), closeSig.r, closeSig.s]);
    assert.equal(await balance(sender.address), beforeClose + usd(75));
  });

  it("tops a recipient up to a target instead of sending a fixed amount", async () => {
    const mum = privateKeyToAccount(generatePrivateKey());
    await send(WHALE, AUSD, ausdAbi, "transfer", [mum.address, usd(30)]);
    const firstDue = await now();
    const salt = keccak256(toBytes("order-topup"));
    const params = [mum.address, usd(100), usd(200), Number(firstDue), 86400, 1, salt] as const;
    const nonce = (await client.readContract({
      address: escrow, abi: escrowAbi, functionName: "orderNonce", args: [...params],
    })) as Hex;
    const auth = await authorize(usd(200), nonce);
    await send(relayer.address, escrow, escrowAbi, "createOrder", [
      sender.address, ...params, auth.validBefore, auth.v, auth.r, auth.s,
    ]);
    const id = ((await client.readContract({ address: escrow, abi: escrowAbi, functionName: "ordersLength" })) as bigint) - 1n;
    const report = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], [[id], 1_530_000000n]);

    await warp(1n);
    await send(forwarder.address, escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(mum.address), usd(100));

    // Next day she's spent $40, so only $40 goes out.
    await send(mum.address, AUSD, ausdAbi, "transfer", [WHALE, usd(40)]);
    await warp(86400n);
    await send(forwarder.address, escrow, escrowAbi, "onReport", ["0x", report]);
    assert.equal(await balance(mum.address), usd(100));
  });
});
