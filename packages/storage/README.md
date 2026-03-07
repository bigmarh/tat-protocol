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

- `NodeStore` supports optional AES-GCM encryption when `TAT_STORAGE_ENCRYPTION_KEY` is set.
- Use separate directories per service (`.forge`, `.pocket`, `.gate`, `.booth`) for safer operations.
