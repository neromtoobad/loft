// Network config shared by the server, the web app and scripts.
import { type Abi, type Address, type Chain, defineChain, parseAbi } from "viem";
import deploymentsJson from "./deployments.json" with { type: "json" };
import escrowAbiJson from "./escrow-abi.json" with { type: "json" };

export const escrowAbi = escrowAbiJson as Abi;

export type NetworkName = "mainnet" | "testnet";

type Deployment = { escrow: Address; block: number; relayer: Address; convert?: Address } | null;
const deployments = deploymentsJson as Record<NetworkName, Deployment>;

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  testnet: true,
});

export type Network = {
  name: NetworkName;
  chain: Chain;
  ausd: Address;
  /** LoftEscrow, from shared/deployments.json. */
  escrow: Address | undefined;
  /** Block the escrow was deployed in, where indexers start. */
  escrowBlock: number | undefined;
  /** Chainlink CRE KeystoneForwarder (production). */
  creForwarder: Address;
  /** Chainlink CRE forwarder used by `cre workflow simulate --broadcast`. */
  creSimulationForwarder: Address;
  /** Circle USDC, what Aurora Intents delivers from other chains (mainnet only). */
  usdc?: Address;
  /** Trader Joe Liquidity Book AUSD/USDC pair that LoftConvert swaps through. */
  usdcPair?: Address;
  /** LoftConvert, from shared/deployments.json. */
  convert?: Address;
};

export const NETWORKS: Record<NetworkName, Network> = {
  mainnet: {
    name: "mainnet",
    chain: monadMainnet,
    ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    escrow: deployments.mainnet?.escrow,
    escrowBlock: deployments.mainnet?.block,
    creForwarder: "0x76c9cf548b4179F8901cda1f8623568b58215E62",
    creSimulationForwarder: "0x9eF6468C5f37b976E57d52054c693269479A784d",
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    usdcPair: "0x465A0B350bb6a7eFF750729f1D866d67F0b53980",
    convert: deployments.mainnet?.convert,
  },
  testnet: {
    name: "testnet",
    chain: monadTestnet,
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    escrow: deployments.testnet?.escrow,
    escrowBlock: deployments.testnet?.block,
    creForwarder: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482",
    creSimulationForwarder: "0xB9F79d863261869B234c481D1f9A7af84AeAd192",
  },
};

/** AUSD's EIP-712 domain name and version, read from `eip712Domain()` on both networks. */
export const AUSD_DOMAIN = { name: "Agora Dollar", version: "1" } as const;
export const AUSD_DECIMALS = 6;
/** Circle USDC on Monad: `name()` is "USDC", `version()` is "2". */
export const USDC_DOMAIN = { name: "USDC", version: "2" } as const;

export const convertAbi = parseAbi([
  "function convertNonce(address owner, uint256 amount, uint256 minOut, bytes32 salt) view returns (bytes32)",
  "function convert(address owner, uint256 amount, uint256 minOut, bytes32 salt, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (uint256 out)",
  "event Converted(address indexed owner, uint256 usdcIn, uint256 ausdOut, bytes32 salt)",
  "error Slippage(uint256 out, uint256 minOut)",
]);

/** Quotes a USDC to AUSD swap on the Liquidity Book pair (AUSD is token X there). */
export const lbPairAbi = parseAbi([
  "function getTokenX() view returns (address)",
  "function getSwapOut(uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)",
]);

export const ausdAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const RECEIVE_AUTH_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
