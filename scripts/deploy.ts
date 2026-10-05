// Deploys LoftEscrow with the relayer key and records it in
// shared/deployments.json. Both Chainlink CRE forwarders become reporters: the
// KeystoneForwarder for the deployed workflow, and the simulation forwarder so
// `cre workflow simulate --broadcast` pays real orders in a demo.
//
//   NETWORK=mainnet npx tsx scripts/deploy.ts
import { readFileSync, writeFileSync } from "node:fs";
import { type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, type NetworkName, escrowAbi } from "../shared/config.ts";

process.loadEnvFile(".env");
const network = NETWORKS[(process.env.NETWORK as NetworkName) ?? "mainnet"];
const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
const transport = http(process.env.RPC_URL);
const pc = createPublicClient({ chain: network.chain, transport });
const wc = createWalletClient({ account, chain: network.chain, transport });
const { bytecode } = JSON.parse(readFileSync("out/LoftEscrow.json", "utf8"));

const balance = await pc.getBalance({ address: account.address });
console.log(`${network.name}: deploying from ${account.address} (${formatEther(balance)} MON)`);
if (balance === 0n) throw new Error("the relayer has no MON for gas");

const hash = await wc.deployContract({ abi: escrowAbi, bytecode, args: [network.ausd, network.creForwarder] });
const receipt = await pc.waitForTransactionReceipt({ hash });
const escrow = receipt.contractAddress;
if (!escrow || receipt.status !== "success") throw new Error(`deploy failed: ${hash}`);
console.log(`LoftEscrow ${escrow} (block ${receipt.blockNumber}, tx ${hash})`);

const set = await wc.writeContract({
  address: escrow,
  abi: escrowAbi,
  functionName: "setReporter",
  args: [network.creSimulationForwarder, true],
});
await pc.waitForTransactionReceipt({ hash: set });
for (const who of [network.creForwarder, network.creSimulationForwarder]) {
  const ok = await pc.readContract({ address: escrow, abi: escrowAbi, functionName: "isReporter", args: [who] });
  console.log(`reporter ${who}: ${ok}`);
}

const file = "shared/deployments.json";
const deployments = JSON.parse(readFileSync(file, "utf8"));
deployments[network.name] = { escrow, block: Number(receipt.blockNumber), relayer: account.address };
writeFileSync(file, `${JSON.stringify(deployments, null, 2)}\n`);
console.log(`recorded in ${file}`);

// Point the Envio indexer and the CRE workflow at the new escrow.
if (network.name === "mainnet") {
  const indexer = "indexer/config.yaml";
  writeFileSync(
    indexer,
    readFileSync(indexer, "utf8")
      .replace(/start_block: \d+/, `start_block: ${receipt.blockNumber}`)
      .replace(/address: "0x[0-9a-fA-F]{40}"/, `address: "${escrow}"`),
  );
  const cre = "cre/loft-orders/config.mainnet.json";
  const creConfig = JSON.parse(readFileSync(cre, "utf8"));
  writeFileSync(cre, `${JSON.stringify({ ...creConfig, escrowAddress: escrow }, null, 2)}\n`);
  console.log(`updated ${indexer} and ${cre}`);
}
