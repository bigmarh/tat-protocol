# Mint & Transfer Tokens

This guide walks through a complete fungible token flow: creating a Forge, setting up multiple wallets, minting tokens, and transferring between users.

## Setup

```ts
import {
  createFungibleForgeWithKey,
  createPocketWithKey,
  NodeStore,
  generateSecretKey,
  getPublicKey,
} from "@tat-protocol/tdk";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const relays = ["wss://relay.damus.io", "wss://relay.nostr.band"];

// Generate keys
const bankSk = bytesToHex(generateSecretKey());
const bankPk = getPublicKey(hexToBytes(bankSk));

const aliceSk = bytesToHex(generateSecretKey());
const bobSk = bytesToHex(generateSecretKey());
```

## Create the Forge (central bank)

The Forge acts as the token issuer. It controls minting, validates transfers, and tracks spent tokens.

```ts
const bank = await createFungibleForgeWithKey({
  secretKey: bankSk,
  owner: bankPk,
  storage: new NodeStore(".bank"),
  relays,
  totalSupply: 1_000_000,
});

console.log("Bank pubkey:", bank.getPublicKey());
```

## Create wallets

Each user gets a Pocket — a wallet that holds tokens and builds transfer transactions.

```ts
const alice = await createPocketWithKey({
  secretKey: aliceSk,
  storage: new NodeStore(".alice"),
  relays,
});

const bob = await createPocketWithKey({
  secretKey: bobSk,
  storage: new NodeStore(".bob"),
  relays,
});
```

## Mint tokens to Alice

Generate a receive address and mint tokens. The address is a single-use public key — each address can only be used once for privacy.

```ts
const aliceAddress = await alice.getNewReceiveAddress();
await bank.forgeToken(aliceAddress, 5000);

// Wait for encrypted relay delivery
await new Promise((r) => setTimeout(r, 3000));

const aliceBalance = alice.getBalance(bankPk, "-");
console.log("Alice balance:", aliceBalance); // 5000
```

## Transfer from Alice to Bob

Alice sends 1000 tokens to Bob. Under the hood:
1. Alice's Pocket sends a transfer request to the Forge
2. The Forge validates the tokens and marks them as spent
3. The Forge mints new tokens: 1000 for Bob, change tokens for Alice

```ts
const bobAddress = await bob.getNewReceiveAddress();
await alice.transfer(bankPk, bobAddress, 1000);

// Wait for relay delivery
await new Promise((r) => setTimeout(r, 3000));

console.log("Alice balance:", alice.getBalance(bankPk, "-")); // 4000
console.log("Bob balance:", bob.getBalance(bankPk, "-"));     // 1000
```

## Error handling

```ts
try {
  await alice.transfer(bankPk, bobAddress, 1_000_000);
} catch (error) {
  // Insufficient balance — Alice only has 4000
  console.error("Transfer failed:", error.message);
}
```

Common error scenarios:

| Error | Cause |
|-------|-------|
| Insufficient balance | Trying to send more than the wallet holds |
| Token already spent | Double-spend attempt (token was already transferred) |
| Supply limit | Forge has reached its `totalSupply` cap |

## Check wallet state

```ts
const state = alice.getState();

// Iterate over tokens by issuer
for (const [issuer, tokens] of state.tokens) {
  console.log(`Issuer: ${issuer}`);
  for (const [hash, jwt] of tokens) {
    console.log(`  Token: ${hash.slice(0, 16)}...`);
  }
}
```

## Next steps

- [Event Ticketing](/guides/event-ticketing) — mint unique TATs
- [Forge API Reference](/sdk/forge) — all Forge methods and config
- [Pocket API Reference](/sdk/pocket) — all Pocket methods and state
