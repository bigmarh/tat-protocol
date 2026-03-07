# Event Ticketing with TATs

TATs (Transferable Access Tokens) are non-fungible tokens — each one is unique with its own `tokenID` and metadata. This makes them ideal for event tickets, memberships, and access badges.

## Create a TAT Forge

Use `createTATForgeWithKey` instead of `createFungibleForgeWithKey`:

```ts
import {
  createTATForgeWithKey,
  createPocketWithKey,
  NodeStore,
  generateSecretKey,
  getPublicKey,
} from "@tat-protocol/tdk";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const forgeSk = bytesToHex(generateSecretKey());
const forgePk = getPublicKey(hexToBytes(forgeSk));

const ticketForge = await createTATForgeWithKey({
  secretKey: forgeSk,
  owner: forgePk,
  storage: new NodeStore(".tickets"),
  relays: ["wss://relay.damus.io"],
});
```

## Mint a ticket

Each TAT has a unique `tokenID` and can carry arbitrary metadata in the `ext` field:

```ts
const attendee = await createPocketWithKey({
  secretKey: bytesToHex(generateSecretKey()),
  storage: new NodeStore(".attendee"),
  relays: ["wss://relay.damus.io"],
});

const address = await attendee.getNewReceiveAddress();

await ticketForge.forgeToken(address, 1, {
  tokenID: "ticket-vip-001",
  ext: {
    event: "Nostr Summit 2026",
    seat: "VIP Section A, Row 1, Seat 5",
    date: "2026-06-15T19:00:00Z",
    venue: "Convention Center",
    tier: "VIP",
  },
});
```

## Read ticket metadata

After receiving the TAT, the Pocket can look it up by `tokenID`:

```ts
await new Promise((r) => setTimeout(r, 3000));

// Look up TAT by tokenID
const tokenHash = attendee.getTAT(forgePk, "ticket-vip-001");
if (tokenHash) {
  const jwt = attendee.getToken(forgePk, tokenHash);
  console.log("Ticket received:", tokenHash);
}
```

## Transfer a ticket

TATs can be transferred to another Pocket just like fungible tokens:

```ts
const friend = await createPocketWithKey({
  secretKey: bytesToHex(generateSecretKey()),
  storage: new NodeStore(".friend"),
  relays: ["wss://relay.damus.io"],
});

const friendAddress = await friend.getNewReceiveAddress();
await attendee.sendTAT(forgePk, friendAddress, "ticket-vip-001");
```

## Membership tokens with expiration

Use the `exp` field to create time-limited tokens:

```ts
const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

await ticketForge.forgeToken(address, 1, {
  tokenID: `member-${userId}`,
  exp: oneYear,
  ext: {
    membershipType: "Premium",
    benefits: ["Exclusive content", "Priority support", "Early access"],
    startDate: new Date().toISOString(),
  },
});
```

## Batch minting

Mint multiple tickets in a loop for an event:

```ts
const seats = ["A1", "A2", "A3", "B1", "B2", "B3"];

for (const seat of seats) {
  const addr = await attendee.getNewReceiveAddress();
  await ticketForge.forgeToken(addr, 1, {
    tokenID: `concert-2026-${seat}`,
    ext: {
      event: "Summer Concert",
      seat,
      date: "2026-08-01T20:00:00Z",
    },
  });
}
```

## Verify a ticket with Gate

To scan tickets at the door, use a [Gate](/sdk/gate). See the [Access Control guide](/guides/access-control) for a complete walkthrough.

## Next steps

- [Access Control with Gate](/guides/access-control) — verify tokens at entry points
- [Token API Reference](/sdk/token) — token format, locks, and validation
- [Forge API Reference](/sdk/forge) — all minting options
