// Deploys LoftConvert (USDC -> AUSD for any-chain top-ups) with the relayer
// key and records it in shared/deployments.json.
//
//   npx tsx scripts/deploy-convert.ts
import { readFileSync, writeFileSync } from "node:fs";
import { type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS } from "../shared/config.ts";

process.loadEnvFile(".env");
const network = NETWORKS.mainnet;
const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
const transport = http(process.env.RPC_URL);
const pc = createPublicClient({ chain: network.chain, transport });
const wc = createWalletClient({ account, chain: network.chain, transport });
const { abi, bytecode } = JSON.parse(readFileSync("out/LoftConvert.json", "utf8"));

console.log(`deploying LoftConvert from ${account.address} (${formatEther(await pc.getBalance({ address: account.address }))} MON)`);
const hash = await wc.deployContract({ abi, bytecode, args: [network.usdc, network.ausd, network.usdcPair] });
const receipt = await pc.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress || receipt.status !== "success") throw new Error(`deploy failed: ${hash}`);
console.log(`LoftConvert ${receipt.contractAddress} (block ${receipt.blockNumber}, tx ${hash})`);

const file = "shared/deployments.json";
const deployments = JSON.parse(readFileSync(file, "utf8"));
deployments.mainnet.convert = receipt.contractAddress;
writeFileSync(file, `${JSON.stringify(deployments, null, 2)}\n`);
console.log(`recorded in ${file}; ${formatEther(await pc.getBalance({ address: account.address }))} MON left`);
