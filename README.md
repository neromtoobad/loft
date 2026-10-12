<img src="art/logo.png" alt="Loft: a pigeon courier perched on a loft roof" width="160" />

# Loft

**Send dollars home in one tap.** A pigeon loft is where homing pigeons fly home to, and Loft is where dollars land for family. It moves Agora dollars (AUSD) across borders on Monad. The sender and the person receiving need nothing but a phone: no seed phrase, no gas, no app store, and nobody holds their money for them.

Built for [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis), Track 02: Consumer Products & Payments.

> **Live on Monad mainnet:** https://loftmonad.xyz · escrow [`0xc2da029bd912516c2046fc928829f63749e6d275`](https://monadvision.com/address/0xc2da029bd912516c2046fc928829f63749e6d275). Unaudited: use small amounts.

**It's a web app.** There's no app store download: open https://loftmonad.xyz on a phone and add it to the Home Screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app, or the Install button Loft shows). It then opens full-screen like any app, and the same passkey signs in. On a computer, Loft shows a QR code to open it on your phone.

## The problem

Sending $50 from London or Houston to a mother in Lagos still means a remittance counter, a bank account on both ends, days of waiting, and fees that eat into small amounts. Crypto rails are fast, but they ask the person receiving to install a wallet, write down twelve words, and buy gas before she can touch the money. Most people's mothers will not do that, and they shouldn't have to.

## How it works

**Onboarding is one passkey.** "Create my Loft" runs a single WebAuthn ceremony. [Mera](https://mera.category.xyz) turns the passkey's PRF output into the account key. Nothing is stored, on the phone or on our server. Every unlock rebuilds the account from the passkey, so clearing the browser or switching phones loses nothing.

**Sending to someone new is a link.** The sender signs once and gets a link to share on WhatsApp. The recipient opens it and sees who sent how much, plus a private note. One tap with her face or fingerprint creates her Loft and the dollars land. She never needs MON.

**Sending to someone you know is instant.** AUSD supports EIP-3009, so every payment is a signature that our relayer submits. It passes through `LoftEscrow.send`, which emits a `Sent` event whose `ref` is the hash of the encrypted note, so the recipient can check the note against the chain. The money settles on Monad in under a second.

**Standing orders.** "$50 to Mum every Friday", or "keep Mum's balance at $100". The sender prepays and the escrow holds the funds. A Chainlink CRE workflow releases each payment when it's due and writes the naira rate it used on-chain, so every receipt says what the money was worth where it landed.

**Ask the family.** The person at home makes the request: "School fees, $30". It becomes a link anyone abroad can pay in one tap, and the requester sees who paid. Paying is an ordinary direct send that carries the request's id.

**Family pots.** Siblings in London, Houston and Toronto chip in for one person: Mum's rent, a school term, a hospital bill. The pot lives in the escrow. It pays out the moment it reaches its target, or Chainlink CRE releases whatever was raised on the deadline. The organizer signs the pot's terms, so nobody can open one in their name, and every contribution is a gasless EIP-3009 authorization with its own nonce.

**Send when the rate is right.** "Send Mum $50 when $1 buys ₦1,450." The order is prepaid with a rate floor; the CRE workflow's report carries the DON-agreed naira rate, and the escrow only pays once that rate reaches the floor. Below it, the order simply stays due.

**Postcards.** When money lands, the sender can share an airmail postcard: the recipient's creature on the stamp, a postmark with the real confirmation time, the amount and the note. It's drawn on a canvas in the browser and shared as an image to WhatsApp.

**Plain-language and voice requests.** Type or say "send Mum fifty thousand naira" and Claude turns it into a transfer you confirm; spoken requests are read back aloud before the review screen. Speech is recognised in the browser (Web Speech). The model sees the sentence and your contacts' nicknames, never addresses or balances, and nothing moves without a tap. The server uses Claude when `ANTHROPIC_API_KEY` is set, Kimi when `KIMI_API_KEY` is set, and a small rule-based parser for the common phrasings otherwise.

**Add money from any chain.** Most people abroad hold USDC on Base or Arbitrum, or USDT on Tron, not AUSD on Monad. Pick the chain and amount; Aurora Intents quotes it live and opens a deposit address there. When the swap lands, USDC arrives on your Loft address on Monad, and `LoftConvert` turns it into AUSD in the same tap: one EIP-3009 signature for the USDC, swapped through Trader Joe's AUSD/USDC Liquidity Book pair, AUSD straight back to you, no gas. The signed nonce commits to the minimum AUSD out, so the relayer can't loosen the price.

**The corridor page.** `/corridor` is public: total moved London → Lagos, payments, median tap-to-confirmed time, fees saved against the World Bank's 8.78% average cost of sending $200 to Sub-Saharan Africa, a 30-day chart split between money sent home and money arriving from other chains, and a live feed linked to the explorer. It reads from the Envio indexer; without it, the server follows the same events on chain.

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

- `contracts/LoftConvert.sol` turns USDC on a Loft address into AUSD in one relayed transaction (any-chain top-ups). Mainnet: [`0x0cba9430ae1fc9e4389f9e80a1470e0b178fda34`](https://monadvision.com/address/0x0cba9430ae1fc9e4389f9e80a1470e0b178fda34). Tested on a mainnet fork against Circle's USDC and the live pair.
- `contracts/LoftEscrow.sol` holds AUSD for claim links and prepaid standing orders. Every deposit uses `receiveWithAuthorization`, and the signed EIP-3009 nonce is derived from the deposit's parameters. The relayer can submit a deposit but cannot change who it's for, when it expires, or how it pays out. A claim is signed by the link's own key and names the recipient, so a front-runner can't redirect it.
- `server/` holds the relayer (simulates before sending, pads gas because Monad bills the gas limit), the ciphertext vault store, profiles (handle and inbox public key), the naira rate as a median of public sources, and the intent parser (Claude or Kimi, with a rules fallback). It also serves the web app.
- `web/` is a React PWA: onboarding, send, claim, standing orders and settings.
- `cre/` is the Chainlink CRE workflow that runs standing orders.
- `indexer/` is the Envio HyperIndex project behind Activity and receipts.
- `shared/` has network config and the signing helpers, used by both the web app and the tests.

## Sponsor integrations

| Sponsor | What Loft uses it for | Status |
|---|---|---|
| **Agora (AUSD)** | The currency. EIP-3009 transfers make every flow gasless; `receiveWithAuthorization` funds the escrow. | Working (fork of testnet) |
| **Mera** | The entire account layer; the dual-salt client adds a second, non-wallet key family. | Working |
| **Chainlink CRE** | `cre/loft-orders`: cron trigger, EVM reads of due orders and due pots, naira rate from three public sources (median per node, then across the DON, out-of-band values dropped), one report to `onReport` that pays every due order (holding back rate-triggered ones until the agreed rate reaches their floor) and releases pots past their deadline. | Workflow built, unit-tested with the SDK mocks, compiles to WASM; the escrow accepts the production and simulation forwarders |
| **Envio** | `indexer/`: HyperIndex over every LoftEscrow and LoftConvert event. Payments of each kind, link lifecycles, standing orders with payout history and naira value, pots, cross-chain top-ups, per-day and all-time totals. Powers Activity and the corridor page. | Handlers built and tested; hosted deployment pending |
| **Aurora Intents** | "Add money" from any chain: USDC on Base, Arbitrum, Ethereum, Optimism, Polygon, Solana or USDT on Tron arrives as USDC on Monad, then AUSD via `LoftConvert`. Quote, deposit address and status from the Intents API. | Built; uses Aurora's API when `AURORA_APP_KEY` is set, the public 1Click API it builds on otherwise |
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
- Deploy the CRE workflow and host the Envio indexer
- Android wrapper (Trusted Web Activity)
- Cash-out routes to naira

Unaudited software handling real money. Use small amounts.

## Built with AI

In line with the Metropolis rules (§4.1.4): Loft was written with **Claude Code** (Anthropic) as a coding assistant, working alongside the author, who directed the product and reviewed the work.

## License

MIT
