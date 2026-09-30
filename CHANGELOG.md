# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Pocket: only the issuer can tell a pocket a token is spent** — any key could gift-wrap `{ result: { spent, issuer } }` to a pocket and it deleted the named token; on the public feed, an `issuer` field in the content overrode the event's author, and the author's signature was assumed checked by the relay. Spent notices (DM results, `TOKEN_SPENT` error replies, and feed events) are now acted on only when signed by the token's issuer — the seal's sender for a DM, the locally `verifyEvent`-checked author for a feed event — and a claimed issuer that differs from the signer is ignored.
- **NWPC: no more 10-minute offline window** — server subscriptions always asked relays for the last ten minutes, so a forge that was down longer never saw the requests sent meanwhile; a Pocket's reconnect re-subscribed only its main key (single-use change keys went deaf), and its issuer spent feed was pinned to ten minutes and never reopened. `NWPCState.lastSeenAt` is now persisted for every peer and server; subscriptions resume from it less a 10-minute margin (capped at 7 days back; ten minutes on a first start), and reconnects and keepalive refreshes re-open **every** subscription. The Pocket's spent feeds resume from the same point and re-open on reconnect. The margin must grow to ≥ 2 days if gift-wrap timestamps are ever randomized. The resume point advances only to events whose handlers have finished, never past one still in flight, and not at all while a subscription is still receiving its stored-event backfill (relays send it newest first).
- **Storage: secrets encrypted at rest by default, and fail closed** — `NodeStore` encrypted only if `TAT_STORAGE_ENCRYPTION_KEY` was set (with an unsalted sha256 of it) and returned plaintext it found on disk even with a key; `BrowserStore` never encrypted; the forge copied its keys, and the Pocket its mnemonic and single-use keys, into whatever storage it had.
  - `NodeStore` and `BrowserStore` now encrypt by default with AES-256-GCM under a PBKDF2-SHA256 key (600k iterations, per-store salt) via WebCrypto (`enc:v2:`). Options `{ passphrase | key, allowPlaintext, kdfIterations }`; `NodeStore` still reads `TAT_STORAGE_ENCRYPTION_KEY`.
  - **Breaking:** constructing either without a key throws unless `{ allowPlaintext: true }`; an encrypting store throws `UnencryptedDataError` on a plaintext value. `migratePlaintext()` encrypts existing plaintext and old `enc:v1` values in place (`enc:v1` stays readable until then). `BrowserStore.migratePlaintext(keys)` and `EncryptedStorage.migratePlaintext(keys)` take the keys to migrate; localStorage is shared by the whole origin.
  - Each value is bound to its storage key (file name for `NodeStore`) as AES-GCM associated data, so a ciphertext copied to another key does not open. Rolling a key back to its own older ciphertext is not detected.
  - New `EncryptedStorage` (wrap any backend; it requires the deployment `salt`, shared by every replica, or `createSalt: true` for a single writer — the backend has no compare-and-set — and refuses to seal if the stored salt changes under it), `SecretBox`, and `StorageInterface.encryptsAtRest`.
  - Forge: keys from config are no longer copied into storage; a generated key is persisted only if `storage.encryptsAtRest` (override `allowPlaintextSecrets`).
  - Pocket: refuses storage that does not encrypt at rest — including a `config.storage` passed directly, which bypassed the old browser-only check — unless `allowInsecureStorage`. New `storagePassphrase`. The generated identity key is now saved before init continues.
- **Booth: purchases are shown only to the payer (A19)** — `booth.status` returned the purchased token and receipt to anyone who knew the invoice id, and `booth.pay` on a paid invoice returned the receipt to anyone. Invoices now record `paidBy` (the `booth.pay` sender, or the buyer for an externally confirmed payment); only that key gets the token and receipt. Others see only the status, and a repeated `booth.pay` from them gets "Invoice already paid". Invoices from before `paidBy` fall back to the receipt's buyer.
- **Booth: token payments are actually taken** — `booth.pay` checked that the submitted tokens were unspent and then marked the invoice paid, without consuming them: the buyer kept spendable tokens, and the same tokens paid any number of invoices. The booth (`BoothServerSpec` and `BoothAgent`) now submits a `transfer` of the tokens to its own key, signed with its own key, and marks the invoice paid only once the forge has committed it (asking `status {tx_id}` if the reply is lost). Tokens must be P2PK-locked to the booth; an overpayment is returned to the buyer as an explicit output; a second invoice paid with the same tokens fails as a double-spend. The price check now uses `price.amount × quantity`. New `Invoice.settlement` records the forge `txId` and the collected outputs.
- **Forge: change must be explicit, and the witness binds every output field** — the forge minted any remainder of a transfer as change locked to the request's submitter, which no witness covered; and the v1 spend digest bound only `to`/`amount`/`tokenID`, while the forge also reads `timeLock`. Now:
  - A fungible transfer's outputs must spend its inputs **exactly**; change is an explicit output (the Pocket already emits one).
  - NFT transfers now give each new token the output's signed `timeLock` (they copied the input's), and refuse an input that no output uses (it was left unspent and out of the tx id).
  - `spendAuthDigest` is **v2** (`TAT-P2PK-SPEND-v2`): binds `to`, `amount`, `tokenID`, `issuer`, `timeLock` in canonical order and throws on any other field. The forge refuses outputs with unbound fields or an `issuer` other than itself. New exports: `SPEND_OUT_FIELDS`, `unboundOutFields`, `spendAuthDigestV1`.
  - **Transition:** a v1 witness is still accepted until `ForgeConfig.acceptV1SpendDigestUntil` (unix seconds, default **2026-11-01T00:00Z**), and only when no output carries a `timeLock` — under those conditions v1 already binds everything. After the window it gets the new `UPGRADE_REQUIRED` (2010) error: "update your Pocket to spend".
- **Forge: legacy P2PK witness removed (closes C6)** — the forge no longer accepts a witness signed over the bare token hash, in any configuration. That witness is bound to no outputs, so anyone who observed it could redirect the input. `ForgeConfig.allowLegacyWitness` is removed. **Breaking:** pockets on an SDK older than 1.3.0 can no longer spend P2PK-locked tokens until they update.
- **Forge: authenticated burn** — `burn` required only a well-formed, unspent JWT: no witness and no issuer check, so anyone who had seen a token could destroy it, and tokens from other issuers were marked spent too. A burn now takes `{ token, witness }`, where `witness` is the lock key's signature over the new `burnAuthDigest(tokenHash)` (domain `TAT-P2PK-BURN-v1`, so transfer witnesses cannot be replayed as burns), and the token must be one this forge issued. Unlocked tokens cannot be burned. Burns commit through the ledger like transfers and reply with `{ tx_id, status: "committed" }`. **Migration:** callers that sent `burn { token }` now get UNAUTHORIZED; use the new `Pocket.burn(tokenJWT)`, which builds the witness with the lock key and drops the token once the burn commits. A retried burn (same token) is answered from the ledger as committed.
- **Token: lossless token hash v2 (A7)** — `token_hash` was `sha256(TextDecoder().decode(sha256(payload)))`: the raw digest was decoded as UTF-8, and every invalid byte sequence collapses to U+FFFD, so distinct digests shared a hash and no non-JS implementation could reproduce it. New tokens carry header `ver: "2.0.0"` and hash `"TAT-TOKEN-HASH-v2\n" + hex(sha256(payload))`. Tokens with `ver` 1.x (or none) still hash and verify under the v1 rule, so issued tokens and their spent-set entries are unaffected; transfers re-mint them as v2. A token's version cannot be relabelled without breaking its hash. New export `TOKEN_HASH_VERSION`. **Rollout:** a pocket on an older SDK rejects v2 tokens as corrupt, so a forge whose holders have not all updated should set `ForgeConfig.tokenHashVersion: "1.0.0"` (inputs of either version are always accepted) and switch to the default once they have.
- **Forge: a replay must match the transfer, not just its inputs** — a resubmission was answered from the committed record whenever its inputs matched, so a second, conflicting spend of the same token (another device, a second booth invoice) was told it had committed. Tx records now carry `outsHash` (`transferOutsHash`, over the same canonical outputs the v2 digest binds); only a resubmission with the same outputs is replayed, anything else gets `TOKEN_SPENT`. The booth additionally credits a settlement `txId` to exactly one invoice.
- **Forge: no value loss on delivery failure** — a transfer marked its inputs spent and then pushed each output with no copy kept, so a failed send (or a crash in between) destroyed the value; a mint reserved supply before a send that could fail, so a retry minted twice. Transfers and mints now commit spent inputs / supply, every output, and an outbox row per output as **one unit** before anything is sent. A failed send stays in the outbox and is retried with backoff (1 s doubling to 5 min, for 7 days); a resubmitted transfer (same inputs) or mint (same request id, or explicit `nonce`) is answered from the record instead of executing again.
  - New `status {tx_id}` forge method: the submitter gets every output, anyone else only outputs addressed to them. `tx_id` is `txIdForInputs(inputHashes)` for transfers (so a pocket can compute it after losing every reply) and `mintTxId(requester, nonce)` for mints; both are versioned (`TAT-TX-v1`, `TAT-MINT-v1`) — spec v2 ids will hash the whole tx body.
  - New `ForgeLedger` (`MemoryForgeLedger`, `SqliteForgeLedger`) and `ForgeConfig.ledger`. `SqliteForgeLedger` runs each commit in one `BEGIN IMMEDIATE` transaction over the spent set, supply, tx records and outbox. Without a ledger the forge keeps all of it in its state blob, written in one `setItem`. Tx records are kept ≥ 30 days (`txRecordRetentionDays`) and pruned hourly.
  - **Breaking (deployment):** with `NODE_ENV=production` a forge now refuses to start without a durable ledger unless `allowBlobState: true` is set. `spentSetStore`/`supplyStore` without a `ledger` are refused at `initialize()` (they cannot commit outputs with the spend).
  - `NWPCServer.sendResponse` now **rejects** on a publish error or when no relay acknowledges within `publishTimeoutMs` (default 10 s), instead of resolving either way. The courtesy ack `res.send` sends to the request sender is best-effort.
  - `NodeStore.setItem` writes to a temp file, fsyncs, and renames over the target, so a failed or interrupted write can no longer leave a torn value.
  - Pocket: `sendTx` asks `status` when a transfer's reply is lost — committed → stores its outputs and drops the inputs; otherwise keeps the inputs. New `Pocket.fetchTxStatus()`. Outputs in a reply or status answer are only stored if locked to a key the pocket holds.
- **NWPC: replies are accepted only from the key that was asked (A20)** — `NWPCPeer` matched a reply to its pending request by id alone and never checked the seal; the Pocket checked the seal but also matched by id alone. Anyone who learned or guessed a request id could answer it (e.g. tell a pocket its transfer committed, after which it deletes the inputs). Pending requests now record their recipient, and a reply resolves one only if it carries a verified seal from that key; any other reply is ignored and the request keeps waiting.
- **NWPC: tokenAuth payment mode spends the token before serving (A17)** — it checked `isTokenSpent`, ran the paid handler, and only then called `markTokenSpent`, swallowing its errors: concurrent requests shared one payment, and a failed mark left the token reusable. The token is now claimed before the handler runs — atomically via the new `trySpendToken` hook (e.g. `SpentSetStore.tryMarkSpent`), or with a check-then-mark serialized in the middleware over the legacy hooks — and a claim that fails refuses the request. A failed handler does not refund the token. Note this is the server's own spent set; the token is not consumed at its forge.
- **NWPC: per-request handler chains (A6)** — the router shared one `HandlerEngine` across requests and the engine read its chain lazily on each `next()`, so a middleware that awaited could resume into a concurrent request's route (e.g. a `transfer` request running `forge`'s mint handler past its auth gate). `HandlerEngine.execute` now takes the chain per call and captures it once; `addAll` is deprecated.
- **NWPC: `res.error` recipient** — the engine's `res.error` wrapper dropped a fourth-argument recipient, so errors addressed to a specific party went to the request sender instead.

## [1.3.0] - 2026-07-24

### Security
- **P2PK witness binding (C6)** — the P2PK unlock witness is now signed over `spendAuthDigest(inputTokenHash, outs)`, a domain-separated digest bound to the transfer's outputs, instead of the bare token hash. This closes a witness-replay theft vector where an observer of a pending transfer could reuse the witness to redirect the same input to a different recipient. New export: `spendAuthDigest` from `@tat-protocol/utils`.
  - **Migration-safe:** the forge accepts both the new bound witness and the legacy token-hash witness by default (`ForgeConfig.allowLegacyWitness`, default `true`), so wallets on an older SDK keep working during rollout. New wallets always produce the bound witness. Set `allowLegacyWitness: false` once all wallets are updated to fully close the vector (accepted legacy witnesses are logged so you can track migration).

## [1.2.0] - 2026-07-24

### Added
- `Pocket.exportRecoverySnapshot()` — sync export of mnemonic, tokens, single-use keys, and favorites for backup
- `Pocket.importTokens(tokens)` — import token JWTs from a backup; skips duplicates, returns `{ imported, failed, duplicates }`
- `Pocket.restoreKeyMaterial(snapshot)` — restore HD mnemonic and single-use keys from a backup snapshot (call before `importTokens`)
- `singleUseKeyNextIndex` field in `PocketState` — persisted HD index counter to prevent address collisions on restore
- `Pocket.createFungibleTransferTx()` — previously internal, now public for building transfer transactions without immediately sending them
- `NWPCBase.subscribe()` now accepts an optional `since` Unix timestamp (defaults to 10 minutes ago) to avoid replaying old events on reconnect
- `NWPCServer.sendResponse()` now awaits first-relay acknowledgement (with 3 s fallback) instead of fire-and-forget, preventing dropped responses on transfer flows
- NWPC relay keepalive — automatic ping/reconnect on idle connections for better resilience
- `NIP07Signer.sign()` now falls back to `window.nostr.signData()` (NostrPass Lite convention) after `signSchnorr` (nos2x convention)
- `BoothWebhookServer.dispatch()` — handle webhook requests without binding an HTTP listener (serverless/edge runtimes, tests)
- Dual ESM + CommonJS output across all packages (`dist` + `dist-cjs` with `require` export condition)

### Security
- **Forge: concurrent double-spend (C1)** — serialize the transfer/burn spent-set critical section with a per-forge lock so concurrent transfers of the same input can no longer both pass the spent-check
- **Forge: duplicate-input value inflation (C2)** — reject transactions that list the same input token more than once (previously double-counted the amount)
- **Forge: duplicate-tokenID NFT mint (C3)** — a `tokenID` can now be spent at most once per transfer (previously repeated outputs re-minted one NFT input)
- **Forge: restart replay (C4)** — load the persisted spent-set and replay bloom before subscribing to relays, closing a double-spend window on the on-connect event replay
- **timeLock enforcement (C5)** — compare `timeLock` in Unix seconds instead of `Date.now()` milliseconds; time-locked tokens were previously spendable immediately
- **Forge durability (H1)** — `await` the spent-set write before releasing signed tokens
- **Pocket: verify received tokens (H2)** — check token hash and issuer signature before storing, preventing spoofed balances and hash-key shadowing
- See `SECURITY_AUDIT_FINDINGS.md` for the full ranked audit, including documented follow-ups (witness binding, rate limiting, key-at-rest encryption, canonical serialization)

### Fixed
- `@tat-protocol/gate` now declares its `@tat-protocol/token` dependency (previously missing from the published package)
- `@tat-protocol/config` rebuilds no longer fail with TS5055 (`dist-cjs` output was picked up as compiler input)
- Forge: gate minting and reject non-finite amounts

## [1.1.1] - 2026-02-28

### Fixed
- Add `.js` extensions to all relative imports across all 13 packages for Node16/NodeNext ESM compatibility
- Update `tsconfig.base.json` to `module: NodeNext` / `moduleResolution: NodeNext` to enforce extensions at compile time
- Fix `tsconfig` paths mapping to use explicit `index.ts` suffix (required by NodeNext resolution)
- Add `moduleResolution: Node` override to `nwpc/tsconfig.cjs.json` (CJS + NodeNext is not valid)
- Export `NodeStore` directly from `storage/node.ts` alongside `Backend` alias
- Remove stale compiled build artifacts (`.js`/`.d.ts`) from `nwpc`, `token`, `signers`, `types` source directories
- Add jest `moduleNameMapper` to strip `.js` from relative imports so ts-jest resolves TypeScript sources correctly

## [1.1.0] - 2026-02-05

### Added
- Standardized NWPC error codes (1000/2000/3000 series)
- Token authentication middleware for NWPC servers
- NWPC introspection support for route metadata
- TATPaymentProvider for accepting TAT tokens in booth services
- Booth protocol alignment with spec (catalog, invoice, pay, status methods)
- NWPC dual ESM+CJS builds with `require` in package exports
- CommonJS usage example in NWPC README

### Changed
- Aligned booth types with protocol specification

## [1.0.2] - 2025-12-15

### Fixed
- Storage entrypoints for Node.js and browser environments
- Utils curves import path

## [1.0.0] - 2025-12-10

### Added
- Initial release of TAT Protocol SDK
- Core packages: token, forge, pocket, nwpc, storage, utils, hdkeys, signers, types, config
- Service packages: gate, booth
- Unified SDK package: tdk with factory helpers
- Fungible and non-fungible (TAT) token support
- HD key derivation (BIP-39/BIP-32)
- Encrypted RPC over Nostr (NWPC)
- Node.js and browser storage backends
- NIP-07 browser extension signer support
- Challenge-response access verification (Gate)
- Commerce and invoice flows (Booth)
