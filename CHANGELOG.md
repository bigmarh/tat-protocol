# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
