// Runs LoftConvert against a fork of Monad mainnet, with Circle's real USDC
// and the live Trader Joe AUSD/USDC pair, signing exactly as the app does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { type Address, domainSeparator, parseAbi, parseSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORKS, USDC_DOMAIN, convertAbi, lbPairAbi } from "../shared/config.ts";
import { signConvert } from "../shared/money.ts";
import { forkOf } from "./fork.ts";

const net = NETWORKS.mainnet;
const USDC = net.usdc!;
const AUSD = net.ausd;
const PAIR = net.usdcPair!;
// Uniswap's MON/USDC pool holds the most USDC on Monad; the fork borrows from it.
const WHALE: Address = "0x659bD0BC4167BA25c62E05656F78043E7eD4a9da";

const client = forkOf(process.env.MONAD_RPC ?? "https://rpc.monad.xyz");
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);
const owner = privateKeyToAccount(generatePrivateKey());
const relayer = privateKeyToAccount(generatePrivateKey());
let convert: Address;

const bal = (token: Address, who: Address) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });

async function call(to: Address, abi: any, functionName: string, args: unknown[], from: Address = relayer.address) {
  const res = await client.tevmContract({ from, to, abi, functionName, args, addToBlockchain: true, skipBalance: true });
  if (res.errors?.length) throw new Error(res.errors.map((e: any) => e.message).join("; "));
  return res;
}

async function signed(amount: bigint, minOut: bigint) {
  const s = await signConvert(owner, { chainId: 143, usdc: USDC, convert }, amount, minOut);
  const { v, r, s: ss, yParity } = parseSignature(s.signature);
  return [s.owner, s.amount, s.minOut, s.salt, s.validBefore, Number(v ?? BigInt(27 + (yParity ?? 0))), r, ss] as const;
}

describe("LoftConvert on a Monad mainnet fork", () => {
  before(async () => {
    const { bytecode, abi } = JSON.parse(readFileSync("out/LoftConvert.json", "utf8"));
    const deployed = await client.tevmDeploy({ from: relayer.address, abi, bytecode, args: [USDC, AUSD, PAIR], addToBlockchain: true, skipBalance: true });
    if (deployed.errors?.length) throw new Error(deployed.errors[0].message);
    convert = deployed.createdAddress as Address;
    await call(USDC, erc20, "transfer", [owner.address, 100_000_000n], WHALE);
  });

  it("signs against USDC's real EIP-712 domain", async () => {
    const onchain = await client.readContract({ address: USDC, abi: erc20, functionName: "DOMAIN_SEPARATOR" });
    const ours = domainSeparator({ domain: { ...USDC_DOMAIN, chainId: 143, verifyingContract: USDC } });
    assert.equal(ours, onchain);
  });

  it("turns USDC into AUSD on the owner's address, gaslessly, at about 1:1", async () => {
    const amount = 25_000_000n; // $25
    const [, quoted] = await client.readContract({ address: PAIR, abi: lbPairAbi, functionName: "getSwapOut", args: [amount, false] });
    const minOut = (quoted * 995n) / 1000n;
    const ausdBefore = await bal(AUSD, owner.address);
    await call(convert, convertAbi, "convert", [...(await signed(amount, minOut))]);
    const got = (await bal(AUSD, owner.address)) - ausdBefore;
    assert.equal(got, quoted);
    assert.ok(got >= 24_900_000n, `got ${got}`);
    assert.equal(await bal(USDC, owner.address), 75_000_000n);
    assert.equal(await bal(USDC, convert), 0n);
    assert.equal(await bal(AUSD, convert), 0n);
  });

  it("won't run the same signature twice", async () => {
    const args = await signed(5_000_000n, 4_900_000n);
    await call(convert, convertAbi, "convert", [...args]);
    await assert.rejects(call(convert, convertAbi, "convert", [...args]));
  });

  it("rejects a relayer that tries to loosen the price", async () => {
    const args = await signed(5_000_000n, 4_990_000n);
    const loosened = [...args];
    loosened[2] = 0n;
    await assert.rejects(call(convert, convertAbi, "convert", loosened));
  });

  it("reverts instead of filling below the signed minimum", async () => {
    await assert.rejects(call(convert, convertAbi, "convert", [...(await signed(5_000_000n, 6_000_000n))]), /Slippage|revert/i);
    assert.ok((await bal(USDC, owner.address)) > 0n);
  });
});
