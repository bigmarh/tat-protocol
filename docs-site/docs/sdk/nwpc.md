# NWPC

> `@tat-protocol/nwpc` — Encrypted JSON-RPC over Nostr relays with routing, middleware, and introspection.

## Installation

```bash
npm install @tat-protocol/nwpc
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

NWPC (Nostr Wrapped Procedure Call) is the transport layer for all TAT Protocol communication. It provides:

- **JSON-RPC 2.0** request/response semantics
- **NIP-44 encryption** (XChaCha20-Poly1305)
- **NIP-59 gift wrap** (sealed sender privacy)
- **Middleware chains** (Express-like handler pattern)
- **Route metadata** with token authentication and introspection
- **Event deduplication** via hybrid LRU + Bloom filter

You typically don't use NWPC directly — Forge, Pocket, Gate, and Booth extend `NWPCServer` or `NWPCPeer`. But understanding the NWPC layer is important for building custom services.

## Key types

### NWPCRequest

```ts
interface NWPCRequest {
  id: string;         // Unique request ID
  method: string;     // Method to call (e.g. "forge", "transfer")
  params: string;     // JSON-encoded parameters
  timestamp: number;  // Request timestamp
}
```

### NWPCResponse

```ts
interface NWPCResponse {
  id: string;                    // Matches request ID
  result?: unknown;              // Success result
  error?: {
    code: number;
    message: string;
    params?: string;
  };
  timestamp: number;
}
```

### NWPCContext

```ts
interface NWPCContext {
  event: NDKEvent;           // Raw Nostr event
  poster: string;            // Event author's pubkey
  sender: string;            // Envelope signer's pubkey
  recipient: string;         // Recipient's pubkey
  validatedToken?: unknown;  // Set by auth middleware
  paymentToken?: unknown;    // Payment token to spend after handler
  paymentCost?: number;      // Amount to deduct
}
```

### NWPCHandler

```ts
type NWPCHandler = (
  request: NWPCRequest,
  context: NWPCContext,
  res: NWPCResponseObject,
  next: () => Promise<void>
) => Promise<NWPCResponse | void>;
```

Handlers follow an Express-like middleware pattern. Call `next()` to pass to the next handler, or use `res.send()` / `res.error()` to respond.

## NWPCConfig

| Property | Type | Description |
|----------|------|-------------|
| `storage` | `StorageInterface` | Required storage backend |
| `signer` | `Signer` | Signer for key management |
| `keys` | `KeyPair` | Direct keypair (legacy) |
| `relays` | `string[]` | Nostr relay URLs |
| `hooks` | `MessageHookOptions` | Pre/post message hooks |
| `requestHandlers` | `Map<string, NWPCHandler>` | Initial handler registrations |
| `introspection` | `NWPCIntrospectionConfig` | Enable API discovery |

## API Reference

### NWPCBase (abstract)

Base class for both server and peer instances.

#### `init()`

```ts
async init(): Promise<void>
```

Initialize the NWPC instance — loads keys, connects to relays, restores state.

#### `connect()`

```ts
async connect(): Promise<NWPCBase>
```

Connect to configured relays.

#### `disconnect()`

```ts
async disconnect(): Promise<void>
```

Disconnect from all relays.

#### `use()`

```ts
use(method: string, ...handlers: NWPCHandler[]): void
```

Register one or more handlers for a method. Handlers execute in order as a middleware chain.

```ts
server.use("myMethod", authMiddleware, myHandler);
```

#### `subscribe()`

```ts
async subscribe(
  pubkey: string,
  handler: (event: NDKEvent) => Promise<void>
): Promise<NDKSubscription>
```

Subscribe to encrypted messages for a specific public key.

#### `unsubscribe()`

```ts
async unsubscribe(pubkey: string): Promise<boolean>
```

#### `getPublicKey()`

```ts
getPublicKey(): string | undefined
```

#### `isEventProcessed()`

```ts
isEventProcessed(eventId: string): boolean
```

Check if an event has already been processed (deduplication).

#### `markEventProcessed()`

```ts
markEventProcessed(eventId: string): void
```

### NWPCServer

Extends `NWPCBase`. Listens for incoming requests and dispatches them to registered handlers.

#### `sendResponse()`

```ts
async sendResponse(
  response: NWPCResponse,
  recipientPubkey: string
): Promise<void>
```

Send an encrypted response to a specific public key.

#### `broadcastResponse()`

```ts
async broadcastResponse(
  response: NWPCResponse,
  recipientPubkeys: string[]
): Promise<void>
```

Send a response to multiple recipients.

### NWPCPeer

Extends `NWPCBase`. Can initiate requests to servers.

#### `request()`

```ts
async request(
  method: string,
  params: Record<string, unknown>,
  recipientPubkey: string,
  senderKeysOrSigner?: KeyPair | Signer,
  timeout?: number
): Promise<NWPCResponse>
```

Send a request to a remote server and await the response.

### NWPCRouter

Routes incoming requests to the appropriate handler chain.

#### `use()`

```ts
use(method: string, ...args: (NWPCHandler | NWPCRouteMetadata)[]): void
```

Register handlers with optional route metadata.

#### `handle()`

```ts
async handle(
  request: NWPCRequest,
  context: NWPCContext,
  res: NWPCResponseObject
): Promise<NWPCResponse>
```

Route a request to its handler chain.

#### `listRoutes()`

```ts
listRoutes(): Array<{ method: string; metadata?: NWPCRouteMetadata }>
```

List all registered routes (useful for introspection).

### NWPCResponseObject

Builder for constructing responses.

```ts
await res.send({ token: jwt });           // Success
await res.error(2003, "Insufficient balance");  // Error
await res.notFound();                      // 1005
await res.badRequest("Missing 'to' field"); // 1001
await res.unauthorized();                  // 2004
await res.internalError();                 // 3000
```

### Route metadata

Annotate routes with metadata for documentation and token authentication:

```ts
server.use("premium.content",
  {
    description: "Get premium content",
    auth: "authenticated",
    tokenAuth: {
      mode: "bearer",
      issuerPubkey: forgePk,
      scopes: ["premium"],
    },
    rateLimit: { requests: 10, windowMs: 60000 },
  } as NWPCRouteMetadata,
  premiumHandler
);
```

## Error codes

### 1000 series — Request errors

| Code | Name | Description |
|------|------|-------------|
| 1000 | PARSE_ERROR | Malformed request |
| 1001 | INVALID_REQUEST | Missing required fields |
| 1002 | METHOD_NOT_FOUND | No handler for method |
| 1003 | INVALID_PARAMS | Bad parameters |
| 1004 | RATE_LIMITED | Too many requests |
| 1005 | NOT_FOUND | Resource not found |

### 2000 series — Token errors

| Code | Name | Description |
|------|------|-------------|
| 2000 | TOKEN_INVALID | Invalid token |
| 2001 | TOKEN_EXPIRED | Token has expired |
| 2002 | TOKEN_SPENT | Token already spent |
| 2003 | INSUFFICIENT_BALANCE | Not enough tokens |
| 2004 | UNAUTHORIZED | Not authorized |
| 2005 | SUPPLY_LIMIT | Supply cap reached |
| 2006 | TOKEN_REQUIRED | Token required for this method |
| 2007 | INSUFFICIENT_SCOPE | Token lacks required scope |
| 2008 | TOKEN_WRONG_AUDIENCE | Token bound to different server |
| 2009 | TOKEN_WRONG_ISSUER | Token from wrong issuer |

### 3000 series — Server errors

| Code | Name | Description |
|------|------|-------------|
| 3000 | INTERNAL_ERROR | Internal server error |

## Related

- [NWPC Protocol Spec](/spec/nwpc) — formal protocol specification
- [Error Codes](/spec/error-codes) — full error code reference
- [Forge](/sdk/forge) — extends NWPCServer
- [Pocket](/sdk/pocket) — extends NWPCPeer
