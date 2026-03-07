# Access Control with Gate

The Gate component verifies tokens at entry points — event doors, API endpoints, content gates. This guide walks through setting up a Gate and validating tokens.

## Create a Gate

```ts
import { GateBase, NodeStore, KeySigner, Token } from "@tat-protocol/tdk";

// Simple in-process gate
const gate = new GateBase({
  storage: new NodeStore(".gate"),
});
await gate.initialize();
```

For a network-connected gate that communicates with Forges:

```ts
import { GateServerSpec, NodeStore, KeySigner } from "@tat-protocol/tdk";

const gate = await GateServerSpec.create({
  storage: new NodeStore(".gate"),
  signer: new KeySigner(process.env.GATE_SK!),
  relays: ["wss://relay.damus.io"],
});
```

## Validate a token

The simplest check — is this token valid?

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

## Single-use redemption

For tokens that should only work once (event tickets):

```ts
const granted = await gate.grantAccess(tokenJWT, {
  gateId: "door-1",
});

if (granted) {
  // Token is now consumed — can't be used again
  console.log("Welcome!");
} else {
  console.log("Invalid or already used");
}
```

## Read-only verification

Check a token without consuming it:

```ts
const valid = await gate.verifyToken(tokenJWT);
// Token can still be used later
```

## Access policies

Configure rules for which tokens to accept:

```ts
gate.setAccessPolicy({
  policy: {
    name: "Concert 2026",
    allowedIssuers: [forgePubkey],          // Only accept tokens from this forge
    requireValidSignature: true,
    requireNotExpired: true,
    requireNotSpent: true,
    operatingHours: {
      start: "18:00",
      end: "23:59",
      timezone: "America/New_York",
    },
    maxCapacity: 500,
  },
  // Implement required interface methods...
  evaluate: async (token, context) => ({ allowed: true }),
  isIssuerAllowed: (issuer) => issuer === forgePubkey,
  isTokenBlocked: (hash) => false,
  addAllowedIssuer: () => {},
  removeAllowedIssuer: () => {},
  blockToken: () => {},
  unblockToken: () => {},
  updatePolicy: () => {},
  isWithinOperatingHours: () => true,
});
```

## Blacklist tokens

Block specific tokens (e.g., reported stolen):

```ts
await gate.blockToken(tokenHash);

// Later, unblock if needed
await gate.unblockToken(tokenHash);

// Check status
gate.isTokenBlocked(tokenHash); // true/false
```

## Analytics

Track access patterns:

```ts
const now = Date.now();
const oneHourAgo = now - 60 * 60 * 1000;

const analytics = await gate.getAnalytics(oneHourAgo, now);
console.log("Total attempts:", analytics.totalAttempts);
console.log("Successful:", analytics.successfulAttempts);
console.log("Failed:", analytics.failedAttempts);
console.log("Unique holders:", analytics.uniqueHolders);
```

## Check redemption status

```ts
const redeemed = await gate.isRedeemed(tokenHash);
const record = await gate.getRedemption(tokenHash);
if (record) {
  console.log("Redeemed at:", new Date(record.redeemedAt));
  console.log("Uses:", record.uses);
}
```

## Next steps

- [Gate API Reference](/sdk/gate) — full API documentation
- [Event Ticketing guide](/guides/event-ticketing) — mint tickets to verify
- [Security Model](/spec/security) — threat model and protections
