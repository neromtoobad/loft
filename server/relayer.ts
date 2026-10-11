// Submits users' signed authorizations so nobody on Loft ever needs MON.
// Every request is simulated first, so a bad signature costs nothing.
import {
  type Address,
  type Hex,
  type Log,
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Network, convertAbi, escrowAbi } from "../shared/config.ts";

export type Relayer = ReturnType<typeof createRelayer>;

/** What a landed transaction did, for the relay log. */
export type Confirmed = { hash: Hex; functionName: string; ms: number; gasWei: bigint; logs: Log[] };

export function createRelayer(network: Network, privateKey: Hex, rpcUrl?: string, onConfirmed?: (c: Confirmed) => void) {
  const transport = http(rpcUrl);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: network.chain, transport });
  const walletClient = createWalletClient({ account, chain: network.chain, transport });

  // One transaction at a time keeps nonces simple; Monad's ~400ms blocks
  // mean the queue drains fast.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  async function submit(address: Address, abi: any, functionName: string, args: unknown[]) {
    const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
    // Estimates net out storage refunds that execution still has to front,
    // so a bare estimate can run out of gas. Monad bills the gas limit, so
    // the margin stays modest.
    const estimate = await publicClient.estimateContractGas({ account, address, abi, functionName, args });
    return serial(async () => {
      const gas = (estimate * 125n) / 100n;
      const started = performance.now();
      const hash = await walletClient.writeContract({ ...request, gas });
      // Bounded, so one transaction that never lands can't freeze every payment queued behind it.
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 250 });
      if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
      try {
        onConfirmed?.({
          hash,
          functionName,
          ms: performance.now() - started,
          // Monad charges the gas limit, not the gas used.
          gasWei: gas * receipt.effectiveGasPrice,
          logs: receipt.logs,
        });
      } catch (err) {
        console.error("relay log:", (err as Error).message);
      }
      return { hash, blockNumber: Number(receipt.blockNumber) };
    });
  }

  function escrow(): Address {
    if (!network.escrow) throw new Error(`LoftEscrow is not deployed on ${network.name}`);
    return network.escrow;
  }

  function vrs(signature: Hex) {
    const { v, r, s, yParity } = parseSignature(signature);
    return [Number(v ?? BigInt(27 + (yParity ?? 0))), r, s] as const;
  }

  return {
    address: account.address,
    publicClient,

    /** A direct payment to someone who already has an address. */
    send(p: { from: Address; to: Address; amount: bigint; validBefore: bigint; ref: Hex; signature: Hex }) {
      return submit(escrow(), escrowAbi, "send", [p.from, p.to, p.amount, p.validBefore, p.ref, ...vrs(p.signature)]);
    },

    createLink(p: {
      sender: Address;
      amount: bigint;
      validBefore: bigint;
      claimKey: Address;
      expiry: number;
      signature: Hex;
    }) {
      return submit(escrow(), escrowAbi, "createLink", [
        p.sender, p.amount, p.validBefore, p.claimKey, p.expiry, ...vrs(p.signature),
      ]);
    },

    claim(p: { claimKey: Address; recipient: Address; signature: Hex }) {
      return submit(escrow(), escrowAbi, "claim", [p.claimKey, p.recipient, ...vrs(p.signature)]);
    },

    refund(claimKey: Address) {
      return submit(escrow(), escrowAbi, "refund", [claimKey]);
    },

    createOrder(p: {
      sender: Address;
      recipient: Address;
      amount: bigint;
      budget: bigint;
      firstDue: number;
      period: number;
      mode: 0 | 1;
      minRate: bigint;
      salt: Hex;
      validBefore: bigint;
      signature: Hex;
    }) {
      return submit(escrow(), escrowAbi, "createOrder", [
        p.sender, p.recipient, p.amount, p.budget, p.firstDue, p.period, p.mode, p.minRate, p.salt, p.validBefore,
        ...vrs(p.signature),
      ]);
    },

    closeOrder(p: { orderId: bigint; signature: Hex }) {
      return submit(escrow(), escrowAbi, "closeOrder", [p.orderId, ...vrs(p.signature)]);
    },

    /** Opens a family pot in the organizer's name (their signature fixes the terms). */
    async createPot(p: { organizer: Address; beneficiary: Address; target: bigint; deadline: number; salt: Hex; signature: Hex }) {
      const result = await submit(escrow(), escrowAbi, "createPot", [
        p.organizer, p.beneficiary, p.target, p.deadline, p.salt, ...vrs(p.signature),
      ]);
      const receipt = await publicClient.getTransactionReceipt({ hash: result.hash });
      const [created] = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "PotCreated" });
      return { ...result, potId: Number((created as any).args.potId) };
    },

    /** Chips into a pot. Returns whether this contribution filled it (and paid it out). */
    async contribute(p: { potId: bigint; from: Address; amount: bigint; validBefore: bigint; ref: Hex; signature: Hex }) {
      const result = await submit(escrow(), escrowAbi, "contribute", [
        p.potId, p.from, p.amount, p.validBefore, p.ref, ...vrs(p.signature),
      ]);
      const receipt = await publicClient.getTransactionReceipt({ hash: result.hash });
      const released = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "PotReleased" }).length > 0;
      return { ...result, released };
    },

    /** Swaps USDC on the owner's address into AUSD through LoftConvert. Returns the AUSD received. */
    async convert(p: { owner: Address; amount: bigint; minOut: bigint; salt: Hex; validBefore: bigint; signature: Hex }) {
      if (!network.convert) throw new Error(`LoftConvert is not deployed on ${network.name}`);
      const result = await submit(network.convert, convertAbi, "convert", [
        p.owner, p.amount, p.minOut, p.salt, p.validBefore, ...vrs(p.signature),
      ]);
      const receipt = await publicClient.getTransactionReceipt({ hash: result.hash });
      const [done] = parseEventLogs({ abi: convertAbi, logs: receipt.logs, eventName: "Converted" });
      return { ...result, ausdOut: (done as any).args.ausdOut.toString() as string };
    },

    releasePot(potId: bigint) {
      return submit(escrow(), escrowAbi, "releasePot", [potId]);
    },

    async gasBalance() {
      return publicClient.getBalance({ address: account.address });
    },
  };
}
