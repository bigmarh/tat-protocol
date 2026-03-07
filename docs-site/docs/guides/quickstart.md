# Quickstart

Get a Forge minting tokens to a Pocket in under 5 minutes.

## Prerequisites

- **Node.js** >= 16
- **pnpm** (or npm/yarn)

## 1. Create a project

```bash
mkdir my-tat-app && cd my-tat-app
pnpm init
pnpm add @tat-protocol/tdk
pnpm add -D typescript tsx @types/node
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

## 2. Write your first token app

Create `index.ts`:

```ts
import {
  createFungibleForgeWithKey,
  createPocketWithKey,
  NodeStore,
  generateSecretKey,
  getPublicKey,
} from "@tat-protocol/tdk";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

async function main() {
  // Generate keys for the Forge (issuer) and Pocket (wallet)
  const forgeSk = bytesToHex(generateSecretKey());
  const forgePk = getPublicKey(hexToBytes(forgeSk));

  const pocketSk = bytesToHex(generateSecretKey());

  // Create a Forge — the token issuer
  const forge = await createFungibleForgeWithKey({
    secretKey: forgeSk,
    owner: forgePk,
    storage: new NodeStore(".forge"),
    relays: ["wss://relay.damus.io"],
    totalSupply: 1_000,
  });

  console.log("Forge ready:", forge.getPublicKey());

  // Create a Pocket — the wallet
  const pocket = await createPocketWithKey({
    secretKey: pocketSk,
    storage: new NodeStore(".pocket"),
    relays: ["wss://relay.damus.io"],
  });

  console.log("Pocket ready:", pocket.getPublicKey());

  // Get a receiving address and mint tokens
  const address = await pocket.getNewReceiveAddress();
  await forge.forgeToken(address, 100);

  // Wait for delivery over Nostr relays
  await new Promise((r) => setTimeout(r, 3000));

  // Check balance
  const balance = pocket.getBalance(forgePk, "-");
  console.log("Pocket balance:", balance);

  process.exit(0);
}

main().catch(console.error);
```

## 3. Run it

```bash
pnpm tsx index.ts
```

Expected output:

```
Forge ready: abc123...
Pocket ready: def456...
Pocket balance: 100
```

## What just happened?

1. You created a **Forge** — a token issuer that mints and validates tokens
2. You created a **Pocket** — a wallet that holds and transfers tokens
3. The Forge minted 100 fungible tokens and sent them to the Pocket over an encrypted Nostr relay connection
4. The Pocket received and stored the tokens

## Next steps

- [Mint & Transfer Tokens](/guides/mint-and-transfer) — multi-wallet transfers with Alice and Bob
- [Event Ticketing](/guides/event-ticketing) — mint unique TATs for tickets and memberships
- [SDK Reference](/sdk/packages) — full API documentation
