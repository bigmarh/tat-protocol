# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
