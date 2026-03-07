# @tat-protocol/utils

Shared cryptography, Nostr, data-serialization, and logging helpers.

## Install

```bash
npm install @tat-protocol/utils
```

## Common Exports

- Crypto: `createHash`, `signMessage`, `verifySignature`
- Nostr helpers: `Wrap`, `Unwrap`, NIP-44 wrappers
- State helpers: `serializeData`, `deserializeData`
- Observability: `DebugLogger`
- Data structures: `BloomFilter`

## Example

```ts
import { DebugLogger, createHash } from "@tat-protocol/utils";

const Debug = DebugLogger.getInstance();
Debug.enableAll();

const hash = await createHash("hello");
Debug.log(`hash-bytes=${hash.length}`, "example");
```

## Notes

This package is intentionally low-level and reused by most protocol modules.
