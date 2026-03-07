# Storage

> `@tat-protocol/storage` — Pluggable persistence with `NodeStore` (server) and `BrowserStore` (browser).

## Installation

```bash
npm install @tat-protocol/storage
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

Every TAT Protocol component (Forge, Pocket, Gate, Booth) needs persistent storage for state data — tokens, balances, spent sets, keys. The storage package provides a common interface with two implementations.

## Choosing a backend

| Backend | Environment | Persistence |
|---------|-------------|-------------|
| `NodeStore` | Node.js (servers, CLI) | File-based (directory on disk) |
| `BrowserStore` | Browser | `localStorage` |

## NodeStore

File-based storage for server environments.

```ts
import { NodeStore } from "@tat-protocol/storage";

const storage = new NodeStore(".pocket");
```

The path argument is the directory where state files are stored. It will be created if it doesn't exist.

## BrowserStore

`localStorage`-based storage for browser environments.

```ts
import { BrowserStore } from "@tat-protocol/storage";

const storage = new BrowserStore();
```

::: warning
Browser storage is not encrypted by default. For production browser apps with sensitive token data, consider additional encryption.
:::

## StorageInterface

Both backends implement this interface:

```ts
interface StorageInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

All methods are async (Promise-based). Values are serialized as strings.

## Custom backends

Implement `StorageInterface` for custom persistence (e.g., Redis, SQLite, encrypted storage):

```ts
class RedisStore implements StorageInterface {
  async getItem(key: string) { /* ... */ }
  async setItem(key: string, value: string) { /* ... */ }
  async removeItem(key: string) { /* ... */ }
  async clear() { /* ... */ }
}
```

## Best practices

- Keep storage directories **isolated per component** (separate directories for Forge, Pocket, Gate)
- Set appropriate **file permissions** on NodeStore directories (`chmod 700`)
- In production, consider **encrypted storage** for sensitive key material

## Related

- [Pocket](/sdk/pocket) — uses storage for token state
- [Forge](/sdk/forge) — uses storage for spent-token tracking
- [Key Management](/deployment/key-management) — securing stored keys
