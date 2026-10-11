// The corridor page's reading of LoftEscrow / LoftConvert logs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Abi, type Log, encodeAbiParameters, encodeEventTopics, getAbiItem, padHex } from "viem";
import { convertAbi, escrowAbi } from "../shared/config.ts";
import { moves } from "../server/corridor.ts";

const A = padHex("0xa1", { size: 20 });
const B = padHex("0xb2", { size: 20 });
const REF = padHex("0x01", { size: 32 });
let i = 0;

function log(abi: Abi, eventName: string, args: Record<string, unknown>): Log {
  const item = getAbiItem({ abi, name: eventName }) as any;
  const data = item.inputs.filter((x: any) => !x.indexed);
  i += 1;
  return {
    address: A,
    topics: encodeEventTopics({ abi, eventName, args } as any) as any,
    data: encodeAbiParameters(data, data.map((x: any) => args[x.name])),
    blockNumber: 100n,
    blockHash: padHex("0x0", { size: 32 }),
    logIndex: i,
    transactionHash: padHex(`0x${i.toString(16)}`, { size: 32 }),
    transactionIndex: 0,
    removed: false,
  };
}

describe("corridor moves", () => {
  it("counts sends, claims, Chainlink orders, pot payouts and top-ups, and skips a reclaimed link", () => {
    const m = moves([
      log(escrowAbi, "Sent", { from: A, to: B, amount: 5_000_000n, ref: REF }),
      log(escrowAbi, "LinkClaimed", { claimKey: B, sender: A, recipient: B, amount: 7_000_000n }),
      log(escrowAbi, "LinkClaimed", { claimKey: B, sender: A, recipient: A, amount: 9_000_000n }),
      log(escrowAbi, "Remitted", { orderId: 1n, sender: A, recipient: B, amount: 20_000_000n, ngnPerUsd: 1_500_000_000n }),
      log(escrowAbi, "PotReleased", { potId: 0n, beneficiary: B, amount: 30_000_000n }),
      log(escrowAbi, "PotCreated", { potId: 0n, organizer: A, beneficiary: B, target: 1n, deadline: 1n }),
      log(convertAbi, "Converted", { owner: A, usdcIn: 25_000_000n, ausdOut: 25_001_000n, salt: REF }),
    ]);
    assert.deepEqual(
      m.map((x) => [x.kind, x.amount]),
      [
        ["DIRECT", 5_000_000n],
        ["LINK", 7_000_000n],
        ["ORDER", 20_000_000n],
        ["POT", 30_000_000n],
        ["TOPUP", 25_001_000n],
      ],
    );
  });
});
