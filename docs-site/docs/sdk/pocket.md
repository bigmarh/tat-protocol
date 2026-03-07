# Pocket

> `@tat-protocol/pocket` — Wallet that stores, indexes, and transfers tokens.

## Installation

```bash
npm install @tat-protocol/pocket
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

The Pocket is the token **holder**. It receives tokens, stores them locally, tracks balances, and builds transfer transactions. It communicates with Forges over encrypted Nostr relays via NWPC.

## Quick start

```ts
import { createPocketWithKey, NodeStore } from "@tat-protocol/tdk";

const pocket = await createPocketWithKey({
  secretKey: process.env.POCKET_SK!,
  storage: new NodeStore(".pocket"),
  relays: ["wss://relay.damus.io"],
});

// Get a receiving address
const address = await pocket.getNewReceiveAddress();

// Check balance after receiving tokens
const balance = pocket.getBalance(forgePubkey, "-");
```

## PocketConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `storage` | `StorageInterface` | Yes | Storage backend |
| `signer` | `Signer` | One of signer/keys | Signer for key operations |
| `keys` | `KeyPair` | One of signer/keys | Direct keypair (legacy) |
| `relays` | `string[]` | No | Nostr relay URLs |
| `keyID` | `string` | No | Load a previously saved keypair by ID |
| `storageType` | `"node" \| "browser"` | No | Storage type hint |
| `allowInsecureStorage` | `boolean` | No | Allow unencrypted browser storage |

## API Reference

### Static methods

#### `Pocket.create()`

```ts
static async create(config: PocketConfig): Promise<Pocket>
```

Creates and fully initializes a Pocket. This is the recommended way to instantiate.

```ts
const pocket = await Pocket.create({
  signer: new KeySigner(secretKey),
  storage: new NodeStore(".pocket"),
  relays: ["wss://relay.damus.io"],
});
```

### Balance & query

#### `getBalance()`

```ts
getBalance(issuer: string, setID: string): number | undefined
```

Returns the fungible token balance for a given issuer and set ID. Use `"-"` as the default set ID.

```ts
const balance = pocket.getBalance(forgePubkey, "-");
```

#### `getToken()`

```ts
getToken(issuer: string, tokenHash: string): string | undefined
```

Retrieves a token JWT by issuer public key and token hash.

#### `getTAT()`

```ts
getTAT(issuer: string, tokenID: string): string | undefined
```

Retrieves a TAT's token hash by issuer and token ID.

```ts
const hash = pocket.getTAT(forgePubkey, "ticket-001");
if (hash) {
  const jwt = pocket.getToken(forgePubkey, hash);
}
```

#### `getTokenIndex()`

```ts
getTokenIndex(issuer: string, denomination: number): string[] | undefined
```

Returns token hashes for a specific denomination from a given issuer.

#### `getState()`

```ts
getState(): PocketState
```

Returns the complete internal state including all tokens, balances, keys, and subscriptions.

### Transfers

#### `transfer()`

```ts
async transfer(
  issuer: string,
  to: string,
  amount: number,
  changeKey?: string
): Promise<unknown>
```

Transfers fungible tokens to a recipient address. The Pocket selects tokens, builds the transaction, signs witness data, and sends it to the Forge.

```ts
const bobAddress = await bob.getNewReceiveAddress();
await alice.transfer(forgePubkey, bobAddress, 500);
```

The Forge handles change automatically — if you spend a 100-unit token to send 60, you receive a 40-unit change token.

#### `sendTAT()`

```ts
async sendTAT(
  issuer: string,
  to: string,
  tokenID: string
): Promise<unknown>
```

Transfers a TAT (non-fungible token) to a recipient.

```ts
await pocket.sendTAT(forgePubkey, recipientAddress, "ticket-001");
```

#### `sendTx()`

```ts
async sendTx(
  method: string,
  issuer: string,
  tx: TransactionData
): Promise<unknown>
```

Low-level method to send a signed transaction to a Forge. Used internally by `transfer()` and `sendTAT()`.

#### `sendRequestWithSingleUseKey()`

```ts
async sendRequestWithSingleUseKey(
  method: string,
  tx: unknown,
  forgePubkey: string,
  responseTimeoutMs?: number // default: 10000
): Promise<unknown>
```

Sends a request using an ephemeral single-use key and waits for the response. Useful for anonymous interactions.

### Addresses

#### `getNewReceiveAddress()`

```ts
async getNewReceiveAddress(): Promise<string>
```

Generates a new single-use receiving address (public key). Each address should only be used once for privacy — the Pocket derives a new keypair for each address using HD key derivation.

```ts
const address = await pocket.getNewReceiveAddress();
// Share this address with the sender
```

### Subscriptions

#### `subscribe()`

```ts
async subscribe(
  pubkey: string,
  handler?: (event: NDKEvent) => Promise<void>
): Promise<any>
```

Subscribes to encrypted events from a specific public key. The Pocket uses this internally to listen for incoming tokens.

## PocketState

The Pocket persists this state:

| Property | Type | Description |
|----------|------|-------------|
| `tokens` | `Map<issuer, Map<hash, jwt>>` | All stored tokens by issuer |
| `balances` | `Map<issuer, Map<setID, number>>` | Fungible balances by issuer |
| `tokenIndex` | `Map<issuer, Map<denomination, hash[]>>` | Token lookup by amount |
| `tatIndex` | `Map<issuer, Map<tokenID, hash>>` | TAT lookup by ID |
| `singleUseKeys` | `Map<pubkey, SingleUseKey>` | Derived receive keys |
| `hdMasterKey` | `HDKeys` | HD master key for derivation |
| `favorites` | `string[]` | Favorited issuer keys |
| `connected` | `boolean` | Relay connection status |

## Related

- [Forge](/sdk/forge) — the issuer that mints tokens for Pockets
- [Storage](/sdk/storage) — persistence backends
- [Signers](/sdk/signers) — key management adapters
- [Mint & Transfer guide](/guides/mint-and-transfer)
