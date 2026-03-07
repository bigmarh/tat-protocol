# Forge

> `@tat-protocol/forge` — Mint, transfer, and burn tokens. Includes `FungibleForge` and `TATForge`.

## Installation

```bash
npm install @tat-protocol/forge
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

The Forge is the token **issuer**. It mints new tokens, validates transfers, tracks spent tokens to prevent double-spending, and enforces supply limits. There are two concrete implementations:

- **FungibleForge** — interchangeable tokens with amounts (currencies, points, credits)
- **TATForge** (`NonFungibleForge`) — unique tokens with IDs (tickets, memberships, badges)

Both extend `ForgeBase`, which extends `NWPCServer` for network communication.

## Quick start

```ts
import { createFungibleForgeWithKey, NodeStore } from "@tat-protocol/tdk";

const forge = await createFungibleForgeWithKey({
  secretKey: process.env.FORGE_SK!,
  owner: process.env.FORGE_OWNER_PK!,
  storage: new NodeStore(".forge"),
  relays: ["wss://relay.damus.io"],
  totalSupply: 1_000_000,
});
```

## ForgeConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `owner` | `string` | Yes | Forge owner's public key |
| `storage` | `StorageInterface` | Yes | Storage backend |
| `signer` | `Signer` | One of signer/keys | Signer for signing operations |
| `keys` | `KeyPair` | One of signer/keys | Direct keypair (legacy) |
| `relays` | `string[]` | No | Nostr relay URLs |
| `totalSupply` | `number` | No | Maximum tokens that can be minted |
| `tokenType` | `TokenType` | No | `FUNGIBLE` or `TAT` (set automatically by subclass) |
| `authorizedForgers` | `string[]` | No | Public keys allowed to mint |
| `assetIdStrategy` | `"unique" \| "sequential"` | No | TAT ID generation strategy |

## API Reference

### ForgeBase (abstract)

Base class for all forges. You typically use `FungibleForge` or `TATForge` directly.

#### `initialize()`

```ts
async initialize(): Promise<void>
```

Initializes the forge: loads or generates keys, sets up storage, connects to relays. Called automatically by factory functions. Idempotent.

#### `getPublicKey()`

```ts
getPublicKey(): string | undefined
```

Returns the forge's public key.

#### `verifyToken()`

```ts
async verifyToken(
  tokenHash: string,
  signature: string,
  publicKey: string,
  readerPubkey?: string,
  timeWindow?: number,
  currentTime?: number
): Promise<boolean>
```

Validates a token's signature, checks expiration, and verifies reader eligibility.

#### `signAndCreateJWT()`

```ts
async signAndCreateJWT(token: Token): Promise<string>
```

Signs a Token instance and serializes it to JWT format.

#### `validateTXInputs()`

```ts
async validateTXInputs(
  tx: TransactionData,
  witnessData?: string[],
  providedHTLCSecret?: string
): Promise<[TransactionData | null, string | null, number | null, string | undefined]>
```

Validates transaction inputs: checks double-spend status, expiration, P2PK locks, HTLC secrets, and time locks. Returns validated data or null on failure.

#### `addAuthorizedForger()`

```ts
async addAuthorizedForger(pubkey: string): Promise<void>
```

Grants minting authority to another public key. Authorized forgers can mint tokens on behalf of the forge owner.

#### `removeAuthorizedForger()`

```ts
async removeAuthorizedForger(pubkey: string): Promise<void>
```

Revokes minting authority.

#### `getAuthorizedForgers()`

```ts
getAuthorizedForgers(): string[]
```

Returns the list of authorized forger public keys.

#### `publishSpentToken()`

```ts
async publishSpentToken(tokenHash: string): Promise<void>
```

Marks a token as spent and broadcasts the spent notification.

### Middleware

ForgeBase provides middleware for handler chains:

#### `onlyAuthorized`

Restricts a handler to the forge owner or authorized forgers. Returns `UNAUTHORIZED` error otherwise.

#### `onlyOwner`

Restricts a handler to the forge owner only.

### FungibleForge

Extends `ForgeBase`. Handles interchangeable tokens with amounts.

```ts
const forge = new FungibleForge(config);
await forge.initialize();
```

#### `forgeToken()`

Mints fungible tokens. Called via NWPC request with params:

```ts
// NWPC request params
{ "to": "recipientPubkey", "amount": 100 }
```

The forge creates tokens using its denomination set and sends them to the recipient.

#### `transferToken()`

Processes a transfer request. The Pocket sends input tokens and output specifications; the Forge validates, marks inputs as spent, and mints new tokens.

```ts
// NWPC request params
{
  "ins": ["tokenJWT1", "tokenJWT2"],
  "outs": [{ "to": "recipientPubkey", "amount": 50 }],
  "witnessData": ["signature1", "signature2"]
}
```

The Forge automatically handles change — if inputs total 100 and the transfer is 60, a 40-unit change token is returned to the sender.

#### `burnToken()`

Burns tokens, reducing the circulating supply.

### TATForge (NonFungibleForge)

Extends `ForgeBase`. Handles unique Transferable Access Tokens.

```ts
import { createTATForgeWithKey, NodeStore } from "@tat-protocol/tdk";

const forge = await createTATForgeWithKey({
  secretKey: process.env.FORGE_SK!,
  owner: forgePk,
  storage: new NodeStore(".tat-forge"),
  relays: ["wss://relay.damus.io"],
});
```

#### `forgeToken()`

Mints a unique TAT. The `tokenID` is auto-generated or can be specified.

```ts
// NWPC request params
{ "to": "recipientPubkey" }
// With custom metadata:
{ "to": "recipientPubkey", "tokenID": "ticket-001", "ext": { "seat": "A1" } }
```

#### `transferToken()`

Transfers a TAT to a new recipient. The original token is marked as spent and a new token is minted for the recipient.

#### `burnToken()`

Burns a TAT, decrementing the circulating supply.

## ForgeState

The forge persists this state:

| Property | Type | Description |
|----------|------|-------------|
| `owner` | `string` | Owner public key |
| `spentTokens` | `Set<string>` | Token hashes marked as spent |
| `pendingTxs` | `Map<string, any>` | In-flight transactions |
| `totalSupply` | `number` | Total minted tokens |
| `circulatingSupply` | `number` | Currently active tokens |
| `lastAssetId` | `number` | Last sequential TAT ID |
| `authorizedForgers` | `Set<string>` | Authorized minter keys |
| `tokenUsage` | `Map<string, number>` | Token usage tracking |

## Related

- [Token](/sdk/token) — token format, validation, and locks
- [Pocket](/sdk/pocket) — the wallet that receives minted tokens
- [TDK](/sdk/tdk) — factory functions for easier setup
- [Mint & Transfer guide](/guides/mint-and-transfer)
