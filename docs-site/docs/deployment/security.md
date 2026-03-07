# Security Best Practices

Practical security guidance for deploying TAT Protocol applications.

## Key management

### Generate keys securely

```ts
import { generateSecretKey, getPublicKey } from "@tat-protocol/tdk";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// Cryptographically secure key generation
const secretKey = bytesToHex(generateSecretKey());
const publicKey = getPublicKey(hexToBytes(secretKey));
```

Never use `Math.random()` or other weak randomness for key generation.

### Use HD keys for production

```ts
import { HDKey } from "@tat-protocol/hdkeys";

const mnemonic = HDKey.generateMnemonic(256); // 24 words
// Store this mnemonic securely — it recovers ALL derived keys
const seed = await HDKey.mnemonicToSeed(mnemonic);
const master = HDKey.fromMasterSeed(seed);
```

### Store keys safely

- **Server**: Use environment variables or secret managers (AWS Secrets Manager, HashiCorp Vault). Never hardcode keys.
- **Browser**: Use NIP-07 signer extensions — the key never leaves the extension.
- **Backup**: Store mnemonic phrases offline in a secure location.

## Storage security

- Keep storage directories **isolated per component** — separate directories for Forge, Pocket, Gate
- Set file permissions: `chmod 700` on storage directories
- In production, consider encrypted storage backends

::: warning
Token JWTs and key material are currently stored unencrypted in `NodeStore` and `BrowserStore`. For high-value deployments, implement an encrypted `StorageInterface`.
:::

## Network security

### Use multiple relays

```ts
const relays = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
];
```

Multiple relays provide redundancy against censorship and downtime.

### All messages are encrypted

TAT Protocol encrypts all NWPC messages with NIP-44 and wraps them with NIP-59. Relay operators cannot read message content or identify the true sender. However:

- Relay operators can see **when** events are delivered and to **which public keys**
- Use single-use keys (which Pocket does automatically) to minimize metadata exposure

## Token security

### Always validate tokens

```ts
const token = await new Token().restore(tokenJWT);

// Check all validation rules
const isValid = await token.validate();
const hashOk = await token.verifyTokenHash();
const sigOk = await token.verifyTokenSignature();
const expired = token.isExpired();
```

### Check spent status

Never trust a token without verifying it hasn't been spent. The Forge maintains the authoritative spent-token set.

### Verify the issuer

Only accept tokens from trusted issuers:

```ts
const issuer = token.getIssuer();
if (!trustedIssuers.includes(issuer)) {
  throw new Error("Token from untrusted issuer");
}
```

## Logging

- Never log raw secret keys
- Never log complete token JWTs in production (they contain signatures that could be replayed)
- Do log: public keys, token hashes, error codes, request methods, timestamps

```ts
import { DebugLogger } from "@tat-protocol/utils";

const debug = DebugLogger.getInstance();
// Enable only in development
if (process.env.NODE_ENV === "development") {
  debug.enableAll();
}
```

## Security checklist

- [ ] Keys generated with `generateSecretKey()` (not weak randomness)
- [ ] Secret keys stored in environment variables or secret manager
- [ ] HD keys used for Pocket (mnemonic backed up securely)
- [ ] Storage directories have restrictive permissions
- [ ] Multiple relays configured for redundancy
- [ ] Token signatures validated before accepting
- [ ] Token spent status checked with Forge
- [ ] Rate limiting enabled on Forge and Gate endpoints
- [ ] No secret keys or full JWTs in logs
- [ ] NIP-07 signer used in browser (not raw keys)
