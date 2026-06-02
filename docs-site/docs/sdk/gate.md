# Gate

> `@tat-protocol/gate` — Token verification and access control at entry points.

## Installation

```bash
npm install @tat-protocol/gate
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

The Gate is a **verifier** that validates tokens at entry points — event doors, API endpoints, content gates. It supports pluggable validation strategies, access policies, and blacklists with built-in analytics.

The typical flow is: **challenge → proof → validate → grant/deny**.

## Validation strategies

| Strategy           | Description                                      |
| ------------------ | ------------------------------------------------ |
| `SINGLE_USE`       | Token can only be used once (event tickets)      |
| `MULTI_ENTRY`      | Token can be used multiple times (season passes) |
| `TIME_BASED`       | Token valid during specific time windows         |
| `SCAN_IN_OUT`      | Track entry/exit (capacity management)           |
| `CAPACITY_LIMITED` | Max concurrent entries                           |
| `CUSTOM`           | Implement your own logic                         |

Built-in factory helpers cover common cases:

```ts
import {
  singleUse,
  multiUse,
  timeWindow,
  allOf,
  createAccessPolicy,
} from "@tat-protocol/gate";

const strategy = allOf([
  singleUse(),
  timeWindow({ startsAt: eventStartMs, endsAt: eventEndMs }),
]);

const policy = createAccessPolicy({
  name: "VIP door",
  allowedIssuers: [ticketForgePubkey],
  requireValidSignature: true,
  requireNotExpired: true,
});
```

## API Reference

### GateBase

Abstract base class for all gate implementations.

#### `initialize()`

```ts
async initialize(): Promise<void>
```

Load state from storage and set up the gate.

#### `validateToken()`

```ts
async validateToken(
  tokenJWT: string,
  context?: ValidationContext
): Promise<ValidationResult>
```

Full validation flow: structure check, signature verification, policy evaluation, strategy validation, and optional forge verification.

```ts
const result = await gate.validateToken(tokenJWT, {
  gateId: "main-entrance",
  location: "Hall A",
});

if (result.valid) {
  console.log("Access granted");
} else {
  console.log("Denied:", result.reason);
}
```

#### `grantAccess()`

```ts
async grantAccess(
  tokenJWT: string,
  context?: ValidationContext
): Promise<boolean>
```

Validates the token **and** consumes it (marks as used). Use this for single-use tokens like event tickets.

#### `verifyToken()`

```ts
async verifyToken(
  tokenJWT: string,
  context?: ValidationContext
): Promise<boolean>
```

Validates the token **without** consuming it. Use for read-only checks.

#### `getAttempts()`

```ts
async getAttempts(
  startTime: number,
  endTime: number
): Promise<AccessAttempt[]>
```

Get all access attempts within a time range.

#### `getAnalytics()`

```ts
async getAnalytics(
  startTime: number,
  endTime: number
): Promise<AccessAnalytics>
```

Get aggregated analytics: total/successful/failed attempts, unique holders, peak hours, top issuers.

#### `getRedemption()`

```ts
async getRedemption(tokenHash: string): Promise<Redemption | undefined>
```

Get the redemption record for a token.

#### `isRedeemed()`

```ts
async isRedeemed(tokenHash: string): Promise<boolean>
```

#### Blacklist management

```ts
async blockToken(tokenHash: string): Promise<void>
async unblockToken(tokenHash: string): Promise<void>
isTokenBlocked(tokenHash: string): boolean
```

#### Strategy & policy

```ts
setValidationStrategy(strategy: ValidationStrategyInterface): void
setAccessPolicy(policy: AccessPolicyInterface): void
getValidationStrategy(): ValidationStrategyInterface | undefined
getAccessPolicy(): AccessPolicyInterface | undefined
```

### GateServerSpec

NWPC-compatible gate server that handles network requests.

```ts
const gate = await GateServerSpec.create({
  storage: new NodeStore(".gate"),
  signer: new KeySigner(secretKey),
  relays: ["wss://relay.damus.io"],
});
```

#### `issueChallenge()`

```ts
issueChallenge(
  resource: string,
  requirements: TurnstileRequirements,
  requester: string
): TurnstileChallenge
```

Issue an access challenge to a token holder.

#### `verifySession()`

```ts
verifySession(sessionToken: string): boolean
```

Verify a session token is still valid.

## Key interfaces

### ValidationResult

```ts
interface ValidationResult {
  valid: boolean;
  token?: Token;
  reason?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

### ValidationContext

```ts
interface ValidationContext {
  gateId?: string;
  location?: string;
  timestamp?: number;
  holder?: string;
  customData?: Record<string, unknown>;
}
```

### AccessPolicy

```ts
interface AccessPolicy {
  name: string;
  allowedIssuers?: string[];
  blockedIssuers?: string[];
  blockedTokens?: string[];
  requireValidSignature: boolean;
  requireNotExpired: boolean;
  requireNotSpent?: boolean;
  maxCapacity?: number;
  operatingHours?: { start: string; end: string; timezone?: string };
  customRules?: Array<{
    name: string;
    check: (
      token: Token,
      context?: Record<string, unknown>,
    ) => Promise<boolean>;
  }>;
}
```

### ValidationStrategyInterface

Implement this to create custom validation logic:

```ts
interface ValidationStrategyInterface {
  readonly type: ValidationStrategy;
  validate(
    token: Token,
    context?: ValidationContext,
  ): Promise<ValidationResult>;
  consume(token: Token, context?: ValidationContext): Promise<boolean>;
  canUse(token: Token): Promise<boolean>;
  getUsage(tokenHash: string): Promise<{ uses: number; lastUsed?: number }>;
  reset(tokenHash: string): Promise<boolean>;
}
```

## GateState

| Property        | Type                         | Description              |
| --------------- | ---------------------------- | ------------------------ |
| `attempts`      | `Map<string, AccessAttempt>` | All access attempts      |
| `redemptions`   | `Map<string, Redemption>`    | Redeemed tokens          |
| `blockedTokens` | `Set<string>`                | Blacklisted token hashes |

## Related

- [Access Control guide](/guides/access-control) — step-by-step walkthrough
- [Token](/sdk/token) — token validation and locks
- [Gate Protocol Spec](/spec/extensions) — NWPC methods
