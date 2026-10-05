// One passkey, two unrelated key families.
//
// Mera evaluates the passkey's PRF with the ACCOUNT salt; that output becomes
// the wallet key. Loft's WebAuthn client asks the same ceremony for a
// second PRF evaluation with the PRIVATE salt, which becomes the vault key and
// the inbox key. The two outputs are independent: knowing the wallet key says
// nothing about the vault, and neither is ever stored.
import {
  type WebAuthnClient,
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { type Hex, type LocalAccount, bytesToHex } from "viem";

export const SALTS = {
  account: sha256(utf8ToBytes("loft.account.v1")),
  private: sha256(utf8ToBytes("loft.private.v1")),
};

const RP = { id: location.hostname, name: "Loft" };
const HINT_KEY = "loft.passkey";

// ------------------------------------------------------ dual-salt client

let lastSecond: Uint8Array | undefined;

function prfResults(credential: PublicKeyCredential) {
  const prf = (credential.getClientExtensionResults() as any).prf as
    | { enabled?: boolean; results?: { first?: BufferSource; second?: BufferSource } }
    | undefined;
  const bytes = (b?: BufferSource) => {
    if (!b) return undefined;
    if (b instanceof ArrayBuffer) return new Uint8Array(b.slice(0));
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  return { enabled: prf?.enabled === true, first: bytes(prf?.results?.first), second: bytes(prf?.results?.second) };
}

const dualSaltClient: WebAuthnClient = {
  async createCredential(req) {
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: req.rp,
        user: req.user,
        challenge: req.challenge,
        pubKeyCredParams: req.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
        attestation: req.attestation,
        authenticatorSelection: {
          residentKey: req.residentKey,
          requireResidentKey: true,
          userVerification: req.userVerification,
        },
        extensions: { prf: { eval: { first: req.prfSalt, second: SALTS.private } } } as any,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("passkey creation was cancelled");
    const prf = prfResults(credential);
    lastSecond = prf.second;
    const response = credential.response as AuthenticatorAttestationResponse;
    return {
      credentialId: new Uint8Array(credential.rawId),
      transports: response.getTransports?.(),
      prfEnabled: prf.enabled,
      ...(prf.first ? { prfOutput: prf.first } : {}),
    };
  },
  async getCredential(req) {
    const credential = (await navigator.credentials.get({
      publicKey: {
        rpId: req.rpId,
        challenge: req.challenge,
        userVerification: req.userVerification,
        extensions: { prf: { eval: { first: req.prfSalt, second: SALTS.private } } } as any,
        ...(req.allowCredential
          ? {
              allowCredentials: [
                {
                  id: req.allowCredential.credentialId,
                  type: "public-key" as const,
                  transports: req.allowCredential.transports as AuthenticatorTransport[] | undefined,
                },
              ],
            }
          : {}),
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("passkey request was cancelled");
    const prf = prfResults(credential);
    lastSecond = prf.second;
    return { credentialId: new Uint8Array(credential.rawId), ...(prf.first ? { prfOutput: prf.first } : {}) };
  },
};

// ---------------------------------------------------------- derivation

/** The account key, via a BIP-39 phrase so it can be exported to any wallet. */
function accountKeyFrom(prfOutput: Uint8Array) {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const key = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  seed.fill(0);
  if (!key.privateKey) throw new Error("could not derive account key");
  return { privateKey: key.privateKey, mnemonic };
}

export type PrivateKeys = {
  vaultKey: CryptoKey;
  inboxSecret: Uint8Array;
  inboxPublic: Hex;
};

async function privateKeysFrom(secondOutput: Uint8Array): Promise<PrivateKeys> {
  const vaultBytes = hkdf(sha256, secondOutput, undefined, utf8ToBytes("loft.vault.v1"), 32);
  const inboxSecret = hkdf(sha256, secondOutput, undefined, utf8ToBytes("loft.inbox.v1"), 32);
  const vaultKey = await crypto.subtle.importKey("raw", vaultBytes as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
  vaultBytes.fill(0);
  return { vaultKey, inboxSecret, inboxPublic: bytesToHex(x25519.getPublicKey(inboxSecret)) };
}

// -------------------------------------------------------------- session

export type Session = {
  account: LocalAccount;
  credentialId: string;
  privateKeys: PrivateKeys | undefined;
  startedAt: number;
  end(): void;
};

async function sessionFrom(credentialId: string, prfOutput: Uint8Array): Promise<Session> {
  const { privateKey } = accountKeyFrom(prfOutput);
  const signing = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  prfOutput.fill(0);
  const second = lastSecond;
  lastSecond = undefined;
  const privateKeys = second ? await privateKeysFrom(second) : undefined;
  second?.fill(0);
  return {
    account: toViemAccount(signing),
    credentialId,
    privateKeys,
    startedAt: Date.now(),
    end() {
      signing.end();
      privateKeys?.inboxSecret.fill(0);
    },
  };
}

export function passkeyHint(): { credentialId: string; name: string } | undefined {
  try {
    return JSON.parse(localStorage.getItem(HINT_KEY) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberHint(credentialId: string, name: string) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify({ credentialId, name }));
  } catch {
    // The hint only saves a tap; everything still works without it.
  }
}

/** Onboarding: one passkey creation is the whole signup. */
export async function createAccount(name: string): Promise<Session> {
  const created = await createPasskeyWithPrfOutput({
    rp: RP,
    user: { name, displayName: name },
    prfSalt: SALTS.account,
    webAuthnClient: dualSaltClient,
  });
  rememberHint(created.credentialId, name);
  return sessionFrom(created.credentialId, created.prfOutput);
}

/**
 * Unlocks with any Loft passkey on this device or a nearby phone. With no
 * hint (cleared storage, new device) the platform picker chooses, and the
 * identity rebuilds entirely from the passkey.
 */
export async function unlock(): Promise<Session> {
  const hint = passkeyHint();
  const result = await getPasskeyPrfOutput({
    rpId: RP.id,
    prfSalt: SALTS.account,
    webAuthnClient: dualSaltClient,
    ...(hint ? { credential: { credentialId: hint.credentialId } } : {}),
  });
  rememberHint(result.credentialId, hint?.name ?? "");
  return sessionFrom(result.credentialId, result.prfOutput);
}

/** Step-up: a fresh passkey check that must resolve to the same account. */
export async function confirmWithPasskey(session: Session): Promise<void> {
  const result = await getPasskeyPrfOutput({
    rpId: RP.id,
    prfSalt: SALTS.account,
    credential: { credentialId: session.credentialId },
  });
  const { privateKey } = accountKeyFrom(result.prfOutput);
  const check = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  const address = toViemAccount(check).address;
  check.end();
  if (address !== session.account.address) throw new Error("that passkey belongs to a different Loft");
}

/** The recovery phrase, shown only after a fresh passkey check. */
export async function exportPhrase(session: Session): Promise<string> {
  const result = await getPasskeyPrfOutput({
    rpId: RP.id,
    prfSalt: SALTS.account,
    credential: { credentialId: session.credentialId },
  });
  const { privateKey, mnemonic } = accountKeyFrom(result.prfOutput);
  privateKey.fill(0);
  return mnemonic;
}

/** Only for authenticators that ignore the second PRF salt: one extra prompt. */
export async function unlockPrivate(session: Session): Promise<PrivateKeys> {
  const result = await getPasskeyPrfOutput({
    rpId: RP.id,
    prfSalt: SALTS.private,
    credential: { credentialId: session.credentialId },
  });
  const keys = await privateKeysFrom(result.prfOutput);
  result.prfOutput.fill(0);
  session.privateKeys = keys;
  return keys;
}

// --------------------------------------------------------------- policy

/** Sends up to this much sign inside the session with no prompt. */
export const PROMPT_FREE_LIMIT_USD = 100;
/** The session ends after this long without activity... */
export const IDLE_LIMIT_MS = 10 * 60 * 1000;
/** ...or this long after the app goes to the background. */
export const HIDDEN_LIMIT_MS = 2 * 60 * 1000;
