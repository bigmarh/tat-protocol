# Key Management

How to generate, store, back up, and rotate keys for TAT Protocol deployments.

## Key types

| Key | Used by | Purpose |
|-----|---------|---------|
| **Forge key** | Forge | Signs tokens, validates transfers |
| **Pocket key** | Pocket | Signs transfer requests, decrypts received tokens |
| **Single-use keys** | Pocket (derived) | Receive addresses — each used once for privacy |
| **Gate key** | Gate | Signs challenge/response in NWPC |
| **Booth key** | Booth | Signs commerce messages in NWPC |

## HD keys vs random keys

### HD keys (recommended)

One mnemonic phrase recovers all derived keys:

```ts
import { HDKey } from "@tat-protocol/hdkeys";

const mnemonic = HDKey.generateMnemonic(256); // 24 words
const seed = await HDKey.mnemonicToSeed(mnemonic);
const master = HDKey.fromMasterSeed(seed);

// Derive purpose-specific keys
const forgeKey = master.derive("m/44'/1237'/0'/0/0");
const pocketKey = master.derive("m/44'/1237'/0'/0/1");
```

Advantages:
- Single backup recovers everything
- Deterministic — same mnemonic always produces same keys
- Pocket automatically derives single-use receive addresses

### Random keys

```ts
import { generateSecretKey } from "@tat-protocol/tdk";
import { bytesToHex } from "@noble/hashes/utils";

const secretKey = bytesToHex(generateSecretKey());
```

Use only for testing or ephemeral instances. Cannot be recovered if lost.

## Server-side key storage

### Environment variables (simplest)

```bash
export FORGE_SECRET_KEY="abc123..."
export POCKET_SECRET_KEY="def456..."
```

```ts
const forge = await createFungibleForgeWithKey({
  secretKey: process.env.FORGE_SECRET_KEY!,
  // ...
});
```

### Secret managers (production)

For production deployments, use a secret manager:
- AWS Secrets Manager
- HashiCorp Vault
- Google Cloud Secret Manager
- Azure Key Vault

Never commit keys to source control.

## Browser key management

In browsers, use NIP-07 signer extensions. The private key stays in the extension and is never exposed to your application:

```ts
const pocket = await createPocketWithNIP07({
  storage: new BrowserStore(),
  relays: ["wss://relay.damus.io"],
});
```

Supported extensions: NostrPass, Alby, nos2x, Flamingo.

## Mnemonic backup

If using HD keys, the mnemonic phrase is the **only backup you need**:

1. Generate the mnemonic in a secure environment
2. Write it down on paper (not digital storage)
3. Store in a secure physical location (safe, safety deposit box)
4. Test recovery by re-deriving keys from the mnemonic

::: danger
If you lose the mnemonic and the original keys are destroyed, all tokens controlled by those keys are permanently inaccessible.
:::

## Key rotation

### Forge key rotation

Forge keys are the most sensitive — they sign all tokens. Rotation steps:

1. Generate a new Forge keypair
2. Update the Forge service configuration
3. Begin minting tokens with the new key
4. The old key's tokens remain valid until spent
5. Optionally transfer authority using `addAuthorizedForger` / `removeAuthorizedForger`

### Pocket key rotation

Pocket keys are less critical since they only control the holder's tokens:

1. Create a new Pocket with a new key
2. Transfer all tokens from the old Pocket to the new one
3. Decommission the old Pocket

## Related

- [Signers](/sdk/signers) — KeySigner and NIP07Signer
- [HD Keys](/sdk/hdkeys) — BIP-32 derivation
- [Security Best Practices](/deployment/security) — full security guide
