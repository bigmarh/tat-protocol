# What is TAT Protocol?

**TAT** stands for **Transferable Access Token**. TAT Protocol is an open, decentralized protocol for issuing, transferring, and validating tokens over [Nostr](https://github.com/nostr-protocol/nostr).

Think of it as **HTTP for tokens** — an open standard that anyone can implement, where the token issuer (not a blockchain) is the authority.

## What you can build

- **Digital currencies** — loyalty points, credits, prepaid balances
- **Event tickets** — concerts, conferences, meetups
- **Memberships** — subscriptions, access passes, VIP tiers
- **Digital collectibles** — unique assets with metadata
- **Access badges** — proof of attendance, proof of membership
- **Service credits** — API quotas, compute credits, storage allowances

## How it works

TAT Protocol has four core roles:

| Role | Component | Responsibility |
|------|-----------|----------------|
| **Issuer** | Forge | Mints tokens, validates transfers, tracks spent tokens |
| **Holder** | Pocket | Stores tokens, sends transfers, manages balances |
| **Verifier** | Gate | Validates tokens at entry points, controls access |
| **Merchant** | Booth | Manages catalogs, invoices, and payment flows |

Tokens are signed JWTs (JSON Web Tokens) using Schnorr signatures. All communication happens over Nostr relays using NWPC (Nostr Wrapped Procedure Call), which provides end-to-end encryption via NIP-44 and sealed sender privacy via NIP-59.

## Issuer authority model

Unlike blockchain tokens where network consensus determines validity, TAT Protocol uses an **issuer authority model**: the Forge (token issuer) is the sole authority over its tokens.

| | Blockchain tokens | TAT Protocol |
|---|---|---|
| **Authority** | Network consensus | Token issuer |
| **Finality** | Probabilistic | Immediate |
| **Infrastructure** | Blockchain nodes | Nostr relays |
| **Smart contracts** | On-chain code | Application logic |
| **Cost** | Gas fees | Relay costs (minimal) |
| **Scalability** | Limited by consensus | Limited by issuer capacity |

This is the right model for use cases where users **already trust a central authority** — loyalty programs, event ticketing, company credits, memberships. You trust your coffee shop to honor its loyalty points; you don't need a blockchain for that.

### Trade-offs

- Users must trust the issuer to honor tokens
- The issuer must be online to validate transfers
- No on-chain smart contracts (logic lives in your application)

## Why Nostr?

TAT Protocol uses Nostr as its transport layer because:

- **Decentralized** — no single server to depend on
- **Relay-agnostic** — works with any Nostr relay
- **Encrypted** — NIP-44 provides end-to-end encryption
- **Private** — NIP-59 gift wrap pattern hides sender metadata
- **Open** — anyone can run a relay or build a client

The protocol doesn't store tokens on relays. Relays are used only as a message bus for encrypted communication between Forges, Pockets, Gates, and Booths.

## Token types

TAT Protocol supports two token types:

### Fungible tokens
Interchangeable tokens with amounts — like digital cash. A 10-unit token is equivalent to any other 10-unit token from the same issuer.

```
Use cases: currencies, loyalty points, credits, balances
```

### TATs (Transferable Access Tokens)
Unique, non-fungible tokens with a `tokenID` — like tickets or passes. Each TAT is a distinct asset.

```
Use cases: event tickets, memberships, collectibles, access badges
```

## Next steps

- [Core Concepts](/learn/concepts) — token lifecycle, locks, privacy
- [Quickstart](/guides/quickstart) — mint your first tokens in 5 minutes
- [Architecture](/learn/architecture) — how the components fit together
