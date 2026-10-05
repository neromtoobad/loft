# Loft

**Send dollars home in one tap.** A pigeon loft is where homing pigeons fly home to, and Loft is where dollars land for family. It moves Agora dollars (AUSD) across borders on Monad. The sender and the person receiving need nothing but a phone: no seed phrase, no gas, no app store, and nobody holds their money for them.

Built for [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis), Track 02: Consumer Products & Payments.

> Status: working end to end on a local fork of Monad testnet against Agora's real AUSD contract. Mainnet deployment is next. See [Status](#status).

## The problem

Sending $50 from London or Houston to a mother in Lagos still means a remittance counter, a bank account on both ends, days of waiting, and fees that eat into small amounts. Crypto rails are fast, but they ask the person receiving to install a wallet, write down twelve words, and buy gas before she can touch the money. Most people's mothers will not do that, and they shouldn't have to.

## How it works

**Onboarding is one passkey.** "Create my Loft" runs a single WebAuthn ceremony. [Mera](https://mera.category.xyz) turns the passkey's PRF output into the account key. Nothing is stored, on the phone or on our server. Every unlock rebuilds the account from the passkey, so clearing the browser or switching phones loses nothing.

**Sending to someone new is a link.** The sender signs once and gets a link to share on WhatsApp. The recipient opens it and sees who sent how much, plus a private note. One tap with her face or fingerprint creates her Loft and the dollars land. She never needs MON.

**Sending to someone you know is instant.** AUSD supports EIP-3009, so every payment is a signature that our relayer submits. It passes through `LoftEscrow.send`, which emits a `Sent` event whose `ref` is the hash of the encrypted note, so the recipient can check the note against the chain. The money settles on Monad in under a second.

**Standing orders.** "$50 to Mum every Friday", or "keep Mum's balance at $100". The sender prepays and the escrow holds the funds. A Chainlink CRE workflow releases each payment when it's due and writes the naira rate it used on-chain, so every receipt says what the money was worth where it landed.

**Plain-language requests.** Type "send mum ₦50k every Friday" and Kimi turns it into a transfer you confirm. Kimi sees the sentence and your contacts' nicknames, never addresses or balances, and nothing moves without a tap.

## One passkey, many keys

Loft's WebAuthn client asks each passkey ceremony for **two independent PRF evaluations**:

| PRF salt | Becomes | Used for |
|---|---|---|
| `loft.account.v1` | secp256k1 account key (via BIP-39/BIP-32, so it can be exported to any wallet) | Signing transfers and API requests |
| `loft.private.v1` | AES-256-GCM vault key and an X25519 inbox key (HKDF-separated) | Encrypting your contacts, sent links and notes; receiving sealed notes from other people |

The two outputs are unrelated. Knowing the wallet key reveals nothing about the vault, and the server stores only ciphertext. Links carry a third secret: a one-off claim key in the URL fragment, which browsers never send to a server. It also encrypts the note inside the link.

**Session policy** (see `web/src/lib/keys.ts`):
- One prompt unlocks both key families.
- Sends up to $100 sign inside the session with no prompt. Anything larger asks for the passkey again and checks that it's the same account.
- The session ends after 10 minutes idle or 2 minutes in the background, and the key material is zeroed.
- Showing the recovery phrase always requires a fresh passkey check.

## Architecture

```
 phone (PWA)                         Loft server                     Monad
 ─────────────                       ───────────                     ─────
 Mera passkey ──► account key ──► signs EIP-3009 / EIP-191 ──► relayer ──► AUSD (Agora)
             └──► private keys ─► vault ciphertext ────────► SQLite     │
                                  sealed notes ────────────► SQLite     ├─► LoftEscrow
                                                                        │     links: createLink / claim / refund
 Chainlink CRE workflow ── cron ─► read dueOrders ─► FX rate (HTTP, consensus) ─► onReport
                                                                        │     orders: createOrder / onReport / closeOrder
```

- `contracts/LoftEscrow.sol` holds AUSD for claim links and prepaid standing orders. Every deposit uses `receiveWithAuthorization`, and the signed EIP-3009 nonce is derived from the deposit's parameters. The relayer can submit a deposit but cannot change who it's for, when it expires, or how it pays out. A claim is signed by the link's own key and names the recipient, so a front-runner can't redirect it.
- `server/` holds the relayer (simulates before sending, pads gas because Monad bills the gas limit), the ciphertext vault store, profiles (handle and inbox public key), the naira rate as a median of public sources, and the Kimi intent parser. It also serves the web app.
- `web/` is a React PWA: onboarding, send, claim, standing orders and settings.
- `cre/` is the Chainlink CRE workflow that runs standing orders.
- `indexer/` is the Envio HyperIndex project behind Activity and receipts.
- `shared/` has network config and the signing helpers, used by both the web app and the tests.

## Sponsor integrations

| Sponsor | What Loft uses it for | Status |
|---|---|---|
| **Agora (AUSD)** | The currency. EIP-3009 transfers make every flow gasless; `receiveWithAuthorization` funds the escrow. | Working (fork of testnet) |
| **Mera** | The entire account layer; the dual-salt client adds a second, non-wallet key family. | Working |
| **Chainlink CRE** | `cre/loft-orders`: cron trigger, EVM read of due orders, naira rate from three public sources (median per node, then across the DON, out-of-band values dropped), one report to `onReport` that pays every due order. | Workflow built, unit-tested with the SDK mocks, compiles to WASM; the escrow accepts the production and simulation forwarders |
| **Kimi** | Natural-language send and schedule requests. | Built, needs an API key |
| **Envio** | `indexer/`: HyperIndex over every LoftEscrow event. Payments of each kind, link lifecycles, standing orders with payout history and naira value, per-day and all-time totals. Powers the Activity screen. | Handlers built and tested; hosted deployment pending |
| **Aurora Intents** | "Add money" from any chain: USDC from Base, Arbitrum and others arrives as AUSD. | Planned |
| **Monad** | ~400 ms blocks make a claim feel instant; the P256 precompile and EIP-7702 are live but not needed for this design. | — |

## Run it locally

Requires Node 24 (the server uses the built-in `node:sqlite`).

```bash
npm install
npm run compile            # contracts -> out/ and shared/escrow-abi.json
npm test                   # escrow, client signing and activity tests on a Monad testnet fork
(cd cre && bun install && bun test && bun run compile)   # CRE workflow tests, then WASM
(cd indexer && npm install && npx envio codegen && npm test)   # Envio handler tests
npm run build              # web app -> web/dist
```

End to end against a local fork of Monad testnet (real AUSD, a fresh escrow, a funded relayer):

```bash
cp .env.example .env       # set RELAYER_PRIVATE_KEY
npx tsx scripts/local-chain.ts
# prints the escrow address; RPC on :8545, test-dollar faucet on :8546
NETWORK=testnet RPC_URL=http://localhost:8545 ESCROW_ADDRESS=0x... npx tsx server/index.ts
curl -X POST localhost:8546/faucet -d '{"address":"0x...","usd":250}'
```

Passkeys with PRF need iCloud Keychain on iOS 18+, Google Password Manager on Android, or 1Password. A desktop Chrome profile passkey won't work.

## Status

Done and tested:
- Escrow contract: direct sends, links, claims, refunds, fixed and top-up standing orders, CRE report entry point. Covered by tests against real AUSD on a fork.
- Chainlink CRE workflow and Envio indexer, each with their own tests.
- Client signing helpers, verified against the contract's own nonce and digest functions.
- Web app: onboarding, unlock (including with no local state), send by link or directly, claim, encrypted notes and vault, re-share or take back a link, standing orders.

Next:
- Mainnet deployment and a public URL
- Deploy the CRE workflow and host the Envio indexer
- Aurora Intents deposits
- Android wrapper (Trusted Web Activity)
- Cash-out routes to naira

Unaudited software handling real money. Use small amounts.

## Built with AI

In line with the Metropolis rules (§4.1.4): Loft was written with **Claude Code** (Anthropic) as a coding assistant, working alongside the author, who directed the product and reviewed the work.

## License

MIT
