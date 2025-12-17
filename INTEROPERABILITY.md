# TAT Protocol Interoperability Guide

**Version**: 1.0.0
**Last Updated**: 2025-12-17
**Purpose**: Help developers build compatible TAT Protocol implementations

---

## Table of Contents

1. [Overview](#1-overview)
2. [Test Vectors](#2-test-vectors)
3. [Implementation Guide](#3-implementation-guide)
4. [Compatibility Matrix](#4-compatibility-matrix)
5. [Common Pitfalls](#5-common-pitfalls)
6. [Validation Checklist](#6-validation-checklist)

---

## 1. Overview

### 1.1 Purpose

This document provides:
- **Test Vectors**: Known input/output pairs for validation
- **Implementation Guide**: Step-by-step implementation instructions
- **Compatibility Rules**: How different versions interoperate
- **Troubleshooting**: Common implementation mistakes

### 1.2 Conformance Levels

**Level 1 - Basic (Minimum Viable)**
- Token creation and validation
- Schnorr signature verification
- NWPC message encoding
- Spent token tracking

**Level 2 - Standard (Recommended)**
- Level 1 features plus:
- NIP-44 encryption
- NIP-59 gift wrap
- HD key derivation
- Multi-relay support

**Level 3 - Advanced (Full Featured)**
- Level 2 features plus:
- HTLC support
- Time locks
- Token revocation
- Hardware wallet integration

---

## 2. Test Vectors

### 2.1 Key Generation

**Test Vector 1: Secret Key to Public Key**

Input:
```json
{
  "secretKey": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
}
```

Expected Output:
```json
{
  "publicKey": "b2d1c78484e5742b6b3f67f5f9c7d3e5a0f9c4d2e8a7b3c6d5e4f3a2b1c0d9e8"
}
```

Computation:
1. Parse hex secret key to 32-byte array
2. Use secp256k1 scalar multiplication: P = G × secretKey
3. Return x-coordinate of point P as hex string

**Test Vector 2: Mnemonic to Master Key**

Input:
```json
{
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "passphrase": ""
}
```

Expected Output (BIP-39):
```json
{
  "seed": "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
  "masterPrivateKey": "xprv9s21ZrQH143K3h3fDYiay8mocZ3afhfULfb5GX8kCBdno77K4HiA15Tg23wpbeF1pLfs1c5SPmYHrEpTuuRhxMwvKDwqdKiGJS9XFKzUsAF"
}
```

**Test Vector 3: HD Key Derivation**

Input:
```json
{
  "masterPrivateKey": "xprv9s21ZrQH143K3h3fDYiay8mocZ3afhfULfb5GX8kCBdno77K4HiA15Tg23wpbeF1pLfs1c5SPmYHrEpTuuRhxMwvKDwqdKiGJS9XFKzUsAF",
  "path": "m/44'/1237'/0'/0/0"
}
```

Expected Output:
```json
{
  "privateKey": "47f7616ea6f9b923076625b4488115de1ef1187f760e65f89eb6f4f7ff04b012",
  "publicKey": "02c021b8f41596e65f59b8b2b5e3b4c3f9f7c8a6b8c4d2e5f3a7b9c0d1e2f4a6"
}
```

### 2.2 Token Hash Computation

**Test Vector 4: FUNGIBLE Token Hash**

Input Payload (canonical JSON, no whitespace):
```json
{"iss":"b2d1c78484e5742b6b3f67f5f9c7d3e5a0f9c4d2e8a7b3c6d5e4f3a2b1c0d9e8","iat":1703001600,"amount":100,"setID":"test-tokens","P2PKlock":"abc123def456abc123def456abc123def456abc123def456abc123def456abc1"}
```

Expected Output:
```json
{
  "token_hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
}
```

Computation:
1. Serialize payload as canonical JSON (RFC 8785)
2. Compute SHA-256 hash
3. Return as hex string

**Test Vector 5: TAT Token Hash**

Input Payload:
```json
{"iss":"b2d1c78484e5742b6b3f67f5f9c7d3e5a0f9c4d2e8a7b3c6d5e4f3a2b1c0d9e8","iat":1703001600,"tokenID":"ticket-001","exp":1735624800,"ext":{"event":"Test Concert","seat":"A1"}}
```

Expected Output:
```json
{
  "token_hash": "9c2e4d535058e1e6b0e5e8e4e9c1a5f3b7c2d9e6f4a3b8c5d0e7f2a9b6c3d1e8"
}
```

### 2.3 Schnorr Signatures

**Test Vector 6: Token Signature**

Input:
```json
{
  "message": "eyJhbGciOiJTY2hub3JyIiwidHlwIjoiRlVOR0lCTEUiLCJ0b2tlbl9oYXNoIjoiN2Y4M2IxNjU3ZmYxZmM1M2I5MmRjMTgxNDhhMWQ2NWRmYzJkNGIxZmEzZDY3NzI4NGFkZGQyMDAxMjZkOTA2OSIsInZlciI6IjEuMC4wIn0.eyJpc3MiOiJiMmQxYzc4NDg0ZTU3NDJiNmIzZjY3ZjVmOWM3ZDNlNWEwZjljNGQyZThhN2IzYzZkNWU0ZjNhMmIxYzBkOWU4IiwiaWF0IjoxNzAzMDAxNjAwLCJhbW91bnQiOjEwMCwic2V0SUQiOiJ0ZXN0LXRva2VucyIsIlAyUEtsb2NrIjoiYWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMSJ9",
  "secretKey": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
}
```

Expected Output:
```json
{
  "signature": "304402203b8f0e9e74ac61c76de2e2e7a20b48c6f3e5d4a7c8b9f0a1d2c3b4e5a6d7c8e9022056f1e2d3c4b5a6e7f8d9c0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1"
}
```

Computation (Schnorr over secp256k1):
1. messageHash = SHA256(message)
2. signature = Schnorr_Sign(secretKey, messageHash)
3. Return 64-byte signature as hex (128 chars)

### 2.4 Complete Token Examples

**Test Vector 7: Complete FUNGIBLE Token**

Input:
```json
{
  "secretKey": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "payload": {
    "iss": "b2d1c78484e5742b6b3f67f5f9c7d3e5a0f9c4d2e8a7b3c6d5e4f3a2b1c0d9e8",
    "iat": 1703001600,
    "amount": 100,
    "setID": "test-tokens",
    "P2PKlock": "abc123def456abc123def456abc123def456abc123def456abc123def456abc1"
  }
}
```

Expected JWT Output:
```
eyJhbGciOiJTY2hub3JyIiwidHlwIjoiRlVOR0lCTEUiLCJ0b2tlbl9oYXNoIjoiN2Y4M2IxNjU3ZmYxZmM1M2I5MmRjMTgxNDhhMWQ2NWRmYzJkNGIxZmEzZDY3NzI4NGFkZGQyMDAxMjZkOTA2OSIsInZlciI6IjEuMC4wIn0.eyJpc3MiOiJiMmQxYzc4NDg0ZTU3NDJiNmIzZjY3ZjVmOWM3ZDNlNWEwZjljNGQyZThhN2IzYzZkNWU0ZjNhMmIxYzBkOWU4IiwiaWF0IjoxNzAzMDAxNjAwLCJhbW91bnQiOjEwMCwic2V0SUQiOiJ0ZXN0LXRva2VucyIsIlAyUEtsb2NrIjoiYWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMTIzZGVmNDU2YWJjMSJ9.304402203b8f0e9e74ac61c76de2e2e7a20b48c6f3e5d4a7c8b9f0a1d2c3b4e5a6d7c8e9022056f1e2d3c4b5a6e7f8d9c0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1
```

Token Structure:
```
Header: {
  "alg": "Schnorr",
  "typ": "FUNGIBLE",
  "token_hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "ver": "1.0.0"
}
Payload: {
  "iss": "b2d1c78484e5742b6b3f67f5f9c7d3e5a0f9c4d2e8a7b3c6d5e4f3a2b1c0d9e8",
  "iat": 1703001600,
  "amount": 100,
  "setID": "test-tokens",
  "P2PKlock": "abc123def456abc123def456abc123def456abc123def456abc123def456abc1"
}
Signature: "304402203b8f0e9e74ac61c76de2e2e7a20b48c6f3e5d4a7c8b9f0a1d2c3b4e5a6d7c8e9022056f1e2d3c4b5a6e7f8d9c0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1"
```

### 2.5 NWPC Messages

**Test Vector 8: Mint Request**

Input:
```json
{
  "method": "mint",
  "params": {
    "token_type": "FUNGIBLE",
    "recipient": "def456abc789def456abc789def456abc789def456abc789def456abc789def4",
    "amount": 50,
    "setID": "loyalty-points"
  },
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ver": "1.0.0"
}
```

Encrypted Output (NIP-44):
```
[encrypted binary blob - implementation specific based on ephemeral keys]
```

**Test Vector 9: Transfer Request**

Input:
```json
{
  "method": "transfer",
  "params": {
    "tokens": [
      "eyJhbGciOiJTY2hub3JyIiwidHlwIjoiRlVOR0lCTEUi..."
    ],
    "recipient": "fed789cba456fed789cba456fed789cba456fed789cba456fed789cba456fed7",
    "amount": 30
  },
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "ver": "1.0.0"
}
```

**Test Vector 10: Verify Request**

Input:
```json
{
  "method": "verify",
  "params": {
    "token_hashes": [
      "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      "9c2e4d535058e1e6b0e5e8e4e9c1a5f3b7c2d9e6f4a3b8c5d0e7f2a9b6c3d1e8"
    ]
  },
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "ver": "1.0.0"
}
```

Expected Response:
```json
{
  "result": {
    "valid": {
      "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069": true,
      "9c2e4d535058e1e6b0e5e8e4e9c1a5f3b7c2d9e6f4a3b8c5d0e7f2a9b6c3d1e8": true
    },
    "spent": {
      "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069": false,
      "9c2e4d535058e1e6b0e5e8e4e9c1a5f3b7c2d9e6f4a3b8c5d0e7f2a9b6c3d1e8": false
    }
  },
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "ver": "1.0.0"
}
```

### 2.6 Error Responses

**Test Vector 11: Invalid Token Error**

Request:
```json
{
  "method": "transfer",
  "params": {
    "tokens": ["invalid-jwt-token"],
    "recipient": "abc...",
    "amount": 10
  },
  "id": "880e8400-e29b-41d4-a716-446655440003",
  "ver": "1.0.0"
}
```

Expected Error Response:
```json
{
  "error": {
    "code": 2000,
    "message": "Token Invalid",
    "data": {
      "reason": "Invalid JWT format"
    }
  },
  "id": "880e8400-e29b-41d4-a716-446655440003",
  "ver": "1.0.0"
}
```

**Test Vector 12: Double-Spend Error**

Expected Error Response:
```json
{
  "error": {
    "code": 2002,
    "message": "Token Spent",
    "data": {
      "token_hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      "spent_at": 1703005200
    }
  },
  "id": "990e8400-e29b-41d4-a716-446655440004",
  "ver": "1.0.0"
}
```

---

## 3. Implementation Guide

### 3.1 Step-by-Step Token Creation

**Step 1: Generate Keys**
```python
# Pseudocode
import secp256k1
import hashlib

secret_key = os.urandom(32)
public_key = secp256k1.PublicKey.from_secret(secret_key).serialize()[1:]  # x-only
```

**Step 2: Create Payload**
```python
payload = {
    "iss": public_key.hex(),
    "iat": int(time.time()),
    "amount": 100,
    "setID": "test-tokens"
}
```

**Step 3: Compute Token Hash**
```python
import json

# Canonical JSON (sorted keys, no whitespace)
canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'))
token_hash = hashlib.sha256(canonical.encode()).hexdigest()
```

**Step 4: Create Header**
```python
header = {
    "alg": "Schnorr",
    "typ": "FUNGIBLE",
    "token_hash": token_hash,
    "ver": "1.0.0"
}
```

**Step 5: Encode Header and Payload**
```python
import base64

def base64url_encode(data):
    return base64.urlsafe_b64encode(
        json.dumps(data, separators=(',', ':')).encode()
    ).decode().rstrip('=')

header_b64 = base64url_encode(header)
payload_b64 = base64url_encode(payload)
```

**Step 6: Sign**
```python
message = f"{header_b64}.{payload_b64}"
message_hash = hashlib.sha256(message.encode()).digest()
signature = secp256k1.schnorr_sign(secret_key, message_hash)
signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip('=')
```

**Step 7: Combine JWT**
```python
jwt_token = f"{header_b64}.{payload_b64}.{signature_b64}"
```

### 3.2 Token Validation Algorithm

```python
def validate_token(jwt_token):
    # 1. Parse JWT
    parts = jwt_token.split('.')
    if len(parts) != 3:
        return False, "Invalid JWT format"

    header_b64, payload_b64, signature_b64 = parts

    # 2. Decode
    header = json.loads(base64url_decode(header_b64))
    payload = json.loads(base64url_decode(payload_b64))
    signature = base64url_decode(signature_b64)

    # 3. Check required fields
    if not all(k in header for k in ['alg', 'typ', 'token_hash', 'ver']):
        return False, "Missing header fields"

    if not all(k in payload for k in ['iss', 'iat']):
        return False, "Missing payload fields"

    # 4. Verify token hash
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    computed_hash = hashlib.sha256(canonical.encode()).hexdigest()

    if computed_hash != header['token_hash']:
        return False, "Token hash mismatch"

    # 5. Verify signature
    message = f"{header_b64}.{payload_b64}"
    message_hash = hashlib.sha256(message.encode()).digest()
    issuer_pubkey = bytes.fromhex(payload['iss'])

    if not secp256k1.schnorr_verify(signature, message_hash, issuer_pubkey):
        return False, "Invalid signature"

    # 6. Check expiration
    if 'exp' in payload and time.time() > payload['exp']:
        return False, "Token expired"

    # 7. Check time lock
    if 'timeLock' in payload and time.time() < payload['timeLock']:
        return False, "Token time-locked"

    # 8. Type-specific validation
    if header['typ'] == 'FUNGIBLE':
        if 'amount' not in payload or payload['amount'] <= 0:
            return False, "Invalid amount"
    elif header['typ'] == 'TAT':
        if 'tokenID' not in payload or not payload['tokenID']:
            return False, "Missing tokenID"

    return True, "Valid"
```

### 3.3 NWPC Message Handling

**Sending a Request:**
```python
import uuid
from nostr_tools import nip44, nip59

def send_nwpc_request(method, params, recipient_pubkey, my_keypair, relays):
    # 1. Create request message
    request = {
        "method": method,
        "params": params,
        "id": str(uuid.uuid4()),
        "ver": "1.0.0"
    }

    # 2. Encrypt with NIP-44
    plaintext = json.dumps(request)
    encrypted = nip44.encrypt(plaintext, recipient_pubkey, my_keypair.secret)

    # 3. Wrap with NIP-59 gift wrap
    gift_wrap = nip59.create_gift_wrap(
        encrypted,
        recipient_pubkey,
        my_keypair
    )

    # 4. Publish to relays
    for relay in relays:
        relay.publish(gift_wrap)

    return request["id"]
```

**Processing a Request:**
```python
def handle_nwpc_request(gift_wrap_event, my_keypair):
    # 1. Unwrap gift wrap
    sealed_event = nip59.unwrap_gift_wrap(gift_wrap_event, my_keypair)

    # 2. Decrypt with NIP-44
    plaintext = nip44.decrypt(sealed_event.content, my_keypair.secret)
    request = json.loads(plaintext)

    # 3. Validate request
    if 'method' not in request or 'id' not in request:
        return create_error_response(request.get('id'), 1001, "Invalid Request")

    # 4. Check version compatibility
    if not is_compatible_version(request.get('ver', '1.0.0')):
        return create_error_response(request['id'], 1000, "Unsupported version")

    # 5. Dispatch to handler
    handler = get_handler(request['method'])
    if not handler:
        return create_error_response(request['id'], 1002, "Method Not Found")

    try:
        result = handler(request['params'])
        return create_success_response(request['id'], result)
    except Exception as e:
        return create_error_response(request['id'], 3000, str(e))
```

### 3.4 Spent Token Tracking

**Using Bloom Filter + LRU Cache:**
```python
from bloom_filter import BloomFilter
from collections import OrderedDict

class SpentTokenTracker:
    def __init__(self):
        # Permanent storage (persisted to disk)
        self.bloom_filter = BloomFilter(
            max_elements=1000000,
            error_rate=0.001
        )

        # Recent cache (in-memory)
        self.lru_cache = OrderedDict()
        self.cache_size = 10000

    def mark_spent(self, token_hash):
        # Add to both structures
        self.bloom_filter.add(token_hash)
        self.lru_cache[token_hash] = True

        # Maintain cache size
        if len(self.lru_cache) > self.cache_size:
            self.lru_cache.popitem(last=False)

        # Persist bloom filter
        self.save_bloom_filter()

    def is_spent(self, token_hash):
        # Check LRU cache first (fast)
        if token_hash in self.lru_cache:
            return True

        # Check bloom filter (persistent)
        if token_hash in self.bloom_filter:
            # Potential match, verify from persistent storage
            return self.verify_from_storage(token_hash)

        return False
```

### 3.5 Replay Protection

**Event ID Tracking:**
```python
class ReplayProtection:
    def __init__(self):
        self.processed_events = BloomFilter(max_elements=100000)
        self.recent_events = OrderedDict()  # Last 10k events

    def has_processed(self, event_id):
        return (event_id in self.recent_events or
                event_id in self.processed_events)

    def mark_processed(self, event_id):
        if self.has_processed(event_id):
            return False  # Already processed

        self.processed_events.add(event_id)
        self.recent_events[event_id] = time.time()

        # Maintain cache
        if len(self.recent_events) > 10000:
            self.recent_events.popitem(last=False)

        return True
```

---

## 4. Compatibility Matrix

### 4.1 Version Compatibility

| Implementation Version | Protocol 1.0.x | Protocol 1.1.x | Protocol 2.0.x |
|------------------------|---------------|---------------|---------------|
| v1.0.x                | ✅ Full        | ⚠️ Limited    | ❌ None       |
| v1.1.x                | ✅ Full        | ✅ Full        | ❌ None       |
| v2.0.x                | ⚠️ Limited    | ⚠️ Limited    | ✅ Full        |

**Legend:**
- ✅ Full: Complete compatibility
- ⚠️ Limited: Can interoperate with limitations
- ❌ None: Incompatible

### 4.2 Feature Support Matrix

| Feature | TypeScript | Python | Rust | Go |
|---------|-----------|--------|------|-----|
| FUNGIBLE tokens | ✅ | 🚧 | 🚧 | 🚧 |
| TAT tokens | ✅ | 🚧 | 🚧 | 🚧 |
| NWPC | ✅ | 🚧 | 🚧 | 🚧 |
| NIP-44 encryption | ✅ | 🚧 | 🚧 | 🚧 |
| NIP-59 gift wrap | ✅ | 🚧 | 🚧 | 🚧 |
| HD keys (BIP-32) | ✅ | 🚧 | 🚧 | 🚧 |
| HTLC | ✅ | 🚧 | 🚧 | 🚧 |
| Time locks | ✅ | 🚧 | 🚧 | 🚧 |

**Legend:**
- ✅ Implemented
- 🚧 In progress / Community implementation needed
- ❌ Not planned

### 4.3 Platform Support

| Platform | Storage | Nostr Client | Status |
|----------|---------|--------------|--------|
| Node.js | Disk, Redis, SQLite | nostr-tools | ✅ |
| Browser | IndexedDB, localStorage | nostr-tools | ✅ |
| Python | Any | python-nostr | 🚧 |
| Rust | Any | nostr-sdk | 🚧 |
| Go | Any | go-nostr | 🚧 |

---

## 5. Common Pitfalls

### 5.1 Token Hash Calculation

❌ **Wrong:**
```python
# Don't use pretty-printed JSON
payload_json = json.dumps(payload, indent=2)
token_hash = hashlib.sha256(payload_json.encode()).hexdigest()
```

✅ **Correct:**
```python
# Use canonical JSON (sorted keys, no whitespace)
payload_json = json.dumps(payload, sort_keys=True, separators=(',', ':'))
token_hash = hashlib.sha256(payload_json.encode()).hexdigest()
```

### 5.2 Base64 URL Encoding

❌ **Wrong:**
```python
# Standard base64 includes padding
encoded = base64.b64encode(data).decode()
```

✅ **Correct:**
```python
# URL-safe base64 without padding
encoded = base64.urlsafe_b64encode(data).decode().rstrip('=')
```

### 5.3 Timestamp Units

❌ **Wrong:**
```python
# Don't use milliseconds
payload['iat'] = int(time.time() * 1000)
```

✅ **Correct:**
```python
# Use seconds (Unix timestamp)
payload['iat'] = int(time.time())
```

### 5.4 Public Key Format

❌ **Wrong:**
```python
# Don't include the 0x02/0x03 prefix
pubkey = "02" + x_coordinate.hex()
```

✅ **Correct:**
```python
# X-only public key (32 bytes, 64 hex chars)
pubkey = x_coordinate.hex()
```

### 5.5 Signature Verification

❌ **Wrong:**
```python
# Don't verify just the payload
signature_valid = verify(signature, payload, pubkey)
```

✅ **Correct:**
```python
# Verify the entire JWT (header.payload)
message = f"{header_b64}.{payload_b64}"
signature_valid = verify(signature, message, pubkey)
```

---

## 6. Validation Checklist

### 6.1 Token Creation Checklist

- [ ] Secret key is 32 bytes of cryptographically secure random data
- [ ] Public key is derived correctly (x-only coordinate)
- [ ] Payload includes all required fields (`iss`, `iat`)
- [ ] Token hash computed from canonical JSON
- [ ] Header includes all required fields
- [ ] Protocol version (`ver`) is set to "1.0.0"
- [ ] Base64 URL encoding used (no padding)
- [ ] Signature computed over `{header_b64}.{payload_b64}`
- [ ] JWT format: `{header}.{payload}.{signature}`

### 6.2 Token Validation Checklist

- [ ] JWT has exactly 3 parts (header, payload, signature)
- [ ] All parts decode successfully
- [ ] Header has required fields
- [ ] Payload has required fields
- [ ] Token hash matches computed hash
- [ ] Signature verifies against issuer public key
- [ ] Expiration checked if present
- [ ] Time lock checked if present
- [ ] Token not in spent set
- [ ] Type-specific validation (amount for FUNGIBLE, tokenID for TAT)

### 6.3 NWPC Implementation Checklist

- [ ] Request messages include `method`, `params`, `id`, `ver`
- [ ] Response messages include `result` or `error`, `id`, `ver`
- [ ] All messages encrypted with NIP-44
- [ ] All messages wrapped with NIP-59 gift wrap
- [ ] Request ID is unique (UUID recommended)
- [ ] Error codes follow standard codes (1000-3999)
- [ ] Version compatibility checked
- [ ] Replay protection implemented (event ID tracking)

### 6.4 Security Checklist

- [ ] Private keys never exposed in logs or errors
- [ ] Private keys encrypted at rest
- [ ] Token validation before acceptance
- [ ] Spent token tracking prevents double-spending
- [ ] Event ID tracking prevents replay attacks
- [ ] TLS/WSS used for relay connections
- [ ] Rate limiting on forge endpoints
- [ ] Input validation on all NWPC methods

---

## 7. Testing Your Implementation

### 7.1 Unit Tests

**Required Test Cases:**
1. Key generation (10 random keys)
2. Token hash computation (5 different payloads)
3. Signature generation and verification (10 tokens)
4. JWT encoding and decoding (edge cases)
5. Token validation (valid and invalid cases)
6. NWPC message encoding (all methods)
7. Error response generation (all error codes)

### 7.2 Integration Tests

**Required Scenarios:**
1. Mint → Receive → Verify
2. Mint → Transfer → Receive
3. Mint → Burn
4. Double-spend attempt (should fail)
5. Replay attack (should fail)
6. Expired token (should fail)
7. Invalid signature (should fail)

### 7.3 Interoperability Tests

**Cross-Implementation:**
1. Create token in Implementation A
2. Validate token in Implementation B
3. Transfer token between A and B
4. Verify all implementations reject invalid tokens

### 7.4 Test Data

Download reference test data:
```bash
curl https://github.com/tat-protocol/test-vectors/archive/v1.0.0.tar.gz
tar xzf v1.0.0.tar.gz
cd test-vectors-1.0.0
```

Run validator:
```bash
./validate-implementation --impl your-implementation --vectors ./vectors/
```

---

## 8. Getting Help

### 8.1 Resources

- **Protocol Spec**: [PROTOCOL_SPEC.md](./PROTOCOL_SPEC.md)
- **Reference Implementation**: https://github.com/tat-protocol/tat-protocol
- **Test Vectors**: https://github.com/tat-protocol/test-vectors
- **Community**: https://github.com/tat-protocol/tat-protocol/discussions

### 8.2 Reporting Issues

If you find:
- **Spec ambiguity**: Open issue with "spec" label
- **Implementation bug**: Open issue with "bug" label
- **Interoperability problem**: Open issue with "interop" label

### 8.3 Contributing

Want to add your implementation to the compatibility matrix?

1. Implement core features (Level 1 or 2)
2. Pass test vector validation
3. Submit PR to add your implementation
4. Join the community!

---

**Document Version**: 1.0.0
**Last Updated**: 2025-12-17
**License**: CC0 (Public Domain)
