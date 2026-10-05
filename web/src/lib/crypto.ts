// Encryption for the things Loft stores but must not be able to read:
// the vault (AES-GCM under the passkey's private key family), notes between
// people (X25519 sealed boxes to the recipient's inbox key), and notes inside
// claim links (AES-GCM under a key derived from the link's own secret).
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { type Hex, bytesToHex, concatBytes, hexToBytes } from "viem";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function aesKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptWith(key: CryptoKey, plaintext: string, aad?: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, ...(aad ? { additionalData: aad } : {}) }, key, enc.encode(plaintext)),
  );
  return b64(concatBytes([iv, ct]));
}

export async function decryptWith(key: CryptoKey, sealed: string, aad?: Uint8Array): Promise<string> {
  const bytes = unb64(sealed);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12), ...(aad ? { additionalData: aad } : {}) },
    key,
    bytes.slice(12),
  );
  return dec.decode(pt);
}

// --------------------------------------------------------- sealed boxes

/** Anyone can seal to an inbox key; only its owner can open. */
export async function seal(recipientInbox: Hex, plaintext: string): Promise<string> {
  const ephemeral = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeral);
  const recipient = hexToBytes(recipientInbox);
  const shared = x25519.getSharedSecret(ephemeral, recipient);
  const key = await aesKey(hkdf(sha256, shared, concatBytes([ephemeralPublic, recipient]), utf8ToBytes("loft.seal.v1"), 32));
  ephemeral.fill(0);
  return `${b64(ephemeralPublic)}.${await encryptWith(key, plaintext)}`;
}

export async function open(inboxSecret: Uint8Array, sealed: string): Promise<string> {
  const [ephemeralB64, body] = sealed.split(".");
  const ephemeralPublic = unb64(ephemeralB64);
  const shared = x25519.getSharedSecret(inboxSecret, ephemeralPublic);
  const recipient = x25519.getPublicKey(inboxSecret);
  const key = await aesKey(hkdf(sha256, shared, concatBytes([ephemeralPublic, recipient]), utf8ToBytes("loft.seal.v1"), 32));
  return decryptWith(key, body);
}

// ------------------------------------------------------------ link notes

async function linkNoteKey(claimSecret: Hex) {
  return aesKey(hkdf(sha256, hexToBytes(claimSecret), undefined, utf8ToBytes("loft.link-note.v1"), 32));
}

export async function sealForLink(claimSecret: Hex, plaintext: string) {
  return encryptWith(await linkNoteKey(claimSecret), plaintext);
}

export async function openFromLink(claimSecret: Hex, sealed: string) {
  return decryptWith(await linkNoteKey(claimSecret), sealed);
}

/** Vault ciphertext is bound to its owner's address, so blobs can't be swapped. */
export function vaultAad(address: string) {
  return enc.encode(`loft.vault:${address.toLowerCase()}`);
}

export { bytesToHex };
