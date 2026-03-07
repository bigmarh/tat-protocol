# Architecture

TAT Protocol organizes its components into four planes, each handling a distinct responsibility.

## Four-plane model

```
┌─────────────────────────────────────────────────────┐
│                   SERVICE PLANE                      │
│              Gate            Booth                    │
│         (verification)   (commerce)                  │
├─────────────────────────────────────────────────────┤
│                  TRANSPORT PLANE                     │
│              NWPC           Signers                   │
│         (messaging)    (key management)              │
├─────────────────────────────────────────────────────┤
│      ISSUER PLANE          │     HOLDER PLANE        │
│    Forge      Token        │   Pocket     Storage    │
│  (minting)  (data model)   │  (wallet)  (persistence)│
└─────────────────────────────────────────────────────┘
```

## Components

### Issuer Plane

| Component | Role | Key classes |
|-----------|------|-------------|
| **Forge** | Mints tokens, validates transfers, tracks spent tokens, enforces supply | `FungibleForge`, `TATForge`, `ForgeBase` |
| **Token** | Token data model — JWT format, signing, validation, lock mechanisms | `Token`, `TokenType` |

### Holder Plane

| Component | Role | Key classes |
|-----------|------|-------------|
| **Pocket** | Stores tokens, manages balances, builds transfer transactions | `Pocket` |
| **Storage** | Persistence abstraction for state data | `NodeStore`, `BrowserStore` |

### Transport Plane

| Component | Role | Key classes |
|-----------|------|-------------|
| **NWPC** | Encrypted JSON-RPC over Nostr relays, routing, middleware | `NWPCServer`, `NWPCPeer`, `NWPCRouter` |
| **Signers** | Key management abstraction for signing and encryption | `KeySigner`, `NIP07Signer` |

### Service Plane

| Component | Role | Key classes |
|-----------|------|-------------|
| **Gate** | Token verification at entry points, access policies, analytics | `GateBase`, `GateServerSpec` |
| **Booth** | Commerce flows — catalog, invoicing, payment, receipts | `BoothBase`, `BoothServer`, `TATPaymentProvider` |

## How components communicate

All communication between components uses NWPC over Nostr relays:

1. **Pocket → Forge** — transfer requests, burn requests
2. **Forge → Pocket** — minted tokens, change tokens, responses
3. **Pocket → Gate** — token presentation for verification
4. **Pocket → Booth** — catalog browsing, order creation, payment
5. **Booth → Forge** — fulfillment requests (mint tokens for buyers)

Every message is encrypted with NIP-44 and wrapped with NIP-59 for sender privacy. Relay operators can see that events are being exchanged, but cannot read the content or identify the true sender.

## Interface naming conventions

| Pattern | Meaning | Example |
|---------|---------|---------|
| `*ServerSpec` | Strict protocol handler with NWPC integration | `GateServerSpec`, `BoothServerSpec` |
| `*Base` | Abstract base class for extension | `ForgeBase`, `GateBase`, `BoothBase` |
| `*Provider` | Pluggable dependency | `TATPaymentProvider`, `PaymentProvider` |
| `*Config` | Configuration object | `ForgeConfig`, `PocketConfig` |
| `*State` | Runtime state | `ForgeState`, `PocketState`, `GateState` |

## Runtime role terminology

| Role | Component | Actor |
|------|-----------|-------|
| **Issuer** | Forge | Entity that mints and validates tokens |
| **Holder** | Pocket | Entity that owns and spends tokens |
| **Verifier** | Gate | Entity that checks tokens for access |
| **Merchant** | Booth | Entity that sells goods/services for tokens |
