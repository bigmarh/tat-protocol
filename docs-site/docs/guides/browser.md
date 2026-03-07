# Browser Integration

TAT Protocol works in browsers using NIP-07 signer extensions for key management. The user's private key never leaves their browser extension.

## Supported extensions

- [NostrPass](https://nostrpass.com)
- [Alby](https://getalby.com)
- [nos2x](https://github.com/nicbus/nos2x)
- [Flamingo](https://www.flamingo.com)

## Create a Pocket in the browser

The simplest approach — use the TDK factory:

```ts
import { createPocketWithNIP07, BrowserStore } from "@tat-protocol/tdk";

try {
  const pocket = await createPocketWithNIP07({
    storage: new BrowserStore(),
    relays: ["wss://relay.damus.io"],
  });

  console.log("Connected as:", pocket.getPublicKey());
} catch (err) {
  console.error("No Nostr extension found. Please install NostrPass or Alby.");
}
```

## Check for extension availability

Some extensions load asynchronously after the page. Use `waitForNIP07` to poll:

```ts
import { isNIP07Available, waitForNIP07 } from "@tat-protocol/tdk";

// Synchronous check
if (isNIP07Available()) {
  // Extension is ready
}

// Async check with timeout (waits up to 5 seconds)
const available = await waitForNIP07(5000);
if (available) {
  // Extension loaded
} else {
  // Show install prompt
}
```

## Environment-agnostic code

Use `detectSigner` to write code that works in both browser and server:

```ts
import { detectSigner, Pocket, BrowserStore, NodeStore } from "@tat-protocol/tdk";

const isServer = typeof window === "undefined";

const signer = await detectSigner(
  isServer ? process.env.SECRET_KEY : undefined
);

const storage = isServer
  ? new NodeStore(".pocket")
  : new BrowserStore();

const pocket = await Pocket.create({
  signer,
  storage,
  relays: ["wss://relay.damus.io"],
});
```

## BrowserStore

`BrowserStore` uses the browser's `localStorage` for persistence:

```ts
import { BrowserStore } from "@tat-protocol/tdk";

const storage = new BrowserStore();
```

::: warning
Browser storage is not encrypted by default. Token JWTs are stored in localStorage. For sensitive applications, consider additional encryption layers.
:::

## NIP-07 Signer details

The `NIP07Signer` class delegates all operations to the browser extension:

```ts
import { NIP07Signer } from "@tat-protocol/tdk";

const signer = new NIP07Signer();

// All operations prompt the user via the extension
const pubkey = await signer.getPublicKey();
const signed = await signer.signEvent(event);
const encrypted = await signer.nip44.encrypt(recipientPk, "hello");
```

- `getPublicKey()` is cached after the first call
- `signEvent()` prompts the user for approval
- NIP-44 encryption is preferred, with NIP-04 fallback for older extensions

## Next steps

- [Signers API Reference](/sdk/signers) — full signer documentation
- [TDK Factory Functions](/sdk/tdk) — all factory helpers
- [Key Management](/deployment/key-management) — security best practices
