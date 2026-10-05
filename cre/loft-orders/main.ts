// Loft standing orders, orchestrated by Chainlink CRE.
//
// On a schedule, the DON:
//   1. reads which prepaid standing orders are due from LoftEscrow (EVM read),
//   2. fetches the naira rate from several public sources on every node and
//      agrees on the median (HTTP + consensus),
//   3. delivers one signed report to LoftEscrow.onReport, which pays each
//      due order and records the agreed rate on the receipt (EVM write).
//
// The escrow only pays orders that are actually due, to recipients fixed when
// the sender prepaid them, so a report can't redirect money. The rate is for
// the receipt: it tells the family what the dollars were worth at home.
import {
  bytesToHex,
  CronCapability,
  consensusMedianAggregation,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  HTTPClient,
  type HTTPSendRequester,
  handler,
  LATEST_BLOCK_NUMBER,
  json,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { z } from "zod";

export const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  escrowAddress: z.string(),
  gasLimit: z.string(),
  /** How many orders one run looks at. */
  maxOrders: z.number().int().positive(),
  /** Public NGN-per-USD sources: `path` is a dot path into the JSON body. */
  rateSources: z.array(z.object({ url: z.string(), path: z.string() })).min(1),
  /** Reject a rate outside this band instead of writing it onchain. */
  minRate: z.number().positive(),
  maxRate: z.number().positive(),
});

export type Config = z.infer<typeof configSchema>;

export const ESCROW_ABI = parseAbi([
  "function dueOrders(uint256 start, uint256 limit) view returns (uint256[] ids)",
]);

function pick(body: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), body);
}

/**
 * Runs on every node. Each node asks every source and takes its own median, so
 * one bad source can't move a node's answer, and the DON then takes the
 * median across nodes.
 */
export const fetchNgnPerUsd = (requester: HTTPSendRequester, config: Config): number => {
  const values: number[] = [];
  for (const source of config.rateSources) {
    try {
      const response = requester.sendRequest({ url: source.url, method: "GET" }).result();
      if (!ok(response)) continue;
      const value = Number(pick(json(response), source.path));
      if (Number.isFinite(value) && value >= config.minRate && value <= config.maxRate) values.push(value);
    } catch {
      // A source being down is normal; the others still count.
    }
  }
  if (values.length === 0) throw new Error("no naira rate source answered within bounds");
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
};

export type RunResult = { due: number; ngnPerUsd?: number; txHash?: string };

export const onCron = (runtime: Runtime<Config>): RunResult => {
  const config = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  // 1. Which orders are due?
  const read = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.escrowAddress as Address,
        data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "dueOrders", args: [0n, BigInt(config.maxOrders)] }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const ids = decodeFunctionResult({ abi: ESCROW_ABI, functionName: "dueOrders", data: bytesToHex(read.data) }) as readonly bigint[];
  if (ids.length === 0) {
    runtime.log("no standing orders due");
    return { due: 0 };
  }
  runtime.log(`${ids.length} standing order(s) due: ${ids.join(", ")}`);

  // 2. The naira rate, agreed across the DON.
  const ngnPerUsd = new HTTPClient()
    .sendRequest(runtime, fetchNgnPerUsd, consensusMedianAggregation())(config)
    .result();
  runtime.log(`agreed rate: ${ngnPerUsd} NGN per USD`);

  // 3. One report pays every due order. Same encoding LoftEscrow.onReport decodes.
  const payload = encodeAbiParameters(
    [{ type: "uint256[]" }, { type: "uint256" }],
    [[...ids], BigInt(Math.round(ngnPerUsd * 1e6))],
  );
  const report = runtime.report(prepareReportRequest(payload)).result();
  const write = evm
    .writeReport(runtime, { receiver: config.escrowAddress, report, gasConfig: { gasLimit: config.gasLimit } })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report write failed: ${write.errorMessage || write.txStatus}`);
  }
  const txHash = write.txHash ? bytesToHex(write.txHash) : undefined;
  runtime.log(`paid ${ids.length} order(s)${txHash ? ` in ${txHash}` : ""}`);
  return { due: ids.length, ngnPerUsd, txHash };
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
