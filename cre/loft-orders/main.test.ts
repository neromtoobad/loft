import { describe, expect } from "bun:test";
import { EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionResult, hexToBytes, toHex } from "viem";
import config from "./config.mainnet.json";
import { type Config, ESCROW_ABI, onCron } from "./main";

const MONAD_MAINNET = 8481857512324358265n;
const cfg = { ...config, escrowAddress: "0x87Dbf33f24124a9325Af70FE573408F1Fa76BFDE" } as Config;

function b64(hex: `0x${string}`) {
  return Buffer.from(hexToBytes(hex)).toString("base64");
}

function body(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

/** Three sources, one of them broken, one an outlier that must not move the median. */
function mockRates(values: { er?: number; jsd?: number; pages?: number }) {
  const http = HttpActionsMock.testInstance();
  const seen: string[] = [];
  http.sendRequest = (req) => {
    seen.push(req.url);
    if (req.url.includes("open.er-api") && values.er !== undefined) return { statusCode: 200, headers: {}, body: body({ rates: { NGN: values.er } }) };
    if (req.url.includes("jsdelivr") && values.jsd !== undefined) return { statusCode: 200, headers: {}, body: body({ usd: { ngn: values.jsd } }) };
    if (req.url.includes("pages.dev") && values.pages !== undefined) return { statusCode: 200, headers: {}, body: body({ usd: { ngn: values.pages } }) };
    return { statusCode: 503, headers: {}, body: "" };
  };
  return seen;
}

function mockDue(ids: bigint[]) {
  const evm = EvmMock.testInstance(MONAD_MAINNET);
  evm.callContract = () => ({ data: b64(encodeFunctionResult({ abi: ESCROW_ABI, functionName: "dueOrders", result: ids })) });
  const writes: { receiver: string; payload: `0x${string}` }[] = [];
  evm.writeReport = (req: any) => {
    const raw: Uint8Array = req.report?.rawReport ?? new Uint8Array();
    writes.push({ receiver: toHex(req.receiver ?? new Uint8Array()), payload: toHex(raw) });
    return { txStatus: "TX_STATUS_SUCCESS", txHash: b64(`0x${"ab".repeat(32)}`) } as any;
  };
  return { evm, writes };
}

describe("loft standing orders workflow", () => {
  test("does nothing when no order is due", () => {
    mockRates({ er: 1329 });
    const { writes } = mockDue([]);
    const runtime = newTestRuntime();
    runtime.config = cfg;
    expect(onCron(runtime as any)).toEqual({ due: 0 });
    expect(writes).toHaveLength(0);
  });

  test("pays due orders with the median rate from the sources that answered", () => {
    const seen = mockRates({ er: 1329.26, jsd: 1331.5 }); // pages.dev is down
    const { writes } = mockDue([0n, 3n]);
    const runtime = newTestRuntime();
    runtime.config = cfg;
    const result = onCron(runtime as any);

    expect(seen).toHaveLength(3);
    expect(result.due).toBe(2);
    expect(result.ngnPerUsd).toBeCloseTo((1329.26 + 1331.5) / 2, 6);
    expect(writes).toHaveLength(1);

    // The report carries exactly what LoftEscrow.onReport decodes.
    const expected = encodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256" }],
      [[0n, 3n], BigInt(Math.round(((1329.26 + 1331.5) / 2) * 1e6))],
    );
    expect(writes[0].payload.endsWith(expected.slice(2))).toBe(true);
    const tail = `0x${writes[0].payload.slice(writes[0].payload.length - (expected.length - 2))}` as `0x${string}`;
    const [ids, rate] = decodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], tail);
    expect(ids).toEqual([0n, 3n]);
    expect(rate).toBe(1330380000n);
  });

  test("ignores an out-of-band source instead of letting it skew the rate", () => {
    mockRates({ er: 1329, jsd: 1331, pages: 13.29 }); // a decimal slip from one source
    mockDue([1n]);
    const runtime = newTestRuntime();
    runtime.config = cfg;
    expect(onCron(runtime as any).ngnPerUsd).toBe(1330);
  });

  test("refuses to write when no source gives a sane rate", () => {
    mockRates({});
    const { writes } = mockDue([1n]);
    const runtime = newTestRuntime();
    runtime.config = cfg;
    expect(() => onCron(runtime as any)).toThrow();
    expect(writes).toHaveLength(0);
  });
});
