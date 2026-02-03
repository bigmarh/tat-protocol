# TAT Protocol Architecture Summary

> **Token Authentication & Transfer Protocol** - A decentralized token system built on Nostr with end-to-end encryption, hierarchical key management, and trustless atomic swaps.

**Repository:** [github.com/bigmarh/tat-protocol](https://github.com/bigmarh/tat-protocol)
**Version:** 0.1.0
**License:** MIT

---

## Table of Contents

1. [Overview](#overview)
2. [Data Models](#data-models)
3. [Token Configuration Options](#token-configuration-options)
4. [API Endpoints / NWPC Protocol](#api-endpoints--nwpc-protocol)
5. [Auth/Identity Architecture](#authidentity-architecture)
6. [Package Structure](#package-structure)
7. [Storage System](#storage-system)
8. [Protocol Extensions](#protocol-extensions)
9. [Existing Documentation](#existing-documentation)

---

## Overview

TAT Protocol is a **decentralized token system** built on [Nostr](https://github.com/nostr-protocol/nostr) that enables:

- **Fungible Tokens** - Digital currencies, loyalty points, credits
- **Non-Fungible Tokens (TATs)** - Unique access tokens, tickets, memberships
- **End-to-end Encryption** - Private, secure transactions via NIP-44
- **Decentralized** - No central server, runs on Nostr relays
- **Trustless Swaps** - HTLC-based atomic exchanges

### Issuer-Authority Model

Unlike blockchain tokens, TAT Protocol uses an **issuer-authority model**:

| Aspect | Blockchain | TAT Protocol |
|--------|------------|--------------|
| Authority | Network consensus | Token issuer (Forge) |
| Validation | All participants | Issuer validates |
| Double-Spend | Consensus mechanism | Issuer tracks spent tokens |
| Cost | Gas fees | Relay costs (minimal) |
| Finality | Probabilistic | Immediate |

### Use Cases

- Loyalty points & rewards
- Event tickets & access passes
- Membership tokens & subscriptions
- Digital collectibles
- Gated content access
- Prepaid credits

---

## Data Models

### Core Types (`packages/types/`)

```typescript
export interface KeyPair {
    secretKey: string;      // Hex-encoded Schnorr private key (64 chars)
    publicKey: string;      // Hex-encoded Schnorr public key (64 chars)
}

export enum TokenType {
    FUNGIBLE = "FUNGIBLE",           // Interchangeable (credits, points)
    NON_FUNGIBLE = "NON_FUNGIBLE",   // Unique (TATs, tickets)
    SEMI_FUNGIBLE = "SEMI_FUNGIBLE"  // Partially interchangeable (trading cards)
}
```

### Token Model (`packages/token/src/Token.ts`)

**Token Format:** JWT (JSON Web Token)
```
BASE64URL(Header).BASE64URL(Payload).BASE64URL(Signature)
```

**Header:**
```typescript
export interface Header {
    alg: string;            // "Schnorr" - signature algorithm
    typ: TokenType;         // Token type identifier
    token_hash?: string;    // Double SHA256 hash of payload (hex)
    ver?: string;           // Protocol version (e.g., "1.0.0")
}
```

**Payload:**
```typescript
export interface Payload {
    iss: string;            // Issuer (Forge) public key
    iat: number;            // Issued at timestamp (Unix seconds)
    exp?: number;           // Expiration timestamp (Unix seconds)

    // Fungible tokens
    amount?: number;        // Token amount/value
    setID?: string;         // Token set identifier (e.g., "USD", "loyalty-points")

    // Non-fungible tokens (TATs)
    tokenID?: number;       // Unique token identifier

    // Locking mechanisms (priority order)
    HTLC?: string;          // Hash of secret pre-image (Priority #1)
    timeLock?: number;      // Timelock constraint (Priority #2)
    P2PKlock?: string;      // Pay-to-Public-Key lock (Priority #3)

    // Optional fields
    data_uri?: string;      // URI to external data
    ext?: Record<string, any>; // Custom extension fields (application data)
}
```

**DerivedPayload (for child tokens):**
```typescript
export interface DerivedPayload extends Payload {
    parentToken: string;           // Hash of parent token
    access?: {
        [key: string]: any;        // Flexible access control rules
    };
}
```

### Token Class Methods

| Method | Description |
|--------|-------------|
| `build(opts)` | Creates a new token with header/payload |
| `fromJWT(jwt)` | Restores token from JWT string |
| `toJWT(signature)` | Creates complete JWT string |
| `create_token_hash(readerPubkey?, timeWindow?)` | Creates double SHA256 hash |
| `sign(data, keys)` | Schnorr signs data with private key |
| `validate()` | Validates token based on type |
| `lock(type, value)` | Adds lock (P2PK, HTLC, TIME) |
| `unlock(type)` | Removes specific lock |
| `isLocked()` | Checks if any lock present |
| `isExpired()` | Checks expiration timestamp |
| `hasP2PKLock()` | Checks for P2PK lock |
| `hasHTLC()` | Checks for HTLC lock |
| `isTimeLocked()` | Checks if timelock is active |
| `getLockType()` | Returns active lock type |
| `getAccessRules()` | Gets derived token access rules |
| `createDerivedToken()` | Static: creates child token with access control |

---

## Token Configuration Options

### ForgeConfig (`packages/forge/src/ForgeConfig.ts`)

```typescript
export interface ForgeConfig {
    owner?: string;                             // Owner's public key
    forgeId?: number;                           // Unique forge identifier
    tokenType: TokenType;                       // Type of tokens (required)
    storage?: StorageInterface;                 // Custom storage implementation
    storageType?: 'browser' | 'node';           // Storage backend type
    maxSupply?: number;                         // Maximum mintable tokens
    assetIdStrategy?: "unique" | "sequential";  // ID generation for NFTs
    keys?: KeyPair;                             // Optional (auto-generated if not provided)
    authorizedForgers?: string[];               // Pubkeys authorized to mint
}
```

### FungibleForge Configuration

```typescript
const forge = await FungibleForge.create({
    storage: new NodeStorage({ path: './.forge' }),
    keys: { secretKey, publicKey },
    relays: ['wss://relay.damus.io'],
    setID: 'my-currency',                       // Token set identifier
    denomination: [1, 5, 10, 20, 50, 100],      // Available denominations
    totalSupply: 10000                          // Maximum supply
});
```

### ForgeState (`packages/forge/src/ForgeState.ts`)

```typescript
export interface ForgeState {
    owner: string;                              // Forge owner's public key
    version: number;                            // State format version
    spentTokens: Set<string>;                   // Double-spend prevention
    pendingTxs: Map<string, any>;               // Pending transactions
    lastProcessedEvent?: string;                // Replay prevention
    lastSavedAt?: number;                       // Last state save timestamp
    totalSupply: number;                        // Total minted tokens
    lastAssetId?: number;                       // Sequential ID counter
    authorizedForgers: Set<string>;             // Authorized forger pubkeys
    tokenUsage: Map<string, number>;            // Token usage tracking
}
```

### PocketConfig (`packages/pocket/src/Pocket.ts`)

```typescript
export interface PocketConfig extends NWPCConfig {
    ndk?: unknown;                              // NDK instance
    relays?: string[];                          // Nostr relay URLs
    storage?: StorageInterface;                 // Storage implementation
    storageType?: 'node' | 'browser';           // Storage type
    keys: KeyPair;                              // Wallet keys (required)
    requestHandlers?: Map<string, NWPCHandler>; // Request handlers
}
```

### PocketState

```typescript
export interface PocketState {
    favorites: string[];                         // Favorite issuer pubkeys
    hdMasterKey: HDKeys;                         // Master seed info
    singleUseKeys: Map<string, SingleUseKey>;    // Ephemeral keys
    tokens: Map<string, Map<string, string>>;    // [issuer][tokenHash] = JWT
    balances: Map<string, Map<string, number>>;  // [issuer][setID] = balance
    tokenIndex: Map<string, Map<number, string[]>>; // [issuer][denomination]
    tatIndex: Map<string, Map<string, string>>;  // [issuer][tokenID] = hash
}
```

### NWPCConfig (`packages/nwpc/src/types.ts`)

```typescript
export interface NWPCConfig {
    relays?: string[];                          // Nostr relay URLs
    keys: KeyPair;                              // Node keys (required)
    hooks?: MessageHookOptions;                 // Middleware hooks
    storage?: StorageInterface;                 // Storage implementation
    requestHandlers?: Map<string, NWPCRoute>;   // Request handlers
    type?: 'client' | 'server';                 // Node type
}

export interface MessageHookOptions {
    beforeRequest?: MessageHook;                // Pre-request middleware
    afterRequest?: MessageHook;                 // Post-request middleware
    beforeResponse?: MessageHook;               // Pre-response middleware
    afterResponse?: MessageHook;                // Post-response middleware
}
```

### Default Configuration (`packages/config/`)

```typescript
export const defaultConfig = {
    relays: [
        "ws://localhost:8080",
        "wss://relay.nostr.band/all",
    ]
};
```

---

## API Endpoints / NWPC Protocol

**NWPC** = Nostr Wrapped Procedure Calls (JSON-RPC over encrypted Nostr DMs)

### Transport Layer

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

### Request/Response Model

```typescript
export interface NWPCRequest {
    id: string;                    // Unique request identifier (UUID)
    method: string;                // RPC method name
    params: any[];                 // Method parameters
    timestamp: number;             // Request timestamp (ms)
}

export interface NWPCResponse {
    id: string;                    // Correlates with request ID
    result?: any;                  // Success response data
    error?: {
        code: number;              // Error code
        message: string;           // Error message
    };
    timestamp: number;
}
```

### Handler Types

```typescript
export type NWPCHandler = (
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
    next: () => Promise<NWPCResponse>
) => Promise<NWPCResponse>;
```

### NWPCContext

```typescript
export interface NWPCContext {
    event: NDKEvent;              // The Nostr event wrapper
    poster: string;               // Original poster pubkey
    sender: string;               // Actual sender pubkey
    recipient: string;            // Recipient pubkey
}
```

### Core NWPC Classes

| Class | Purpose |
|-------|---------|
| `NWPCBase` | Abstract base with NDK connection, subscriptions, hooks |
| `NWPCServer` | Handles incoming requests (unwraps gift-wrapped messages) |
| `NWPCPeer` | Bi-directional communication (client + server) |
| `NWPCRouter` | Routes requests to handlers by method name |
| `HandlerEngine` | Executes middleware pipeline with `next()` |

### Example Handler Registration

```typescript
const handlers = {
    ping: async (req, _, res) => res.send('pong', 'sender'),
    add: async (req, _, res) => res.send(req.params.a + req.params.b, 'sender'),
    subtract: async (req, _, res) => res.send(req.params.a - req.params.b, 'sender'),
    divide: async (req, _, res) => {
        if (req.params.b === 0) return res.error(400, 'Division by zero');
        return res.send(req.params.a / req.params.b, 'sender');
    }
};

// Register handlers
Object.entries(handlers).forEach(([name, handler]) => {
    server.use(name, handler);
});
```

### Error Codes

| Code | Meaning |
|------|---------|
| 1000 | Invalid request |
| 2000 | Unauthorized |
| 3000 | Not found |
| 4000 | Payment required |
| 4001 | Insufficient funds |
| 4002 | Invoice expired |
| 5000 | Internal error |

---

## Auth/Identity Architecture

### Cryptographic Foundation

| Component | Algorithm/Standard |
|-----------|-------------------|
| Signature | Schnorr (secp256k1) |
| Hashing | SHA-256 |
| Encryption | NIP-44 (ChaCha20-Poly1305 AEAD) |
| Key Derivation | BIP32/BIP39 |

### Crypto Helpers (`packages/utils/src/CryptoHelpers.ts`)

```typescript
export function signMessage(message: Uint8Array, keys: KeyPair): Uint8Array;
export function verifySignature(message: Uint8Array, signature: Uint8Array, pubkey: string): boolean;
export async function createHash(data: string): Promise<Uint8Array>;
export function addBase64Padding(str: string): string;
export function removeBase64Padding(encoded: string): string;
```

### HD Key Derivation (`packages/hdkeys/`)

```typescript
export class HDKey {
    static generateMnemonic(): string;                    // BIP39 256-bit mnemonic
    static async mnemonicToSeed(mnemonic: string): Promise<Uint8Array>;
    static fromMasterSeed(seed: Uint8Array): HDKey;

    derive(path: string): HDKey;                          // BIP32 derivation
    get privateKey(): string;                             // Hex-encoded
    get publicKey(): string;                              // Hex-encoded
    get privateExtendedKey(): string;                     // BIP32 extended key
}
```

**Derivation Path:** `m/7'/23'/11'/16'/0/{index}`

### Single-Use Keys

```typescript
export interface SingleUseKey {
    secretKey: string;
    publicKey: string;
    createdAt: number;
    used?: boolean;
}
```

### Nostr Message Encryption (NIP-44/NIP-59)

```typescript
// Encrypt and wrap message for anonymous relay
export async function Wrap(
    ndk: NDK,
    message: string,
    fromKeys: KeyPair,
    To: string
): Promise<NDKEvent>;

// Decrypt wrapped message
export async function Unwrap(
    wrapped: string,
    localKeys: KeyPair,
    wrappedPubKey: string
): Promise<{sender: string, kind: number, content: string} | false>;
```

**Wrapping Flow:**
1. Create Kind 14 event (DM) with content
2. Encrypt using NIP-44 (recipient's public key)
3. Seal in Kind 13 envelope
4. Gift-wrap with random postman keypair (NIP-59)
5. Publish as Kind 1059 to relay

### Token Signing Flow

1. Encode payload to Base64 (without padding) → SHA256 → `hash1`
2. Add optional timeWindow nonce: `hash1:timeSlot`
3. Add optional readerPubkey: `hash1:timeSlot:readerPubkey`
4. SHA256 result → `hash2` (stored in `header.token_hash`)
5. Sign `token_hash` with Schnorr private key
6. JWT format: `base64(header).base64(payload).signature`

---

## Package Structure

| Package | Purpose |
|---------|---------|
| `@tat-protocol/types` | Core type definitions (KeyPair, TokenType) |
| `@tat-protocol/token` | Token class, JWT serialization, validation, locking |
| `@tat-protocol/forge` | Token minting, issuer management, FungibleForge, NonFungibleForge |
| `@tat-protocol/pocket` | Wallet, token storage, HD key management |
| `@tat-protocol/hdkeys` | BIP32/BIP39 hierarchical key derivation |
| `@tat-protocol/nwpc` | Network protocol: server, peer, routing, handlers |
| `@tat-protocol/storage` | Storage interface + multiple backends |
| `@tat-protocol/utils` | Crypto, Nostr encryption, debug logging, BloomFilter |
| `@tat-protocol/config` | Default relay configurations |
| `@tat-protocol/tdk` | Token Development Kit (unified SDK) |
| `@tat-protocol/booth` | TAT purchasing protocol |
| `@tat-protocol/gate` | Access verification protocol |
| `@tat-protocol/signers` | Signing utilities |

---

## Storage System

### StorageInterface

```typescript
export interface StorageInterface {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
}
```

### Storage Implementations

| Implementation | Backend | Use Case |
|----------------|---------|----------|
| `BrowserStorage` | localStorage | Browser apps |
| `NodeStorage` / `DiskStorage` | Filesystem | Node.js apps |
| `FireBaseRTDBStorage` | Firebase Realtime DB | Cloud persistence |
| `GoogleCloudStorage` | Google Cloud Storage | Cloud persistence |
| `RedisStorage` | Redis | Distributed caching |
| `SQLliteStorage` | SQLite | Local database |

### Storage Keys

| Context | Key Pattern | Description |
|---------|-------------|-------------|
| Forge | `forge-keys` | Forge keypair |
| Forge | `forge-keys-{forgeId}` | Multiple forge instances |
| Forge | `forge-state` | State (spent tokens, pending txs) |
| Pocket | `pocket-idkey` | Wallet identity key |
| Pocket | `pocket-state-{publicKey}` | Wallet state |
| NWPC | `nwpcState` | Active subscriptions |

---

## Protocol Extensions

### Agent Types

TAT Protocol defines four **Agents** (Nostr accounts that participate in the protocol):

| Agent | Role |
|-------|------|
| **Forge** | Mints and manages tokens |
| **Pocket** | Holds and spends tokens (user wallet) |
| **Booth** | Sells TATs, handles payments |
| **Gate** | Verifies TAT ownership for access control |

### Booth Protocol (`packages/booth/`)

Standardized TAT purchasing:

```typescript
// NWPC Methods
booth.catalog    // Request available TATs
booth.invoice    // Request payment invoice
booth.pay        // Submit payment
booth.status     // Check invoice status
```

**CatalogItem:**
```typescript
interface CatalogItem {
    id: string;
    issuer: string;               // Forge pubkey
    name: string;
    description: string;
    price: { amount: number; currency: string; };
    tokenType: "TAT" | "FUNGIBLE";
    duration?: number;            // Seconds (for subscriptions)
    supply?: { total: number; remaining: number; };
    metadata?: Record<string, unknown>;
}
```

### Gate Protocol (`packages/gate/`)

Access verification via challenge-response:

```typescript
// NWPC Methods
gate.challenge   // Request verification challenge
gate.verify      // Submit proof of TAT ownership
```

**Verification Modes:**
| Mode | Description |
|------|-------------|
| `local` | Verify TAT signature locally |
| `issuer` | Query Forge for validity |
| `hybrid` | Local + periodic issuer check |

### HTLC Protocol

Hash Time-Locked Contracts for trustless atomic swaps:

```typescript
interface HTLCPayload {
    HTLC?: string;                // SHA-256 hash (H)
    HTLCRecipient?: string;       // Pubkey that can claim with secret
    timeLock?: number;            // Unix timestamp for refund
}

// Claim condition:
// IF revealer knows S where SHA256(S) == HTLC
//    AND revealer.pubkey == HTLCRecipient
//    AND now < timeLock
// THEN release to HTLCRecipient
// ELSE IF now >= timeLock
// THEN release to P2PKlock (refund)
```

### Discovery Events (Nostr)

| Kind | Name | Publisher |
|------|------|-----------|
| 0 | Profile | All Agents (with `agent` field) |
| 30100 | TAT_CATALOG_ITEM | Forge |
| 30101 | TAT_ACTIVITY | Forge |
| 30120 | HTLC_CLAIM | Claimant |
| 30130 | FORGE_AUTHORIZATION | Forge |
| 30131 | AUTHORIZATION_REQUEST | Booth |

---

## Existing Documentation

### Documentation Files

| File | Description |
|------|-------------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Quick start tutorial with code examples |
| [CLAUDE_REFERENCE.md](CLAUDE_REFERENCE.md) | Comprehensive reference for building applications |
| [docs/TAT_Protocol_Extensions.md](docs/TAT_Protocol_Extensions.md) | Protocol extensions (Booth, Gate, HTLC) |
| [SECURITY.md](SECURITY.md) | Security best practices |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [LICENSE](LICENSE) | MIT License |

### Quick Start Example

```typescript
import {
    Pocket,
    FungibleForge,
    NodeStorage,
    generateSecretKey,
    getPublicKey
} from '@tat-protocol/tdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Generate keys
const forgeSecretKey = bytesToHex(generateSecretKey());
const forgePubKey = getPublicKey(hexToBytes(forgeSecretKey));

// Create Forge (token issuer)
const forge = await FungibleForge.create({
    storage: new NodeStorage({ path: './.forge' }),
    keys: { secretKey: forgeSecretKey, publicKey: forgePubKey },
    relays: ['wss://relay.damus.io'],
    setID: 'my-tokens',
    denomination: [1, 5, 10, 20, 50, 100],
    totalSupply: 1000
});

// Create Pocket (wallet)
const pocket = await Pocket.create({
    storage: new NodeStorage({ path: './.pocket' }),
    keys: { secretKey: pocketSecretKey, publicKey: pocketPubKey },
    relays: ['wss://relay.damus.io']
});

// Get receiving address
const address = await pocket.getNewReceiveAddress();

// Mint tokens
await forge.mintFungible(address, 100);

// Check balance
const balance = pocket.getBalance(forgePubKey, 'my-tokens');
```

### Common Operations

```typescript
// Generate keys
const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(hexToBytes(sk));

// HD key derivation
const mnemonic = HDKey.generateMnemonic(256);
const seed = await HDKey.mnemonicToSeed(mnemonic);
const master = HDKey.fromMasterSeed(seed);

// Transfer tokens
await pocket.transfer(issuerPubKey, recipientAddress, amount);

// Validate token
const token = await new Token().restore(tokenJWT);
const isValid = await token.validate();

// Check TAT ownership
const tatHash = pocket.getTAT(issuerPubKey, 'membership-001');
```

---

## Project Metadata

| Property | Value |
|----------|-------|
| Version | 0.1.0 |
| Node Version | ^22.15.12 |
| TypeScript | ^5.8.3 |
| Package Manager | pnpm@10.10.0 |
| License | MIT |
| Author | Lamar Wilson |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@nostr-dev-kit/ndk` | Nostr protocol client |
| `nostr-tools` | Nostr utilities |
| `bip39` | Mnemonic generation |
| `@scure/bip32` | HD wallet derivation |
| `@noble/hashes` | SHA-256 hashing |
| `@noble/curves` | Schnorr signatures (secp256k1) |

---

## Key Architectural Patterns

### Middleware Pipeline
NWPC uses Express-like middleware with `next()` for handler composition.

### Nostr-Based Communication
- All communication uses Nostr protocol
- Kind 1059 (Gift Wrap) for encrypted, anonymous messaging
- Multi-relay support for redundancy

### Token Lineage
- Parent tokens can spawn derived tokens with access rules
- Flexible extension mechanism via `payload.ext`

### Lock Priority
1. **HTLC** (Hash Time Lock Contract) - Priority #1
2. **timeLock** - Priority #2
3. **P2PKlock** (Pay-to-Public-Key) - Priority #3

### Double-Spend Prevention
- Forge tracks spent token hashes in state
- Optional timeWindow-based token reuse with reader pubkey validation
