// Requests that change or reveal someone's data carry a signature from their
// Loft account, made inside the Mera session without a passkey prompt.
import { type Address, type Hex, keccak256, toBytes } from "viem";

export const AUTH_HEADER = "x-loft-auth";
/** How long a signed request stays valid. */
export const AUTH_WINDOW_MS = 5 * 60 * 1000;

export function authMessage(method: string, path: string, timestamp: number, body: string) {
  return `Loft request\n${method.toUpperCase()} ${path}\n${timestamp}\n${keccak256(toBytes(body))}`;
}

export function encodeAuth(address: Address, timestamp: number, signature: Hex) {
  return `${address}.${timestamp}.${signature}`;
}

export function decodeAuth(header: string | undefined) {
  const [address, timestamp, signature] = (header ?? "").split(".");
  if (!address || !timestamp || !signature) return undefined;
  return { address: address as Address, timestamp: Number(timestamp), signature: signature as Hex };
}
