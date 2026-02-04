# TAT Protocol Extensions

**Version:** 0.1.0-draft  
**Date:** 2024-12-30  
**Status:** Draft Proposal

---

## Abstract

This document specifies extensions to the TAT Protocol that enable decentralized commerce and access verification. These extensions introduce:

1. **Agents** — Protocol participants as standard Nostr accounts
2. **NWPC** — Nostr Wrapped Procedure Calls (JSON-RPC over DMs)
3. **Booth Protocol** — Standardized TAT purchasing
4. **Gate Protocol** — Standardized access verification
5. **HTLC Protocol** — Hash Time-Locked Contracts for trustless atomic swaps
6. **Forge Authorization** — Delegated sales authority to third parties

These extensions build on the core TAT Protocol (Forge, Pocket, Token) and maintain full backward compatibility.

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Agents](#2-agents)
3. [NWPC](#3-nwpc)
4. [Booth Protocol](#4-booth-protocol)
5. [Gate Protocol](#5-gate-protocol)
6. [HTLC Protocol](#6-htlc-protocol)
7. [Forge Authorization Protocol](#7-forge-authorization-protocol)
8. [Discovery Events](#8-discovery-events)
9. [Security Considerations](#9-security-considerations)
10. [Reference Implementation Notes](#10-reference-implementation-notes)

---

## 1. Motivation

The core TAT Protocol defines how tokens are created, transferred, and validated. Real-world applications require additional standardized protocols for:

- **Commerce**: How do users purchase TATs with various payment methods?
- **Access Control**: How do applications verify TAT ownership securely?
- **Trustless Exchange**: How do parties exchange value without trusting each other?
- **Delegation**: How can Forges authorize third parties to sell on their behalf?
- **Discovery**: How do users find TATs and services in the ecosystem?

These extensions address each requirement with minimal, composable protocols.

---

## 2. Agents

### 2.1 Overview

**Agents** are the participants in TAT Protocol. An Agent is simply a Nostr account that responds to NWPC messages.

**Agents communicate through NWPC** (Nostr Wrapped Procedure Calls). NWPC is the standardized communication protocol that enables Agents to send and receive JSON-RPC messages over encrypted Nostr direct messages.

There are four types of Agents:

| Agent Type | Role |
|------------|------|
| **Forge** | Mints and manages tokens |
| **Pocket** | Holds and spends tokens (user wallet) |
| **Booth** | Sells TATs, handles payments |
| **Gate** | Verifies TAT ownership for access control |

### 2.2 Agents Are Nostr Accounts

Every Agent:
- Has a Nostr keypair (pubkey + secret key)
- Publishes a standard Kind 0 profile
- **Communicates via NWPC** (encrypted DMs using JSON-RPC)
- Can be discovered via standard Nostr search/NIP-05

All inter-Agent communication uses NWPC. For example:
- Pocket → Booth: `booth.catalog`, `booth.invoice`, `booth.pay`
- Pocket → Gate: `gate.challenge`, `gate.verify`
- Booth → Forge: `forge.mint_request`

### 2.3 Agent Profiles (Kind 0)

Agents use **standard Nostr profiles** (Kind 0) with an `agent` field to identify their capabilities.

```typescript
{
  kind: 0,
  pubkey: "<agent-pubkey>",
  content: JSON.stringify({
    // Standard Nostr profile fields
    name: "Alice's Forge",
    about: "Premium content access tokens",
    picture: "https://example.com/avatar.jpg",
    website: "https://alice.com",
    nip05: "forge@alice.com",
    lud16: "alice@getalby.com",
    
    // Agent field
    agent: {
      type: "forge",                     // "forge" | "booth" | "gate"
      version: "1.0.0",
      methods: [                         // Supported NWPC methods
        "booth.catalog",
        "booth.invoice",
        "booth.pay"
      ],
      relays: [                          // Preferred relays for NWPC
        "wss://relay.damus.io",
        "wss://relay.nostr.band"
      ]
    }
  }),
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 2.4 Benefits of Standard Profiles

1. **Universal Discovery**: Agents appear in any Nostr client
2. **NIP-05 Verification**: `forge@alice.com` proves ownership
3. **Existing Social Graph**: Follow, share, recommend Agents
4. **No New Infrastructure**: Uses existing Nostr ecosystem

### 2.5 Agent Types

All four agent types (Forge, Pocket, Booth, Gate) are Agents—Nostr accounts that participate in the protocol.

#### Forge Agent
```typescript
agent: {
  type: "forge",
  methods: ["booth.catalog", "booth.invoice", "booth.pay", "forge.mint_request"],
  acceptedPayments: ["lightning"]
}
```

#### Pocket Agent
```typescript
agent: {
  type: "pocket",
  methods: []  // Pocket typically doesn't expose NWPC methods, but is still an Agent
}
```

#### Booth Agent (Third-Party Seller)
```typescript
agent: {
  type: "booth",
  methods: ["booth.catalog", "booth.invoice", "booth.pay", "booth.status"],
  paymentMethods: ["card", "lightning", "mpesa"],
  fee: 0.025,
  regions: ["global"]
}
```

#### Gate Agent (Access Verifier)
```typescript
agent: {
  type: "gate",
  methods: ["gate.challenge", "gate.verify"],
  resources: ["https://exclusive.alice.com/*"]
}
```

---

## 3. NWPC

### 3.1 Overview

**NWPC (Nostr Wrapped Procedure Calls)** is JSON-RPC over Nostr DMs.

```
┌─────────────────────────────────────────┐
│            Your Application             │
├─────────────────────────────────────────┤
│      NWPC (JSON-RPC schema)             │
├─────────────────────────────────────────┤
│      NIP-17 DMs (Kind 1059)             │
├─────────────────────────────────────────┤
│      NIP-44 Encryption                  │
├─────────────────────────────────────────┤
│      Nostr Events                       │
└─────────────────────────────────────────┘
```

### 3.2 Transport

NWPC uses **NIP-17 Private Direct Messages**:
- **Kind 1059** (Gift Wrap) for sealed sender
- **NIP-44** encryption
- Standard Nostr relay infrastructure

### 3.3 Message Format

NWPC messages are JSON-RPC 2.0 objects in the DM content:

#### Request
```typescript
{
  jsonrpc: "2.0",
  method: "booth.invoice",
  params: {
    catalogItemId: "premium-yearly",
    buyerPubkey: "abc123..."
  },
  id: "req-12345"
}
```

#### Response (Success)
```typescript
{
  jsonrpc: "2.0",
  result: {
    invoiceId: "inv-67890",
    expiresAt: 1704067200,
    paymentOptions: {...}
  },
  id: "req-12345"
}
```

#### Response (Error)
```typescript
{
  jsonrpc: "2.0",
  error: {
    code: 4002,
    message: "Invoice expired"
  },
  id: "req-12345"
}
```

### 3.4 Sending NWPC

```typescript
import { finalizeEvent, nip44, nip59 } from 'nostr-tools';

async function sendNWPC(recipientPubkey: string, method: string, params: any) {
  const message = {
    jsonrpc: "2.0",
    method,
    params,
    id: crypto.randomUUID()
  };
  
  // Create DM (Kind 14)
  const dm = {
    kind: 14,
    content: JSON.stringify(message),
    tags: [["p", recipientPubkey]],
    created_at: Math.floor(Date.now() / 1000)
  };
  
  // Wrap in Gift Wrap (Kind 1059) with NIP-44 encryption
  const wrapped = await nip59.wrapEvent(dm, senderSecretKey, recipientPubkey);
  
  // Publish to relays
  await pool.publish(relays, wrapped);
}
```

### 3.5 Receiving NWPC

```typescript
// Subscribe to Gift Wrap events addressed to us
pool.subscribeMany(relays, [
  { kinds: [1059], "#p": [myPubkey] }
], {
  onevent: async (event) => {
    // Unwrap and decrypt
    const dm = await nip59.unwrapEvent(event, mySecretKey);
    
    // Parse NWPC message
    const message = JSON.parse(dm.content);
    
    if (message.method) {
      // It's a request - handle it
      const result = await handleMethod(message.method, message.params);
      await sendNWPCResponse(dm.pubkey, result, message.id);
    }
  }
});
```

### 3.6 Why NIP-17 DMs?

- **Any Nostr client can send NWPC** (if it can send DMs)
- **Encrypted end-to-end** (NIP-44)
- **Sealed sender** (Gift Wrap hides sender from relays)
- **No new NIPs needed** (uses existing infrastructure)
- **Graceful degradation** (human-readable fallback possible)

---

## 4. Booth Protocol

### 4.1 Overview

Booth is the standardized protocol for purchasing TATs. It enables:

- Any Pocket to request and pay for TATs
- Multiple payment methods
- Decoupled payment processing from token minting
- Direct sales (Forge as its own Booth) or third-party sales

### 4.2 Terminology

| Term | Definition |
|------|------------|
| **Booth** | Agent that sells TATs, handles payment processing |
| **Catalog Item** | A purchasable TAT offering defined by a Forge |
| **Invoice** | A request for payment issued by a Booth |

### 4.3 Roles

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Pocket      │     │     Booth       │     │      Forge      │
│     (Buyer)     │     │   (Retailer)    │     │    (Issuer)     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  Request catalog      │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │  Request invoice      │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │  Pay invoice          │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │                       │  Mint request         │
         │                       │──────────────────────>│
         │                       │                       │
         │  Receive TAT          │                       │
         │<──────────────────────┼───────────────────────│
         │                       │                       │
```

---

### 4.4 NWPC Methods

#### 4.4.1 `booth.catalog`

Request available TATs.

**Request:**
```typescript
{
  method: "booth.catalog",
  params: {
    issuer?: string,           // Filter by Forge pubkey
    category?: string,         // Filter by category
    limit?: number,            // Max results (default: 50)
    offset?: number            // Pagination offset
  }
}
```

**Response:**
```typescript
{
  result: {
    booth: {
      pubkey: string,
      name: string,
      fee: number               // Fee rate (0.03 = 3%)
    },
    items: CatalogItem[],
    total: number,
    offset: number
  }
}
```

#### 4.4.2 `booth.invoice`

Request an invoice for purchasing a TAT.

**Request:**
```typescript
{
  method: "booth.invoice",
  params: {
    catalogItemId: string,      // Which item to purchase
    buyerPubkey: string,        // TAT will be locked to this key
    quantity?: number           // Default: 1
  }
}
```

**Response:**
```typescript
{
  result: {
    invoiceId: string,
    catalogItem: CatalogItem,
    expiresAt: number,          // Unix timestamp
    paymentOptions: PaymentOptions
  }
}
```

#### 4.4.3 `booth.pay`

Submit payment for an invoice.

**Request:**
```typescript
{
  method: "booth.pay",
  params: {
    invoiceId: string,
    payment: LightningPayment | HTLCPayment
  }
}
```

**Response:**
```typescript
{
  result: {
    success: boolean,
    tat?: string,                // TAT JWT if successful
    receipt?: Receipt,
    error?: string
  }
}
```

#### 4.4.4 `booth.status`

Check invoice status.

**Request:**
```typescript
{
  method: "booth.status",
  params: {
    invoiceId: string
  }
}
```

**Response:**
```typescript
{
  result: {
    invoiceId: string,
    status: "pending" | "paid" | "expired" | "cancelled",
    tat?: string,
    receipt?: Receipt
  }
}
```

### 4.5 Data Structures

#### CatalogItem

```typescript
interface CatalogItem {
  id: string;
  issuer: string;                // Forge pubkey
  name: string;
  description: string;
  
  price: {
    amount: number;
    currency: string;            // "USD" | "sats" | etc.
  };
  
  tokenType: "TAT" | "FUNGIBLE";
  duration?: number;             // Seconds (for subscriptions)
  
  supply?: {
    total: number;               // 0 = unlimited
    remaining: number;
  };
  
  metadata?: Record<string, unknown>;
}
```

#### PaymentOptions

```typescript
interface PaymentOptions {
  lightning?: {
    bolt11: string;
    amountSats: number;
  };
  htlc?: {
    hash: string;
    amount: number;
    timeout: number;
  };
}
```

### 4.6 Direct Sales (Forge as Booth)

Forges MAY implement Booth methods directly, eliminating the need for a separate service.

When a Forge implements `booth.*` methods:
- `booth.pubkey` equals `forge.pubkey`
- No authorization required (self-authorized)
- Payment goes directly to Forge's Pocket
- Simplest deployment model

#### Direct Sales Flow

```
┌─────────────┐                              ┌─────────────┐
│   Buyer     │                              │    Forge    │
│  (Pocket)   │                              │ (with Booth)│
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  1. booth.catalog                          │
       │───────────────────────────────────────────>│
       │                                            │
       │  2. booth.invoice                          │
       │───────────────────────────────────────────>│
       │                                            │
       │  3. booth.pay { tokens }                   │
       │───────────────────────────────────────────>│
       │                                            │
       │         4. Verify payment received         │
       │         5. Mint TAT                        │
       │                                            │
       │  6. Response { tat, receipt }              │
       │<───────────────────────────────────────────│
       │                                            │
```

### 4.7 Third-Party Booth Flow

When a separate Booth sells on behalf of a Forge:

1. Booth MUST be authorized by Forge (see Section 7)
2. Booth MUST pay Forge before requesting mint
3. Forge verifies payment before minting

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Buyer     │     │    Booth    │     │    Forge    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  1. Pay (any method)                  │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 2. Transfer payment│
       │                   │   to Forge        │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 3. forge.mint_request
       │                   │──────────────────>│
       │                   │                   │
       │                   │        4. Verify  │
       │                   │           payment │
       │                   │           & mint  │
       │                   │                   │
       │  5. TAT delivered │                   │
       │<──────────────────┼───────────────────│
       │                   │                   │
```

---

## 5. Gate Protocol

### 5.1 Overview

Gate is a standardized protocol for verifying TAT ownership. It enables:

- Challenge-response authentication
- Privacy-preserving verification (minimal disclosure)
- Flexible verification modes
- Replay attack protection

### 5.2 Flow

```
┌─────────────────┐                      ┌─────────────────┐
│     Pocket      │                      │      Gate       │
│    (Holder)     │                      │   (Verifier)    │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         │  1. Access request                     │
         │───────────────────────────────────────>│
         │                                        │
         │  2. Challenge { nonce, requirements }  │
         │<───────────────────────────────────────│
         │                                        │
         │  3. Proof { signature over nonce }     │
         │───────────────────────────────────────>│
         │                                        │
         │  4. Result { granted/denied }          │
         │<───────────────────────────────────────│
         │                                        │
```

### 5.3 NWPC Methods

#### 5.3.1 `gate.challenge`

**Request (from Pocket):**
```typescript
{
  method: "gate.challenge",
  params: {
    resource: string             // What is being accessed
  }
}
```

**Response:**
```typescript
{
  result: {
    nonce: string,               // Random 32 bytes hex
    requirements: {
      issuer: string,            // Required TAT issuer
      tokenIdPattern?: string,   // Regex pattern
      notExpired: boolean
    },
    expiresAt: number,
    verificationMode: "local" | "issuer" | "hybrid"
  }
}
```

#### 5.3.2 `gate.verify`

**Request:**
```typescript
{
  method: "gate.verify",
  params: {
    mode: "full" | "minimal",
    
    // Full mode
    tat?: string,                // Full TAT JWT
    
    // Minimal mode
    claim?: {
      tokenHash: string,
      issuer: string,
      holderPubkey: string
    },
    
    nonce: string,
    signature: string            // Sign(nonce, holderSecretKey)
  }
}
```

#### 5.3.3 `gate.result`

**Response:**
```typescript
{
  result: {
    granted: boolean,
    resource: string,
    
    session?: {
      token: string,
      validUntil: number
    },
    
    reason?: string,             // If denied
    requiredTAT?: {
      issuer: string,
      type: string
    }
  }
}
```

### 5.4 Verification Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **local** | Verify TAT signature locally | Fast, low-value access |
| **issuer** | Query Forge for validity | High-value, authoritative |
| **hybrid** | Local + periodic issuer check | Balance of speed/security |

### 5.5 Security Properties

- **Nonce**: Single-use, time-limited (prevents replay)
- **Signature**: Proves possession of key matching P2PKlock
- **Minimal disclosure**: Full TAT not required for basic verification

---

## 6. HTLC Protocol

### 5.1 Overview

Hash Time-Locked Contracts enable trustless atomic swaps:

- **Atomic**: Both sides complete or neither does
- **Trustless**: No trusted intermediary
- **Time-bounded**: Automatic refund on timeout

### 5.2 HTLC Token Fields

Extend token payload:

```typescript
interface HTLCPayload {
  HTLC?: string;                // SHA-256 hash (H)
  HTLCRecipient?: string;       // Pubkey that can claim with secret
  timeLock?: number;            // Unix timestamp for refund
  // P2PKlock is the refund destination
}
```

### 5.3 Claim Condition

```
IF (revealer knows S where SHA256(S) == HTLC)
   AND (revealer.pubkey == HTLCRecipient)
   AND (now < timeLock)
THEN release to HTLCRecipient
ELSE IF (now >= timeLock)
THEN release to P2PKlock (refund)
```

### 5.4 Public HTLC Claim Event

**CRITICAL**: Claims MUST be published publicly so all parties with the same hash can learn the secret.

**Event Kind:** `30120` (HTLC_CLAIM)

```typescript
{
  kind: 30120,
  
  tags: [
    ["h", "<hash-hex>"],           // The hash H
    ["s", "<secret-hex>"],         // The secret S (PUBLIC!)
    ["t", "<token-hash>"],         // Token being claimed
    ["i", "<issuer-pubkey>"]       // Token issuer
  ],
  
  content: "",
  pubkey: "<claimer-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 5.5 Atomic Swap Flow

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Buyer     │  │  Party A    │  │   Party B   │  │ Nostr Relay │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       │                │ 1. Generate S  │                │
       │                │    H=SHA256(S) │                │
       │                │                │                │
       │                │ 2. Create HTLC │                │
       │                │    Token A     │                │
       │                │    {H, 60min}  │                │
       │                │───────────────>│                │
       │                │                │                │
       │                │                │ 3. Create HTLC │
       │                │                │    Token B     │
       │                │                │    {H, 30min}  │
       │                │<───────────────│                │
       │                │                │                │
       │                │ 4. Reveal S    │                │
       │                │───────────────>│                │
       │                │                │                │
       │                │ 5. Publish HTLC_CLAIM           │
       │                │────────────────┼───────────────>│
       │                │                │                │
       │                │                │ 6. See claim,  │
       │                │                │    extract S   │
       │                │                │<───────────────│
       │                │                │                │
       │                │ 7. Both claim  │                │
       │                │    with S      │                │
       │                │                │                │
```

### 5.6 Timeout Ordering

**CRITICAL**: Payment timeout MUST be longer than delivery timeout.

```
Token A (Payment): timeout = T1 = 60 minutes
Token B (Delivery): timeout = T2 = 30 minutes

Rule: T1 >= 2 * T2

Rationale: If recipient claims Token B at minute 29,
           sender still has 31+ minutes to claim Token A.
```

### 5.7 NWPC Methods

#### `htlc.create`

```typescript
{
  method: "htlc.create",
  params: {
    tokenType: "FUNGIBLE" | "TAT",
    amount?: number,
    catalogItemId?: string,
    hash: string,
    recipient: string,
    timeout: number,
    refundTo: string
  }
}
```

#### `htlc.claim`

```typescript
{
  method: "htlc.claim",
  params: {
    tokenHash: string,
    secret: string
  }
}
```

#### `htlc.refund`

```typescript
{
  method: "htlc.refund",
  params: {
    tokenHash: string
  }
}
```

---

## 7. Forge Authorization Protocol

### 7.1 Overview

Forges can authorize third parties (Booths) to sell TATs on their behalf.

### 7.2 Authorization Event

**Event Kind:** `30130` (FORGE_AUTHORIZATION)

```typescript
{
  kind: 30130,
  
  tags: [
    ["d", "<unique-id>"],
    ["p", "<authorized-pubkey>"],
    ["catalog", "<item-id>"],        // Multiple allowed
    ["catalog", "<item-id>"],
    ["fee", "0.03"],                 // Max fee (3%)
    ["expires", "<unix-timestamp>"]
  ],
  
  content: JSON.stringify({
    restrictions?: {
      regions?: string[],
      maxPerDay?: number
    }
  }),
  
  pubkey: "<forge-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 7.3 Mint Request (From Authorized Booth)

```typescript
{
  method: "forge.mint_request",
  params: {
    authorizationEventId: string,
    catalogItemId: string,
    buyerPubkey: string,
    payment: {
      amount: number,
      tokenHashes: string[]
    }
  }
}
```

Forge verifies:
1. Authorization exists and is valid
2. Not expired
3. Catalog item is authorized
4. Payment received

### 7.4 Revocation

Publish updated authorization with empty catalog:

```typescript
{
  kind: 30130,
  tags: [
    ["d", "<same-id>"],
    ["p", "<authorized-pubkey>"],
    ["revoked", "true"]
  ],
  // ... signature
}
```

---

## 8. Discovery Events

### 8.1 Overview

Agent profiles use standard Kind 0 events with an `agent` field. TAT Protocol defines additional event kinds for public discovery and activity tracking.

### 8.2 Event Kind Registry

| Kind | Name | Publisher | Description |
|------|------|-----------|-------------|
| 0 | Profile | All Agents | Standard Nostr profile with `agent` field |
| 30100 | TAT_CATALOG_ITEM | Forge | Public TAT listing |
| 30101 | TAT_ACTIVITY | Forge | Mint/burn activity |
| 30120 | HTLC_CLAIM | Claimant | Secret revelation (public!) |
| 30130 | FORGE_AUTHORIZATION | Forge | Third-party Booth auth |
| 30131 | AUTHORIZATION_REQUEST | Booth | Request to sell |

### 8.3 TAT_CATALOG_ITEM (30100)

Public listing of a TAT available for purchase.

```typescript
{
  kind: 30100,
  
  tags: [
    ["d", "<catalog-item-id>"],
    ["name", "Premium Membership"],
    ["price", "500", "USD"],
    ["duration", "2592000"],         // 30 days in seconds
    ["category", "membership"]
  ],
  
  content: JSON.stringify({
    description: "Full access to premium content",
    benefits: ["Exclusive posts", "Early access"],
    image: "https://...",
    metadata: {...}
  }),
  
  pubkey: "<forge-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 8.4 TAT_ACTIVITY (30101)

Public announcement of minting/burning activity.

```typescript
{
  kind: 30101,
  
  tags: [
    ["d", "<activity-id>"],
    ["action", "mint"],              // "mint" | "burn"
    ["catalog", "<catalog-item-id>"],
    ["count", "1"]
  ],
  
  content: "",                       // No private data
  
  pubkey: "<forge-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 8.5 HTLC_CLAIM (30120)

**CRITICAL**: This event reveals the HTLC secret publicly. This is intentional and required for atomic swaps.

```typescript
{
  kind: 30120,
  
  tags: [
    ["h", "<hash-hex>"],             // The hash H
    ["s", "<secret-hex>"],           // The secret S (PUBLIC!)
    ["t", "<token-hash>"],           // Token being claimed
    ["i", "<issuer-pubkey>"]         // Token issuer
  ],
  
  content: "",
  pubkey: "<claimer-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 8.6 FORGE_AUTHORIZATION (30130)

Forge authorizes a Booth to sell on their behalf.

```typescript
{
  kind: 30130,
  
  tags: [
    ["d", "<unique-id>"],
    ["p", "<booth-pubkey>"],
    ["catalog", "<item-id>"],        // Multiple allowed
    ["catalog", "<item-id>"],
    ["fee", "0.03"],                 // Max fee (3%)
    ["expires", "<unix-timestamp>"]
  ],
  
  content: JSON.stringify({
    restrictions?: {
      regions?: string[],
      maxPerDay?: number
    }
  }),
  
  pubkey: "<forge-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

### 8.7 AUTHORIZATION_REQUEST (30131)

Booth requests authorization from a Forge.

```typescript
{
  kind: 30131,
  
  tags: [
    ["d", "<request-id>"],
    ["p", "<forge-pubkey>"],
    ["catalog", "<item-id>"],        // Requested items
    ["fee", "0.025"]                 // Proposed fee
  ],
  
  content: JSON.stringify({
    boothName: "TATpay",
    pitch: "We offer card payments worldwide...",
    paymentMethods: ["card", "lightning"],
    regions: ["global"]
  }),
  
  pubkey: "<booth-pubkey>",
  created_at: <timestamp>,
  sig: "<signature>"
}
```

---

## 9. Security Considerations

### 9.1 Booth Security

- **Payment-First**: Forges MUST verify payment before minting
- **Authorization Limits**: Set conservative limits on third-party authorizations
- **Invoice Expiry**: Invoices MUST expire within reasonable time (15-60 minutes)

### 9.2 Gate Security

- **Nonce**: Minimum 32 bytes, single-use, time-limited
- **Signature Binding**: Must match P2PKlock
- **Replay Prevention**: Track used nonces

### 9.3 HTLC Security

- **Timeout Ordering**: Payment timeout >= 2 × delivery timeout
- **Secret Strength**: Minimum 32 bytes random
- **Claim Monitoring**: Watch for HTLC_CLAIM events

### 9.4 Key Management

- Store Forge keys securely (HSM for production)
- Support key rotation
- Encrypt Pocket keys at rest

---

## 10. Reference Implementation Notes

### 10.1 Dependencies

- `@noble/curves` for Schnorr signatures
- `@noble/hashes` for SHA-256
- `nostr-tools` for Nostr operations

### 10.2 Error Codes

| Code | Meaning |
|------|---------|
| 1000 | Invalid request |
| 2000 | Unauthorized |
| 3000 | Not found |
| 4000 | Payment required |
| 4001 | Insufficient funds |
| 4002 | Invoice expired |
| 5000 | Internal error |

### 10.3 Versioning

Protocol version in token header: `ver: "1.0.0"`

NWPC requests MAY include version:
```typescript
{ method: "booth.catalog", version: "1.0", params: {...} }
```

---

## Appendix A: Example Flows

### A.1 Direct Purchase

```
1. Buyer → Forge: booth.catalog
2. Forge → Buyer: { items }
3. Buyer → Forge: booth.invoice { itemId, buyerPubkey }
4. Forge → Buyer: { invoiceId, paymentOptions }
5. Buyer → Forge: booth.pay { tokens }
6. Forge: Verify payment, mint TAT
7. Forge → Buyer: { tat, receipt }
```

### A.2 Third-Party Purchase

```
1. Buyer → Booth: booth.invoice
2. Booth → Buyer: { invoiceId, paymentOptions }
3. Buyer → Booth: Pay (any method)
4. Booth → Forge: Transfer payment
5. Booth → Forge: forge.mint_request
6. Forge: Verify payment, mint TAT
7. Forge → Buyer: TAT
8. Booth → Buyer: Receipt
```

### A.3 HTLC Atomic Swap

```
1. Party A generates secret S, hash H
2. Party A creates HTLC Token A { H, timeout: 60min }
3. Party A → Party B: HTLC Token A
4. Party B verifies, creates HTLC Token B { H, timeout: 30min }
5. Party B → Party A: HTLC Token B
6. Party A claims Token B with S (publishes HTLC_CLAIM)
7. Party B sees S in public event
8. Party B claims Token A with S
```

### A.4 Access Verification

```
1. User → App: Request access
2. App → User: gate.challenge { nonce, requirements }
3. User: Sign nonce with TAT holder key
4. User → App: gate.verify { signature }
5. App: Verify signature matches P2PKlock
6. App → User: gate.result { granted }
```

---

## Changelog

- **0.1.0-draft** (2024-12-30): Initial draft
