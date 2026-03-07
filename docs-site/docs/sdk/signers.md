# Signers

> `@tat-protocol/signers` — `KeySigner` (server) and `NIP07Signer` (browser extension) adapters.

## Installation

```bash
npm install @tat-protocol/signers
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

Signers abstract away key management. Every TAT Protocol component (Forge, Pocket, Gate, Booth) needs a signer for:

- **Signing** Nostr events and token data (Schnorr)
- **Encrypting/decrypting** messages (NIP-44)
- **Public key** retrieval

Choose the right signer based on your environment:

| Environment | Signer | Key location |
|-------------|--------|--------------|
| Server (Node.js) | `KeySigner` | In memory (from env/config) |
| Browser | `NIP07Signer` | Browser extension (NostrPass, Alby, nos2x) |
| Auto-detect | `detectSigner()` | Best available |

## KeySigner

Direct key access. Use on servers where you control the key.

```ts
import { KeySigner } from "@tat-protocol/signers";

const signer = new KeySigner(process.env.SECRET_KEY!);
```

### Constructor

```ts
new KeySigner(secretKey: string | Uint8Array)
```

Accepts a hex string or raw bytes.

### Methods

```ts
async getPublicKey(): Promise<string>
async sign(message: Uint8Array): Promise<string>
async signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>

// NIP-44 encryption
signer.nip44.encrypt(recipientPubkey: string, plaintext: string): Promise<string>
signer.nip44.decrypt(senderPubkey: string, ciphertext: string): Promise<string>
```

## NIP07Signer

Uses a browser extension (NostrPass, Alby, nos2x, Flamingo) for signing. The private key **never leaves the extension**.

```ts
import { NIP07Signer } from "@tat-protocol/signers";

const signer = new NIP07Signer();
```

### Methods

```ts
async getPublicKey(): Promise<string>   // Cached after first call
async sign(message: Uint8Array): Promise<string>
async signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>

// NIP-44 encryption (falls back to NIP-04 if needed)
signer.nip44.encrypt(recipientPubkey: string, plaintext: string): Promise<string>
signer.nip44.decrypt(senderPubkey: string, ciphertext: string): Promise<string>
```

## Utility functions

### `isNIP07Available()`

```ts
function isNIP07Available(): boolean
```

Synchronously check if a NIP-07 extension is available in the current environment.

### `waitForNIP07()`

```ts
async function waitForNIP07(timeoutMs?: number): Promise<boolean>
```

Poll for a NIP-07 extension to be injected. Some extensions load asynchronously after the page. Default timeout: 3000ms, polls every 100ms.

```ts
const available = await waitForNIP07(5000);
if (available) {
  const signer = new NIP07Signer();
}
```

## Signer interface

All signers implement this interface from `@tat-protocol/types`:

```ts
interface Signer {
  getPublicKey(): Promise<string>;
  sign(message: Uint8Array): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}
```

## Related

- [TDK](/sdk/tdk) — factory functions that handle signer setup
- [Browser Integration guide](/guides/browser) — NIP-07 walkthrough
- [Types](/sdk/types) — `Signer` interface definition
- [Key Management](/deployment/key-management) — security best practices
