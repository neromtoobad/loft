// A local Monad testnet fork for end-to-end runs of the app: real AUSD, a
// fresh LoftEscrow, a funded relayer, and a faucet for test dollars.
//
//   npx tsx scripts/local-chain.ts            # RPC on :8545, faucet on :8546
//   ESCROW_ADDRESS=<printed> NETWORK=testnet RPC_URL=http://localhost:8545 npx tsx server/index.ts
import { createServer as createHttp } from "node:http";
import { createServer } from "@tevm/server";
import { type Address, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AUSD, WHALE, ausdAbi, client, deployEscrow, send, usd } from "../test/fork.ts";

if (process.env.RELAYER_PRIVATE_KEY === undefined) process.loadEnvFile(".env");
const relayer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as `0x${string}`);
// The owner doubles as the CRE forwarder here, so reports can be sent by hand.
const OWNER: Address = "0x00000000000000000000000000000000000c0de5";

await client.tevmReady();
await client.tevmSetAccount({ address: relayer.address, balance: parseEther("100") });
await client.tevmSetAccount({ address: OWNER, balance: parseEther("100") });
const escrow = await deployEscrow(OWNER, OWNER);

createServer(client).listen(8545, () => {
  console.log("fork RPC      http://localhost:8545");
  console.log(`escrow        ${escrow}`);
  console.log(`relayer       ${relayer.address} (100 MON)`);
  console.log(`forwarder     ${OWNER}`);
});

// POST /faucet {"address": "0x…", "usd": 250}
createHttp(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { address, usd: amount = 250 } = JSON.parse(body || "{}");
    if (!isAddress(address)) throw new Error("address required");
    await send(WHALE, AUSD, ausdAbi, "transfer", [address, usd(Number(amount))]);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400).end(String((e as Error).message));
  }
}).listen(8546, () => console.log("faucet        POST http://localhost:8546/faucet"));
