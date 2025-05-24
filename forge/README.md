# @tat-protocol/forge

The **Forge** package is responsible for token creation, issuance, and management in the TAT Protocol ecosystem. It provides the core logic for minting both fungible and non-fungible (TAT) tokens, and integrates seamlessly with other protocol modules such as Pocket and NWPC.

## Features

- Create and issue fungible tokens
- Mint and manage non-fungible TAT tokens
- Integrate with Pocket for asset management
- Secure, standards-based token logic

## Installation

```bash
pnpm add @tat-protocol/forge
# or
npm install @tat-protocol/forge
# or
yarn add @tat-protocol/forge
```

## Usage Example

```typescript
import { Forge } from '@tat-protocol/forge';

// Initialize Forge
const forge = new Forge();

// Create a new fungible token
const token = await forge.createToken({
  issuer: 'issuerPubKey',
  amount: 1000,
  metadata: { name: 'MyToken', symbol: 'MTK' }
});

// Issue a TAT (non-fungible token)
const tat = await forge.createTAT({
  issuer: 'issuerPubKey',
  tokenID: 'unique-id',
  metadata: { description: 'Special asset' }
});
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 