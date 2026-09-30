# @tat-protocol/storage

Storage abstractions and backends for Node.js and browser environments.

## Install

```bash
npm install @tat-protocol/storage
```

## Exports

- `Storage` (backend wrapper)
- `NodeStore` (filesystem-backed storage)
- `BrowserStore` (localStorage-backed storage)
- `StorageInterface`

## Quick Start

### Node.js

```ts
import { Storage, NodeStore } from "@tat-protocol/storage";

const storage = new Storage(new NodeStore(".tat-state"));
await storage.setItem("example", JSON.stringify({ ok: true }));
```

### Browser

```ts
import { Storage, BrowserStore } from "@tat-protocol/storage";

const storage = new Storage(new BrowserStore());
await storage.setItem("example", JSON.stringify({ ok: true }));
```

## Security Notes

- `NodeStore` and `BrowserStore` **encrypt every value by default** (AES-256-GCM, key from PBKDF2-SHA256 over a passphrase and a per-store salt). Pass `{ passphrase }` or a raw 32-byte `{ key }`; `NodeStore` also reads `TAT_STORAGE_ENCRYPTION_KEY`. With no key the constructor throws unless you pass `{ allowPlaintext: true }`.
- An encrypting store **refuses to read plaintext** it finds. To adopt existing unencrypted (or old `enc:v1`) data, run `migratePlaintext()` once. Back up the salt file (`.tat-kdf-salt` / the `__tat_kdf_salt__` key) with the data.
- `EncryptedStorage` wraps any other `StorageInterface` backend with the same encryption.
- A forge will not persist a generated key, and a Pocket will not keep its keys and mnemonic, in storage whose `encryptsAtRest` is not `true` (override: `allowPlaintextSecrets` / `allowInsecureStorage`).
- Use separate directories per service (`.forge`, `.pocket`, `.gate`, `.booth`) for safer operations.
