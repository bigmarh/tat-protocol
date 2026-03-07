# @tat-protocol/types

Shared TypeScript interfaces for signer abstractions and Nostr event shapes.

## Install

```bash
npm install @tat-protocol/types
```

## Exports

- `Signer`
- `UnsignedNostrEvent`
- `NostrEvent`

## Usage

```ts
import type { Signer, UnsignedNostrEvent } from "@tat-protocol/types";

async function signPing(signer: Signer): Promise<string> {
  const event: UnsignedNostrEvent = {
    kind: 1,
    content: "ping",
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signer.signEvent(event);
  return signed.id;
}
```
