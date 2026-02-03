# @tat-protocol/turnstile

Validation and access control protocol for TAT Protocol tokens.

## Overview

The Turnstile module provides **two implementations**:

### 1. **TurnstileServerSpec** - TAT Protocol Extensions Spec Compliant
Implements the [TAT Protocol Extensions specification](https://github.com/tat-protocol/extensions) section 5 (Gate Protocol) with official NWPC methods:
- `gate.challenge` - Issue access challenge with requirements
- `gate.verify` - Verify proof of TAT ownership
- `gate.result` - Return access decision with session token

Features:
- **Challenge-response protocol** with nonce-based replay protection
- **Full disclosure mode** - Complete TAT validation
- **Minimal disclosure mode** - Privacy-preserving verification
- **Session management** - Token-based access after verification

**Use this for spec-compliant implementations.**

### 2. **TurnstileBase** - Flexible SDK Foundation
Protocol-level SDK with pluggable validation strategies, access policies, and offline support.

**Use this for custom implementations with advanced features.**

---

## Installation

```bash
npm install @tat-protocol/turnstile
```

## Quick Start

### Using TurnstileServerSpec (Spec-Compliant)

```typescript
import { TurnstileServerSpec, TurnstileRequirements } from '@tat-protocol/turnstile';
import { NodeStorage } from '@tat-protocol/storage';

// Create spec-compliant gate
const turnstile = await TurnstileServerSpec.create({
  storage: new NodeStorage({ path: './turnstile' }),
  keys: myKeys,
  serviceName: 'Premium Content API',
  relays: ['wss://relay.damus.io'],
  defaultVerificationMode: 'local', // or 'issuer' or 'hybrid'
  challengeExpiry: 300, // 5 minutes
  sessionExpiry: 3600 // 1 hour
});

// When client requests access, issue challenge
const requirements: TurnstileRequirements = {
  issuer: forgePublicKey,
  tokenIdPattern: 'premium-.*',
  notExpired: true,
  minTier: 'gold'
};

const challenge = turnstile.issueChallenge(
  '/api/premium-content',
  requirements,
  clientPubkey
);

// Client submits proof via gate.verify
// Server validates and returns gate.result with session token
```

```typescript
import { TurnstileBase, ValidationStrategy, GateStatus } from '@tat-protocol/turnstile';
import { NodeStorage } from '@tat-protocol/storage';
import { Token } from '@tat-protocol/token';

class VenueTurnstile extends TurnstileBase {
  // Implement forge validation (optional - for online mode)
  protected async validateTokenWithForge(token: Token): Promise<boolean> {
    // Query forge to check if token is spent
    const isSpent = await this.forge.isTokenSpent(token.header.token_hash);
    return !isSpent;
  }
}

// Create turnstile instance
const turnstile = new VenueTurnstile({
  storage: new NodeStorage({ path: './turnstile' }),
  gateConfig: {
    gateId: 'main-entrance',
    name: 'Main Entrance',
    strategy: ValidationStrategy.SINGLE_USE,
    policy: {
      name: 'venue-policy',
      requireValidSignature: true,
      requireNotExpired: true,
      allowedIssuers: [forgePublicKey]
    },
    status: GateStatus.ACTIVE
  },
  offlineMode: false // Enable forge validation
});

await turnstile.initialize();

// Validate and grant access
const granted = await turnstile.grantAccess(tokenJWT, {
  gateId: 'main-entrance',
  holder: userPubkey
});

if (granted) {
  console.log('Access granted!');
} else {
  console.log('Access denied.');
}
```

## Use Cases

### Physical Venue Entry
Validate tickets at venue entrances with offline support

### Web Authentication
Use as authentication middleware for web apps

### API Access Control
Gate API endpoints with token validation

## API

See inline documentation in the source code for detailed API information.

## Examples

See the [examples directory](./src/examples) for complete usage examples.

## License

MIT License. See [LICENSE](../../LICENSE) for details.
