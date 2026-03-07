# Getting Started with TAT Protocol

Welcome to TAT Protocol! This guide will walk you through creating your first token application in just a few minutes.

## Table of Contents

- [What is TAT Protocol?](#what-is-tat-protocol)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start (5 minutes)](#quick-start-5-minutes)
- [Core Concepts](#core-concepts)
- [Detailed Tutorial](#detailed-tutorial)
- [Next Steps](#next-steps)

---

## What is TAT Protocol?

TAT Protocol is a **decentralized token system** built on [Nostr](https://github.com/nostr-protocol/nostr), enabling:

- **Fungible Tokens** - Like digital cash
- **Non-Fungible Tokens (TATs)** - Unique digital assets
- **End-to-end Encryption** - Private transactions
- **Decentralized** - No central authority
- **Fast & Lightweight** - Built on Nostr infrastructure

### Use Cases

- Digital currencies
- Event ticketing (concerts, conferences)
- Access tokens (memberships, subscriptions)
- Loyalty points
- Digital collectibles
- Proof of attendance (POAPs)

---

## Prerequisites

- **Node.js** >= 16.0.0 ([Download](https://nodejs.org/))
- **pnpm** (recommended) or npm
- Basic TypeScript/JavaScript knowledge
- Text editor or IDE (VS Code recommended)

### Install pnpm (if needed)

```bash
npm install -g pnpm
```

---

## Installation

### Option 1: Install Complete SDK (Recommended)

```bash
npm install @tat-protocol/tdk
```

The TDK (Token Development Kit) includes all TAT Protocol packages in one import.

### Option 2: Install Individual Packages

```bash
npm install @tat-protocol/pocket   # Wallet functionality
npm install @tat-protocol/forge    # Token issuance
npm install @tat-protocol/token    # Token creation/validation
npm install @tat-protocol/storage  # Storage backends
```

---

## Quick Start (5 minutes)

Let's create a simple token system with a mint (Forge) and a wallet (Pocket).

### Step 1: Create a New Project

```bash
mkdir my-tat-app
cd my-tat-app
pnpm init
pnpm add @tat-protocol/tdk
pnpm add --save-dev typescript tsx @types/node
```

### Step 2: Create `tsconfig.json`

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

### Step 3: Create Your First Token App

Create `index.ts`:

```typescript
import {
  createPocketWithKey,
  createFungibleForgeWithKey,
  NodeStore,
  DebugLogger
} from '@tat-protocol/tdk';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Enable debug logging to see what's happening
const Debug = DebugLogger.getInstance();
Debug.enableAll();

async function main() {
  console.log('TAT Protocol - Quick Start\n');

  // Step 1: Generate keys for Forge (mint) and Pocket (wallet)
  const forgeSecretKey = bytesToHex(generateSecretKey());
  const forgePubKey = getPublicKey(hexToBytes(forgeSecretKey));

  const pocketSecretKey = bytesToHex(generateSecretKey());

  console.log('Generated Keys:');
  console.log(`  Forge Public Key: ${forgePubKey}\n`);

  // Step 2: Create a Forge (token issuer)
  const forge = await createFungibleForgeWithKey({
    secretKey: forgeSecretKey,
    owner: forgePubKey,
    storage: new NodeStore('./.forge'),
    relays: ['wss://relay.damus.io'],
    totalSupply: 1000
  });

  console.log('Forge created successfully\n');

  // Step 3: Create a Pocket (wallet)
  const pocket = await createPocketWithKey({
    secretKey: pocketSecretKey,
    storage: new NodeStore('./.pocket'),
    relays: ['wss://relay.damus.io']
  });

  console.log('Pocket created successfully\n');

  // Step 4: Get a receiving address for the pocket
  const receiveAddress = await pocket.getNewReceiveAddress();
  console.log(`Pocket receiving address: ${receiveAddress}\n`);

  // Step 5: Check balance
  const balance = pocket.getBalance(forgePubKey, '-');
  console.log(`Pocket balance: ${balance || 0} tokens\n`);

  // Cleanup
  process.exit(0);
}

main().catch(console.error);
```

### Step 4: Run It!

```bash
pnpm tsx index.ts
```

**Congratulations!** You've just:
1. Created a token mint (Forge)
2. Created a wallet (Pocket)
3. Generated a receiving address

---

## Core Concepts

### 1. Forge (Token Issuer)

The **Forge** is responsible for:
- Minting new tokens
- Validating token transfers
- Tracking spent tokens (double-spend prevention)
- Managing supply limits

```typescript
import { createFungibleForgeWithKey, NodeStore } from '@tat-protocol/tdk';

const forge = await createFungibleForgeWithKey({
  secretKey: process.env.FORGE_SECRET_KEY!,
  owner: process.env.FORGE_OWNER_PUBKEY!,
  storage: new NodeStore('./.forge'),
  relays: ['wss://relay.damus.io'],
  totalSupply: 10000
});
```

### 2. Pocket (Wallet)

The **Pocket** is a wallet that:
- Receives tokens
- Stores tokens securely
- Sends tokens to others
- Manages balances

```typescript
import { createPocketWithKey, NodeStore } from '@tat-protocol/tdk';

const pocket = await createPocketWithKey({
  secretKey: process.env.POCKET_SECRET_KEY!,
  storage: new NodeStore('./.pocket'),
  relays: ['wss://relay.damus.io']
});
```

### 3. Tokens

**Fungible Tokens**: Interchangeable (like cash)
```typescript
// Transfer 50 units
await pocket.transfer(forgePublicKey, recipientAddress, 50);
```

**Non-Fungible Tokens (TATs)**: Unique assets
```typescript
// Transfer specific TAT
await pocket.sendTAT(forgePublicKey, recipientAddress, 'ticket-001');
```

### 4. Storage Backends

Choose a storage backend based on your environment:

**Node.js (Server/Desktop)**
```typescript
import { NodeStore } from '@tat-protocol/storage';
const storage = new NodeStore('./data');
```

**Browser**
```typescript
import { BrowserStore } from '@tat-protocol/storage';
const storage = new BrowserStore();
```

### 5. NWPC (Network Communication)

TAT Protocol uses NWPC (Nostr Wrapped Procedure Call) for secure, encrypted communication:

- All messages are **end-to-end encrypted** (NIP-44)
- **Authenticated** with cryptographic signatures
- **Sealed sender** using gift wrap pattern (NIP-59)
- **Relay agnostic** - works with any Nostr relay

---

## Detailed Tutorial

### Tutorial 1: Create a Digital Currency

Let's create a complete digital currency system.

#### Part 1: Setup

```typescript
import {
  createFungibleForgeWithKey,
  createPocketWithKey,
  NodeStore
} from '@tat-protocol/tdk';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Central bank (forge)
const bankSecretKey = bytesToHex(generateSecretKey());
const bankPubKey = getPublicKey(hexToBytes(bankSecretKey));

// User wallets
const aliceSecretKey = bytesToHex(generateSecretKey());
const bobSecretKey = bytesToHex(generateSecretKey());
```

#### Part 2: Create Central Bank (Forge)

```typescript
const centralBank = await createFungibleForgeWithKey({
  secretKey: bankSecretKey,
  owner: bankPubKey,
  storage: new NodeStore('./.bank'),
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band'],
  totalSupply: 1000000 // 1 million total supply
});

console.log('Central Bank created');
console.log(`  Public Key: ${bankPubKey}`);
```

#### Part 3: Create User Wallets

```typescript
const aliceWallet = await createPocketWithKey({
  secretKey: aliceSecretKey,
  storage: new NodeStore('./.alice'),
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band']
});

const bobWallet = await createPocketWithKey({
  secretKey: bobSecretKey,
  storage: new NodeStore('./.bob'),
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band']
});
```

#### Part 4: Mint Initial Supply

```typescript
// Mint 5000 tokens to Alice
const aliceAddress = await aliceWallet.getNewReceiveAddress();

console.log('Minted 5000 tokens to Alice');

// Wait for message delivery
await new Promise(r => setTimeout(r, 3000));

// Check Alice's balance
const aliceBalance = aliceWallet.getBalance(bankPubKey, '-');
console.log(`  Alice's balance: ${aliceBalance}`);
```

#### Part 5: Transfer Between Users

```typescript
// Alice sends 1000 tokens to Bob
const bobAddress = await bobWallet.getNewReceiveAddress();
await aliceWallet.transfer(bankPubKey, bobAddress, 1000);

console.log('Alice sent 1000 tokens to Bob');

// Wait for message delivery
await new Promise(r => setTimeout(r, 3000));

// Check final balances
const aliceNewBalance = aliceWallet.getBalance(bankPubKey, '-');
const bobBalance = bobWallet.getBalance(bankPubKey, '-');

console.log(`  Alice's new balance: ${aliceNewBalance}`);
console.log(`  Bob's balance: ${bobBalance}`);
```

### Tutorial 2: Event Ticketing System

Create a concert ticketing system with unique tokens.

```typescript
import { createTATForgeWithKey, NodeStore } from '@tat-protocol/tdk';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const forgeSecretKey = bytesToHex(generateSecretKey());
const forgePubKey = getPublicKey(hexToBytes(forgeSecretKey));

// Create ticketing forge
const ticketForge = await createTATForgeWithKey({
  secretKey: forgeSecretKey,
  owner: forgePubKey,
  storage: new NodeStore('./.tickets'),
  relays: ['wss://relay.damus.io']
});

console.log('Ticket forge created');
```

### Tutorial 3: Membership System

Create a membership token that grants access.

```typescript
import { Token } from '@tat-protocol/tdk';

// Verify membership on access
async function checkMembership(
  pocket: Pocket,
  forgePubKey: string,
  tokenID: string
): Promise<boolean> {
  const tokenHash = pocket.getTAT(forgePubKey, tokenID);
  if (!tokenHash) return false;

  const tokenJWT = pocket.getToken(forgePubKey, tokenHash);
  if (!tokenJWT) return false;

  const token = await new Token().restore(tokenJWT);

  // Check expiration
  if (token.payload.exp && Date.now() > token.payload.exp * 1000) {
    return false; // Membership expired
  }

  return true;
}
```

---

## Common Patterns

### Pattern 1: Receive Tokens

```typescript
// Generate a new receiving address
const address = await pocket.getNewReceiveAddress();

// Share this address with the sender
console.log('Send tokens to:', address);

// Check balance after receiving
const balance = pocket.getBalance(issuerPubKey, '-');
```

### Pattern 2: Send Tokens

```typescript
try {
  // Transfer fungible tokens
  const response = await pocket.transfer(
    issuerPubKey,
    recipientAddress,
    amount
  );

  console.log('Transfer successful:', response);
} catch (error) {
  console.error('Transfer failed:', error);
}
```

### Pattern 3: Error Handling

```typescript
try {
  await pocket.transfer(issuerPubKey, recipientAddress, 1000);
} catch (error) {
  if (error.message.includes('insufficient balance')) {
    console.error('Not enough tokens');
  } else if (error.message.includes('spent')) {
    console.error('Token already spent (double-spend attempt)');
  } else {
    console.error('Unknown error:', error);
  }
}
```

### Pattern 4: List All Tokens

```typescript
import { Token } from '@tat-protocol/tdk';

const state = pocket.getState();

// List all issuers
for (const [issuerPubKey, tokens] of state.tokens) {
  console.log(`Issuer: ${issuerPubKey}`);

  // List all tokens from this issuer
  for (const [tokenHash, tokenJWT] of tokens) {
    const token = await new Token().restore(tokenJWT);
    console.log(`  - ${token.payload.amount} tokens (${tokenHash})`);
  }
}
```

---

## Best Practices

### 1. Key Management

```typescript
// DO: Use HD keys for deterministic key generation
import { HDKey } from '@tat-protocol/hdkeys';
const mnemonic = HDKey.generateMnemonic(256);
const seed = await HDKey.mnemonicToSeed(mnemonic);
const master = HDKey.fromMasterSeed(seed);

// DON'T: Generate random keys each time
// const key = generateSecretKey(); // Can't recover if lost!
```

### 2. Error Handling

```typescript
// DO: Handle all errors
try {
  await pocket.transfer(issuer, recipient, amount);
} catch (error) {
  console.error('Transfer failed:', error);
  // Log, retry, or notify user
}

// DON'T: Ignore errors
// await pocket.transfer(issuer, recipient, amount); // Might fail silently!
```

### 3. Relay Configuration

```typescript
// DO: Use multiple relays for redundancy
const relays = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.snort.social'
];

// DON'T: Use single relay (single point of failure)
// relays: ['wss://relay.damus.io']
```

### 4. Token Validation

```typescript
import { Token } from '@tat-protocol/tdk';

// DO: Validate tokens before accepting
const token = await new Token().restore(tokenJWT);
const isValid = await token.validate();
if (!isValid) {
  throw new Error('Invalid token');
}

// DON'T: Trust tokens blindly
```

---

## Troubleshooting

### Issue: Tokens not received

**Symptoms**: Balance doesn't update after minting/transfer

**Solutions**:
1. Check relay connectivity
   ```typescript
   // Add connection logging
   import { DebugLogger } from '@tat-protocol/tdk';
   const Debug = DebugLogger.getInstance();
   Debug.enableAll();
   ```

2. Wait for message delivery
   ```typescript
   await new Promise(r => setTimeout(r, 3000)); // 3 second delay
   ```

3. Verify address
   ```typescript
   console.log('Sending to:', recipientAddress);
   // Make sure it matches pocket's address
   ```

### Issue: "Storage not initialized"

**Symptoms**: Error on wallet/forge creation

**Solution**: Ensure storage directory exists and has permissions
```bash
mkdir ./.pocket
chmod 700 ./.pocket
```

### Issue: Double-spend error

**Symptoms**: "Token already spent" error

**Solution**: This is expected behavior - you're trying to spend the same token twice. Generate new tokens or check which tokens are unspent.

```typescript
// List unspent tokens
const state = pocket.getState();
const unspentTokens = Array.from(state.tokens.values());
```

---

## Next Steps

### Learn More

- Read the [API Documentation](./packages/tdk/README.md)
- Review [Security Best Practices](./SECURITY.md)
- Understand the [Architecture](./TAT_PROTOCOL.md)
- Explore [Examples](./examples/)

### Build Something

Try building:
- **Loyalty Points System** - Reward customers
- **DAO Voting Tokens** - Governance system
- **Digital Collectibles** - NFT marketplace
- **Prepaid Credits** - Service credits
- **Access Badges** - Event management

### Get Help

- GitHub Discussions: Ask questions
- GitHub Issues: Report bugs

---

## Quick Reference

### Essential Commands

```typescript
import {
  createPocketWithKey,
  createFungibleForgeWithKey,
  NodeStore
} from '@tat-protocol/tdk';

// Create wallet
const pocket = await createPocketWithKey({
  secretKey, storage: new NodeStore('./.pocket'), relays
});

// Create mint
const forge = await createFungibleForgeWithKey({
  secretKey, owner: ownerPubKey, storage: new NodeStore('./.forge'), relays, totalSupply
});

// Get receiving address
const address = await pocket.getNewReceiveAddress();

// Transfer tokens
await pocket.transfer(issuerPubKey, recipientAddress, amount);

// Check balance
const balance = pocket.getBalance(issuerPubKey, '-');
```

### Useful Utilities

```typescript
// Generate keys
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(hexToBytes(sk));

// Enable logging
import { DebugLogger } from '@tat-protocol/tdk';
const Debug = DebugLogger.getInstance();
Debug.enableAll();

// HD key derivation
import { HDKey } from '@tat-protocol/tdk';
const mnemonic = HDKey.generateMnemonic(256);
```

---

**Ready to build?** Start with the Quick Start above and experiment!

**Questions?** Check out the [examples directory](./examples/) for more code samples.
