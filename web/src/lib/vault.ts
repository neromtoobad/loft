// The vault is everything personal about a Loft: who you send to, the
// links you've made (including their claim keys, so you can re-share or
// cancel them from another phone), and your own notes. It is encrypted under
// the passkey's private key family before it leaves the device.
import type { Address, Hex } from "viem";
import { api } from "./api.ts";
import { decryptWith, encryptWith, vaultAad } from "./crypto.ts";
import type { Session } from "./keys.ts";

export type Contact = {
  name: string;
  address: Address;
  handle?: string | null;
  inboxKey?: Hex | null;
  character?: string | null;
};

export type SentItem = {
  kind: "direct" | "link";
  to: string; // contact name or "a link"
  toAddress?: Address;
  amount: string; // AUSD base units
  note?: string;
  txHash: Hex;
  at: number;
  claimSecret?: Hex; // links only
  claimKey?: Address;
};

export type ReceivedItem = { from: string; fromAddress?: Address; amount: string; note?: string; txHash: Hex; at: number };

export type VaultData = {
  v: 1;
  name: string;
  handle: string | null;
  /** Your creature (web/public/cast). Also published on your profile. */
  character?: string | null;
  contacts: Contact[];
  sent: SentItem[];
  received: ReceivedItem[];
};

export function emptyVault(name: string, character: string | null = null): VaultData {
  return { v: 1, name, handle: null, character, contacts: [], sent: [], received: [] };
}

export async function loadVault(session: Session): Promise<{ data: VaultData | null; version: number }> {
  if (!session.privateKeys) throw new Error("vault is locked");
  const { blob, version } = await api.getVault(session.account);
  if (!blob) return { data: null, version };
  const json = await decryptWith(session.privateKeys.vaultKey, blob, vaultAad(session.account.address));
  return { data: JSON.parse(json) as VaultData, version };
}

export async function saveVault(session: Session, data: VaultData, version: number): Promise<number> {
  if (!session.privateKeys) throw new Error("vault is locked");
  const blob = await encryptWith(session.privateKeys.vaultKey, JSON.stringify(data), vaultAad(session.account.address));
  const res = await api.putVault(session.account, blob, version);
  return res.version;
}

export function upsertContact(data: VaultData, contact: Contact): VaultData {
  const others = data.contacts.filter((c) => c.address.toLowerCase() !== contact.address.toLowerCase());
  return { ...data, contacts: [contact, ...others] };
}
