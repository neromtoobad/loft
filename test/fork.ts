// A local fork of Monad testnet with Agora's real AUSD, shared by the tests.
import { readFileSync } from "node:fs";
import { createMemoryClient, http } from "tevm";
import { type Address, type Hex, keccak256, parseAbi, toHex } from "viem";

export const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
export const AUSD: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
// Perpl's testnet exchange holds most testnet AUSD; the fork borrows from it.
export const WHALE: Address = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";

export const escrowArtifact = JSON.parse(readFileSync("out/LoftEscrow.json", "utf8"));
export const escrowAbi = escrowArtifact.abi;
export const ausdAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

// Monad's RPC has no eth_getProof, which tevm uses to fetch forked accounts.
// Nothing here verifies the proofs, so the answer is assembled from plain
// reads.
const upstream = http(RPC)({});
const forkTransport = {
  ...upstream,
  async request(args: { method: string; params?: any }) {
    if (args.method !== "eth_getProof") return upstream.request(args as any);
    const [address, keys, block] = args.params;
    const [balance, nonce, code, ...values] = await Promise.all([
      upstream.request({ method: "eth_getBalance", params: [address, block] }),
      upstream.request({ method: "eth_getTransactionCount", params: [address, block] }),
      upstream.request({ method: "eth_getCode", params: [address, block] }),
      ...keys.map((key: Hex) => upstream.request({ method: "eth_getStorageAt", params: [address, key, block] })),
    ]);
    return {
      address,
      balance,
      nonce,
      codeHash: keccak256(code as Hex),
      storageHash: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      accountProof: [],
      storageProof: keys.map((key: Hex, i: number) => ({ key, value: values[i], proof: [] })),
    };
  },
};

export const client = createMemoryClient({ fork: { transport: forkTransport as any }, miningConfig: { type: "auto" } });


export const usd = (n: number) => BigInt(Math.round(n * 1e6));

export async function balance(who: Address) {
  return client.readContract({ address: AUSD, abi: ausdAbi, functionName: "balanceOf", args: [who] });
}

export async function now() {
  return (await client.getBlock()).timestamp;
}

export async function send(from: Address, to: Address, abi: any, functionName: string, args: unknown[]) {
  const res = await client.tevmContract({ from, to, abi, functionName, args, addToBlockchain: true, skipBalance: true });
  if (res.errors?.length) throw new Error(res.errors.map((e: any) => e.message).join("; "));
  return res;
}

export async function warp(seconds: bigint) {
  await client.request({ method: "evm_increaseTime" as any, params: [toHex(seconds)] as any });
  await client.tevmMine();
}


/** Deploys a fresh LoftEscrow that trusts `forwarder` for CRE reports. */
export async function deployEscrow(from: Address, forwarder: Address): Promise<Address> {
  const deployed = await client.tevmDeploy({
    from,
    abi: escrowAbi,
    bytecode: escrowArtifact.bytecode,
    args: [AUSD, forwarder],
    addToBlockchain: true,
    skipBalance: true,
  });
  if (deployed.errors?.length) throw new Error(deployed.errors[0].message);
  return deployed.createdAddress as Address;
}
