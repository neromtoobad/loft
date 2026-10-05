// Local demo helper: on the fork from scripts/local-chain.ts, lets Chainlink's
// simulation forwarder report to the escrow and prepays a standing order for
// Mum that is already due, submitted through the Loft relay server. Then
// `cre workflow simulate loft-orders --target local-settings --broadcast`
// pays it.

import { createPublicClient, createWalletClient, http, parseAbi, parseSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { escrowAbi, monadTestnet } from "../shared/config.ts";
import { signOrder, toUnits } from "../shared/money.ts";

const RPC = "http://localhost:8545";
const ESCROW = "0x87Dbf33f24124a9325Af70FE573408F1Fa76BFDE";
const OWNER = "0x00000000000000000000000000000000000c0de5";
const SIM_FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192";
const MUM = "0x75836dE0C115a83aD96F3aC5Bb48c86D591e0935";
const pc = createPublicClient({ chain: monadTestnet, transport: http(RPC) });

// 1. Let Chainlink's simulation forwarder deliver reports to the local escrow.
await pc.request({ method: "anvil_impersonateAccount" as any, params: [OWNER] as any });
const owner = createWalletClient({ chain: monadTestnet, transport: http(RPC), account: OWNER });
await pc.waitForTransactionReceipt({ hash: await owner.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "setReporter", args: [SIM_FORWARDER, true], gas: 100000n }) });
console.log("sim forwarder is reporter:", await pc.readContract({ address: ESCROW, abi: escrowAbi, functionName: "isReporter", args: [SIM_FORWARDER] }));

// 2. A sender with test dollars prepays $10/week x 3 for Mum, due now.
const sender = privateKeyToAccount(generatePrivateKey());
await fetch("http://localhost:8546/faucet", { method: "POST", body: JSON.stringify({ address: sender.address, usd: 50 }) });
const now = Number((await pc.getBlock()).timestamp);
const signed = await signOrder(sender, { chainId: 10143, ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", escrow: ESCROW }, {
  recipient: MUM, amount: toUnits(10), budget: toUnits(30), firstDue: now - 60, period: 7 * 86400, mode: 0,
});
const res = await fetch("http://localhost:8788/api/relay/order", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify(signed, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
});
console.log("order via Loft relay:", res.status, await res.text());
console.log("due now:", await pc.readContract({ address: ESCROW, abi: escrowAbi, functionName: "dueOrders", args: [0n, 50n] }));
const bal = await pc.readContract({ address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [MUM] });
console.log("Mum balance before:", Number(bal) / 1e6);
