# Package Overview

TAT Protocol is published as a family of focused packages. Install the unified SDK for the fastest setup, or pick individual packages for fine-grained control.

## Unified SDK (recommended)

```bash
npm install @tat-protocol/tdk
```

The [TDK](/sdk/tdk) re-exports every package below plus convenience factory functions. This is the recommended starting point for most applications.

## Package map

### Issuer Plane

| Package | Description |
|---------|-------------|
| [@tat-protocol/forge](/sdk/forge) | Mint, transfer, and burn tokens. Fungible and TAT (non-fungible) forges. |
| [@tat-protocol/token](/sdk/token) | Token model, JWT serialization, validation, and lock mechanisms. |

### Holder Plane

| Package | Description |
|---------|-------------|
| [@tat-protocol/pocket](/sdk/pocket) | Wallet that stores, indexes, and transfers tokens. |
| [@tat-protocol/storage](/sdk/storage) | Pluggable persistence — `NodeStore` for servers, `BrowserStore` for browsers. |

### Transport Plane

| Package | Description |
|---------|-------------|
| [@tat-protocol/nwpc](/sdk/nwpc) | Encrypted JSON-RPC over Nostr relays with routing, middleware, and introspection. |
| [@tat-protocol/signers](/sdk/signers) | `KeySigner` (server) and `NIP07Signer` (browser extension) adapters. |

### Service Plane

| Package | Description |
|---------|-------------|
| [@tat-protocol/gate](/sdk/gate) | Token verification and access control at entry points. |
| [@tat-protocol/booth](/sdk/booth) | Commerce runtime — catalogs, invoicing, payments, receipts. |

### Supporting

| Package | Description |
|---------|-------------|
| [@tat-protocol/hdkeys](/sdk/hdkeys) | BIP32/BIP39 HD key derivation for deterministic key management. |
| [@tat-protocol/types](/sdk/types) | Shared `Signer` interface and Nostr event types. |
| [@tat-protocol/utils](/sdk/utils) | Crypto helpers, Nostr encryption (Wrap/Unwrap), logging, Bloom filter. |
| [@tat-protocol/config](/sdk/config) | Protocol version and default relay configuration. |

## Choosing packages by role

| Role | Recommended packages |
|------|---------------------|
| **App developer** | `@tat-protocol/tdk` (includes everything) |
| **Token issuer** | `forge` + `token` + `storage` + `signers` + `nwpc` |
| **Wallet developer** | `pocket` + `storage` + `signers` + `nwpc` |
| **Access verifier** | `gate` + `token` + `signers` + `nwpc` |
| **Commerce operator** | `booth` + `token` + `signers` + `nwpc` |
