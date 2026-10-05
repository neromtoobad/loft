// Builds the signatures behind every Loft flow. All of it runs inside the
// sender's Mera session: nothing here needs gas or a network round trip.
import {
  type Address,
  type Hex,
  type LocalAccount,
  encodeAbiParameters,
  keccak256,
  toBytes,
  toHex,
} from "viem";
import { AUSD_DECIMALS, AUSD_DOMAIN, RECEIVE_AUTH_TYPES } from "./config.ts";

export type Ctx = { chainId: number; ausd: Address; escrow: Address };

const AUTH_TTL_SECONDS = 30 * 60;

export function toUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** AUSD_DECIMALS));
}

export function fromUnits(units: bigint | string): number {
  return Number(BigInt(units)) / 10 ** AUSD_DECIMALS;
}

function domain(ctx: Ctx) {
  return { ...AUSD_DOMAIN, chainId: ctx.chainId, verifyingContract: ctx.ausd };
}

function validBefore() {
  return BigInt(Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS);
}

function randomNonce(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function signReceive(account: LocalAccount, ctx: Ctx, value: bigint, nonce: Hex) {
  const vb = validBefore();
  const signature = await account.signTypedData({
    domain: domain(ctx),
    types: RECEIVE_AUTH_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: ctx.escrow, value, validAfter: 0n, validBefore: vb, nonce },
  });
  return { validBefore: vb, signature };
}

// ------------------------------------------------------------------- sends

/** Mirrors LoftEscrow.sendNonce. */
export function sendNonce(escrow: Address, to: Address, ref: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "string" }, { type: "address" }, { type: "bytes32" }], [escrow, "send", to, ref]),
  );
}

/**
 * A direct payment through LoftEscrow.send. `ref` should be the hash of
 * the sealed note, so the recipient can check the note against the chain.
 */
export async function signSend(account: LocalAccount, ctx: Ctx, to: Address, amount: bigint, ref: Hex = randomNonce()) {
  const auth = await signReceive(account, ctx, amount, sendNonce(ctx.escrow, to, ref));
  return { from: account.address, to, amount, ref, ...auth };
}

// ------------------------------------------------------------------- links

/** Mirrors LoftEscrow.linkNonce. */
export function linkNonce(escrow: Address, claimKey: Address, expiry: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "string" }, { type: "address" }, { type: "uint40" }],
      [escrow, "link", claimKey, expiry],
    ),
  );
}

/** Funds a claim link. `claimKey` is the address of the link's one-off key. */
export async function signLink(account: LocalAccount, ctx: Ctx, claimKey: Address, amount: bigint, expiry: number) {
  const auth = await signReceive(account, ctx, amount, linkNonce(ctx.escrow, claimKey, expiry));
  return { sender: account.address, amount, claimKey, expiry, ...auth };
}

/** The link's own key authorises paying out to `recipient` (mirrors claimDigest). */
export async function signClaim(claimAccount: LocalAccount, ctx: Ctx, recipient: Address) {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
      [ctx.escrow, BigInt(ctx.chainId), claimAccount.address, recipient],
    ),
  );
  const signature = await claimAccount.signMessage({ message: { raw: toBytes(inner) } });
  return { claimKey: claimAccount.address, recipient, signature };
}

// ------------------------------------------------------------------ orders

export type OrderMode = 0 | 1; // Fixed, TopUp

/** Mirrors LoftEscrow.orderNonce. */
export function orderNonce(
  escrow: Address,
  o: { recipient: Address; amount: bigint; budget: bigint; firstDue: number; period: number; mode: OrderMode; salt: Hex },
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "string" },
        { type: "address" },
        { type: "uint96" },
        { type: "uint96" },
        { type: "uint40" },
        { type: "uint32" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [escrow, "order", o.recipient, o.amount, o.budget, o.firstDue, o.period, o.mode, o.salt],
    ),
  );
}

export async function signOrder(
  account: LocalAccount,
  ctx: Ctx,
  o: { recipient: Address; amount: bigint; budget: bigint; firstDue: number; period: number; mode: OrderMode },
) {
  const salt = randomNonce();
  const auth = await signReceive(account, ctx, o.budget, orderNonce(ctx.escrow, { ...o, salt }));
  return { sender: account.address, ...o, salt, ...auth };
}

/** Mirrors LoftEscrow.closeDigest. */
export async function signClose(account: LocalAccount, ctx: Ctx, orderId: bigint) {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "string" }, { type: "uint256" }],
      [ctx.escrow, BigInt(ctx.chainId), "close", orderId],
    ),
  );
  const signature = await account.signMessage({ message: { raw: toBytes(inner) } });
  return { orderId, signature };
}
