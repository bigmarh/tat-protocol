# Glossary

## Protocol terms

| Term | Definition |
|------|-----------|
| **TAT** | **Transferable Access Token** — a non-fungible token representing unique access rights (ticket, membership, badge) |
| **Fungible Token** | A token where units are interchangeable (like cash). A 10-unit token equals any other 10-unit token from the same issuer. |
| **Token Hash** | SHA-256 hash of the token payload. Used as the unique identifier for a token. |
| **JWT** | JSON Web Token — the serialization format for TAT Protocol tokens: `header.payload.signature` |
| **SetID** | Identifier that groups related fungible tokens (e.g., `"USD"`, `"loyalty-points"`) |
| **Denomination** | The allowed token amounts a Forge will mint (e.g., `[1, 5, 10, 20, 50, 100]`) |
| **Derived Token** | A token created from a parent token, carrying access control rules for delegation |

## Component terms

| Term | Definition |
|------|-----------|
| **Forge** | The issuer runtime — mints, transfers, burns, and verifies tokens. Tracks spent tokens to prevent double-spending. |
| **Pocket** | The holder runtime — stores tokens, tracks balances, builds transfer transactions. |
| **Gate** | The verifier runtime — validates tokens at entry points, manages access policies. |
| **Booth** | The commerce runtime — manages catalogs, invoices, payments, and receipts. |
| **NWPC** | **Nostr Wrapped Procedure Call** — encrypted JSON-RPC transport over Nostr relays. |
| **TDK** | **TAT Developer Kit** — the unified SDK package that bundles all protocol packages. |

## Security & crypto terms

| Term | Definition |
|------|-----------|
| **Schnorr** | Digital signature algorithm used by TAT Protocol (secp256k1 curve). |
| **P2PK Lock** | Pay-to-Public-Key — a lock that requires proving ownership of a specific private key to spend the token. |
| **HTLC** | **Hash Time-Locked Contract** — a lock requiring a secret preimage. Used for atomic swaps between different Forges. |
| **TimeLock** | A constraint that prevents spending a token before a specified timestamp. |
| **NIP-44** | Nostr encryption standard using XChaCha20-Poly1305 with HKDF. Used for all NWPC message encryption. |
| **NIP-59** | Nostr gift wrap standard — wraps encrypted messages to hide the true sender from relay operators. |
| **Gift Wrap** | The NIP-59 pattern: encrypt content, then wrap in an outer event signed by an ephemeral key. |
| **Signer** | Abstraction for key-backed signing and encryption operations. |
| **KeySigner** | Server-side signer using direct secret key material. |
| **NIP-07 Signer** | Browser extension signer — private keys stay in the extension (NostrPass, Alby, nos2x). |

## Nostr terms

| Term | Definition |
|------|-----------|
| **Relay** | A Nostr server that stores and forwards events. TAT Protocol uses relays as a message bus. |
| **Event** | A signed data structure in Nostr with `id`, `pubkey`, `kind`, `content`, `tags`, `sig`. |
| **Kind** | The type identifier for a Nostr event. TAT Protocol uses kind 1059 (gift wrap). |
| **NDK** | Nostr Development Kit — the library TAT Protocol uses for Nostr connectivity. |
