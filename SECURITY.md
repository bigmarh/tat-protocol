# TAT Protocol - Security Guide

This document outlines security best practices, threat models, and implementation guidance for the TAT Protocol SDK.

## Table of Contents

- [Overview](#overview)
- [Threat Model](#threat-model)
- [Key Management](#key-management)
- [Storage Security](#storage-security)
- [Network Security](#network-security)
- [Token Security](#token-security)
- [Best Practices](#best-practices)
- [Security Checklist](#security-checklist)
- [Reporting Security Issues](#reporting-security-issues)

---

## Overview

TAT Protocol is a decentralized token system built on Nostr. Security is paramount when handling cryptographic keys, tokens representing value, and user data. This guide helps developers build secure applications using the TAT Protocol SDK.

### Security Principles

1. **Defense in Depth**: Multiple layers of security
2. **Least Privilege**: Minimal access rights for components
3. **Fail Secure**: Safe defaults, explicit insecure configurations
4. **Cryptographic Best Practices**: Industry-standard algorithms and implementations
5. **Transparency**: Open source, auditable code

---

## Threat Model

### Assets to Protect

1. **Private Keys**: Control over token issuance, signing, and transfers
2. **Tokens**: Digital assets with monetary or access value
3. **User Data**: Transaction history, balances, metadata
4. **Network Communications**: Messages between Pocket, Forge, and relays

### Threat Actors

- **Malicious Users**: Attempting double-spending, replay attacks
- **Network Attackers**: Man-in-the-middle, eavesdropping
- **Local Attackers**: Physical access to storage, memory dumps
- **Compromised Relays**: Nostr relay operators with malicious intent

### Attack Vectors

1. **Key Compromise**: Theft of private keys from storage
2. **Replay Attacks**: Reusing valid signed messages
3. **Double Spending**: Spending the same token multiple times
4. **Token Forgery**: Creating fake tokens or signatures
5. **Storage Tampering**: Modifying wallet state or token database
6. **Side Channel Attacks**: Timing attacks, memory analysis

---

## Key Management

### Private Key Generation

**✅ Secure:**
```typescript
import { generateSecretKey, getPublicKey } from '@tat-protocol/tdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Generate cryptographically secure keys
const secretKey = bytesToHex(generateSecretKey());
const publicKey = getPublicKey(hexToBytes(secretKey));
```

**❌ Insecure:**
```typescript
// NEVER use weak randomness
const badKey = Math.random().toString(); // INSECURE!
```

### HD Key Derivation

Use BIP-32 hierarchical deterministic keys for better key management:

```typescript
import { HDKey } from '@tat-protocol/hdkeys';

// Generate from mnemonic (12-24 words)
const mnemonic = HDKey.generateMnemonic(256); // 24 words
const seed = await HDKey.mnemonicToSeed(mnemonic);
const masterKey = HDKey.fromMasterSeed(seed);

// Derive child keys
const forgePath = "m/44'/1237'/0'/0/0"; // TAT Protocol forge key
const forgeKey = masterKey.derive(forgePath);
```

### Key Storage

#### ⚠️ CRITICAL: Keys are currently stored UNENCRYPTED

**Current Implementation:**
- Pocket saves keys to disk using `DiskStorage` in **plain text**
- File location: `./.pocket/pocket-idkey-{publicKey}`
- This is a **SECURITY RISK** for production use

**Mitigation Strategies:**

1. **Operating System Key Storage (Recommended for production)**
```typescript
// Use OS-level key storage (not yet implemented in SDK)
// - macOS: Keychain
// - Windows: Credential Manager
// - Linux: Secret Service API / gnome-keyring
```

2. **Encrypted Storage (Implement with caution)**
```typescript
// Example: Encrypt keys before storage
import { nip44 } from 'nostr-tools';

class EncryptedKeyStorage {
  async saveKey(secretKey: string, password: string) {
    // Derive encryption key from password
    const encryptionKey = await this.deriveKey(password);

    // Encrypt the secret key
    const encrypted = nip44.encrypt(secretKey, encryptionKey);

    // Save encrypted key
    await storage.setItem('encrypted_key', encrypted);
  }

  async loadKey(password: string): Promise<string> {
    const encrypted = await storage.getItem('encrypted_key');
    const encryptionKey = await this.deriveKey(password);
    return nip44.decrypt(encrypted, encryptionKey);
  }

  private async deriveKey(password: string): Promise<Uint8Array> {
    // Use PBKDF2 or Argon2 for key derivation
    // This is pseudocode - implement proper KDF
    return await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: crypto.getRandomValues(new Uint8Array(16)),
      iterations: 100000,
      hash: 'SHA-256'
    }, password, 256);
  }
}
```

3. **Hardware Security Modules (HSM)**
```typescript
// For high-value forges, consider HSM integration
// - YubiKey
// - Ledger/Trezor hardware wallets
// - Cloud HSM services (AWS KMS, Google Cloud KMS)
```

### Key Rotation

**Not yet implemented** - Plan for key rotation:

1. Generate new keypair
2. Transfer all tokens to new key
3. Update all subscriptions
4. Securely delete old key
5. Notify counterparties of new public key

---

## Storage Security

### Current State

The TAT Protocol SDK uses pluggable storage backends:

- **NodeStorage** (DiskStorage): Plain-text JSON files
- **BrowserStorage**: localStorage (plain-text)
- **Memory**: Volatile, lost on restart

**⚠️ All current implementations store data UNENCRYPTED**

### What Gets Stored

#### Pocket State
```json
{
  "favorites": [...],
  "hdMasterKey": { "mnemonic": "..." },  // ⚠️ SENSITIVE
  "singleUseKeys": {...},                 // ⚠️ SENSITIVE
  "tokens": {...},                        // ⚠️ VALUE
  "balances": {...}
}
```

#### Forge State
```json
{
  "owner": "...",
  "authorizedForgers": [...],
  "mintedTokens": {...},                  // ⚠️ SENSITIVE
  "spentTokens": {...}
}
```

### Recommended Storage Security

#### 1. File Permissions (Node.js)

```typescript
import { NodeStorage } from '@tat-protocol/storage';
import fs from 'fs';

const storage = new NodeStorage({ path: './.pocket' });

// Set restrictive permissions (owner read/write only)
fs.chmodSync('./.pocket', 0o700);
```

#### 2. Encryption at Rest (Recommended Implementation)

```typescript
// Pseudocode for encrypted storage wrapper
class EncryptedStorage implements StorageInterface {
  private backend: StorageInterface;
  private encryptionKey: Uint8Array;

  async getItem(key: string): Promise<string | null> {
    const encrypted = await this.backend.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = this.encrypt(value);
    await this.backend.setItem(key, encrypted);
  }

  private encrypt(data: string): string {
    // Use NIP-44 encryption with derived key
    return nip44.encrypt(data, this.encryptionKey);
  }

  private decrypt(data: string): string {
    return nip44.decrypt(data, this.encryptionKey);
  }
}
```

#### 3. Browser Security

```typescript
// For browser-based wallets
class SecureBrowserStorage {
  // Consider using IndexedDB with encryption
  // Avoid localStorage for sensitive data in production

  async saveEncrypted(key: string, data: unknown, password: string) {
    const encrypted = await this.encryptWithPassword(data, password);
    // Use IndexedDB, not localStorage
    await indexedDB.set(key, encrypted);
  }
}
```

---

## Network Security

### Nostr Relay Communication

All communication uses Nostr encrypted events:

1. **Kind 1059 (Gift Wrap)**: Sealed sender, encrypted to recipient
2. **NIP-44 Encryption**: Strong encryption for message contents
3. **NIP-01 Event Signatures**: Cryptographic proof of authorship

### Message Flow Security

```
Sender → [NIP-44 Encrypt] → Kind 1059 Event → Nostr Relay → Recipient
                                                      ↓
                                            [NIP-44 Decrypt]
```

**Security Features:**
- End-to-end encryption
- Authenticated messages (signature verification)
- Replay protection (bloom filter + LRU cache)
- Deniable sender (gift wrap with ephemeral keys)

### Relay Selection

**Risks:**
- Malicious relays can:
  - Log metadata (IP addresses, timing)
  - Deny service (drop messages)
  - Censor (filter messages)

**Cannot do:**
- Read encrypted message contents
- Forge signatures
- Modify messages without detection

**Best Practices:**
```typescript
const config = {
  relays: [
    'wss://relay1.example.com',  // Use multiple relays
    'wss://relay2.example.com',  // For redundancy
    'wss://your-private-relay.com'  // Consider self-hosting
  ]
};
```

---

## Token Security

### Double-Spend Prevention

TAT Protocol prevents double-spending through:

1. **Forge-side validation**: Checks if token hash already spent
2. **Bloom filter tracking**: Fast spent token lookups
3. **Atomic state updates**: Transaction either fully succeeds or fails
4. **Event publishing**: Spent events notify all parties

### Token Validation

**Always validate tokens before accepting:**

```typescript
import { Token } from '@tat-protocol/token';

async function acceptToken(tokenJWT: string, expectedIssuer: string) {
  // 1. Restore token
  const token = await new Token().restore(tokenJWT);

  // 2. Validate structure and signature
  const isValid = await token.validate();
  if (!isValid) {
    throw new Error('Invalid token signature or structure');
  }

  // 3. Check issuer
  if (token.payload.iss !== expectedIssuer) {
    throw new Error('Token from untrusted issuer');
  }

  // 4. Check expiration (if applicable)
  if (token.payload.exp && Date.now() > token.payload.exp * 1000) {
    throw new Error('Token expired');
  }

  // 5. Check if token is spent (query forge)
  const isSpent = await forge.checkIfSpent(token.header.token_hash);
  if (isSpent) {
    throw new Error('Token already spent');
  }

  // Token is valid and unspent
  return token;
}
```

### Token Locks

Tokens can have multiple lock types:

1. **P2PK (Pay to Public Key)**: Only specific key can spend
2. **HTLC (Hash Time Locked Contract)**: Requires secret reveal
3. **Time Lock**: Can only be spent after specific time

**Validation priority**: P2PK → HTLC → Time Lock

```typescript
// Always verify you can unlock before accepting
const canUnlock = await this.canUnlockToken(token, myKeys);
if (!canUnlock) {
  throw new Error('Cannot unlock this token');
}
```

---

## Best Practices

### For Pocket (Wallet) Users

1. **Backup mnemonic phrase** - Write down and store securely offline
2. **Use strong passwords** - If implementing encryption
3. **Verify issuer public keys** - Before accepting tokens
4. **Monitor balances** - Regularly check for unexpected changes
5. **Limit exposure** - Don't store large amounts on hot wallets
6. **Update regularly** - Keep SDK updated for security patches

### For Forge (Issuer) Operators

1. **Secure key storage** - Use HSM for high-value forges
2. **Audit authorized forgers** - Regularly review and revoke
3. **Monitor minting** - Detect unauthorized token creation
4. **Implement rate limits** - Prevent abuse
5. **Log all operations** - For security audits
6. **Set supply limits** - Enforce `totalSupply` constraints
7. **Test disaster recovery** - Practice key restoration procedures

### For Application Developers

1. **Input validation** - Never trust user input
2. **Error handling** - Don't leak sensitive info in errors
3. **Secure defaults** - Enable security features by default
4. **Regular audits** - Review code for vulnerabilities
5. **Dependency scanning** - Keep dependencies updated
6. **Security testing** - Include security test cases
7. **Documentation** - Clearly document security requirements

---

## Security Checklist

### Development

- [ ] All private keys generated with `generateSecretKey()`
- [ ] HD keys used for key derivation (not random generation each time)
- [ ] Storage files have restrictive permissions (0o700)
- [ ] Sensitive data encrypted before storage
- [ ] All tokens validated before acceptance
- [ ] Error messages don't leak sensitive information
- [ ] Debug logging disabled in production
- [ ] Dependencies scanned for vulnerabilities

### Deployment

- [ ] Mnemonic phrase backed up securely
- [ ] Production keys never committed to version control
- [ ] Encryption keys derived from strong passwords/secrets
- [ ] Multiple relay connections configured
- [ ] Rate limiting enabled on forge endpoints
- [ ] Monitoring and alerting configured
- [ ] Incident response plan documented

### Operations

- [ ] Regular security audits scheduled
- [ ] Access logs reviewed
- [ ] Spent token bloom filter monitored for size
- [ ] Authorized forgers list audited quarterly
- [ ] Disaster recovery tested annually
- [ ] Security patches applied promptly

---

## Reporting Security Issues

**DO NOT open public GitHub issues for security vulnerabilities.**

To report a security issue:

1. **Email**: security@tat-protocol.org (preferred)
2. **Encrypted communication**: Use PGP key (published on website)
3. **Include**:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if known)

We will:
- Acknowledge receipt within 48 hours
- Provide timeline for fix within 7 days
- Credit you in security advisory (if desired)
- Coordinate disclosure timeline

---

## Cryptographic Implementations

### Algorithms Used

- **Signing**: Schnorr signatures (secp256k1)
- **Hashing**: SHA-256
- **Encryption**: NIP-44 (ChaCha20-Poly1305)
- **Key derivation**: BIP-32, BIP-39

### Libraries

- **@noble/curves**: Audited, minimal elliptic curve library
- **@noble/hashes**: Audited hashing implementations
- **nostr-tools**: NIP-44 encryption, event signing
- **@scure/bip39**: BIP-39 mnemonic generation

All cryptographic libraries are:
- Industry-standard implementations
- Actively maintained
- Independently audited
- Open source

---

## Future Security Enhancements

Planned improvements:

1. **Encrypted Storage by Default**
   - Password-protected wallet files
   - OS keychain integration

2. **Multi-signature Support**
   - Require multiple keys for high-value transactions
   - Threshold signatures (m-of-n)

3. **Hardware Wallet Integration**
   - Ledger/Trezor support
   - Air-gapped signing

4. **Token Revocation**
   - Issuer-initiated token invalidation
   - Emergency freeze capabilities

5. **Audit Logging**
   - Tamper-evident operation logs
   - Compliance reporting

6. **Zero-Knowledge Proofs**
   - Private token amounts
   - Selective disclosure

---

## Security Audit Status

**Current Status**: No formal third-party security audit completed.

**Recommendation**: Before deploying high-value applications:
1. Conduct internal security review
2. Engage third-party security auditors
3. Run bug bounty program
4. Gradual rollout with small amounts

---

## Additional Resources

- [Nostr NIPs](https://github.com/nostr-protocol/nips) - Protocol specifications
- [NIP-44 Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [BIP-32 HD Keys](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

---

**Last Updated**: 2025-12-10
**Version**: 1.0.0
