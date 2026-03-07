# @tat-protocol/signers

Signer implementations for server and browser runtimes.

## Install

```bash
npm install @tat-protocol/signers
```

## Exports

- `KeySigner` (server/key-managed signing)
- `NIP07Signer` (browser extension signing)
- `isNIP07Available`
- `waitForNIP07`

## Quick Start

### Server / backend

```ts
import { KeySigner } from "@tat-protocol/signers";

const signer = new KeySigner(process.env.SECRET_KEY_HEX!);
const pubkey = await signer.getPublicKey();
```

### Browser with NIP-07

```ts
import { NIP07Signer, waitForNIP07 } from "@tat-protocol/signers";

if (await waitForNIP07(5000)) {
  const signer = new NIP07Signer();
  console.log(await signer.getPublicKey());
}
```

## Choosing a Signer

- Use `KeySigner` for CI, servers, and controlled key custody.
- Use `NIP07Signer` for user-controlled browser wallets.
