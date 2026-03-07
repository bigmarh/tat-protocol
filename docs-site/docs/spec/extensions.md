# Protocol Extensions

TAT Protocol supports extension through custom token fields, custom NWPC methods, and discovery events.

## Extension fields (`ext`)

Any token can include an `ext` object with application-defined data:

```json
{
  "ext": {
    "event": "Summer Concert 2026",
    "seat": "A1",
    "tier": "VIP",
    "transferable": false
  }
}
```

Rules:
- `ext` is optional
- Must be valid JSON
- Included in the token hash (signed by issuer)
- No standardized fields — application-defined

## Custom NWPC methods

Applications can register custom methods on Forge, Gate, or Booth:

```ts
server.use("x-my-custom-method", async (req, ctx, res) => {
  const params = JSON.parse(req.params);
  await res.send({ result: "custom response" });
});
```

Standard methods use no prefix. Custom methods SHOULD use the `x-` prefix to avoid collisions.

## Gate protocol

### `gate.challenge`

Issue an access challenge to a token holder.

**Request:**
```json
{
  "method": "gate.challenge",
  "params": {
    "resource": "concert-entrance",
    "requirements": { "issuer": "forgePubkey", "tokenType": "TAT" }
  }
}
```

**Response:**
```json
{
  "result": {
    "challengeId": "uuid",
    "nonce": "random-nonce",
    "expiresAt": 1700000060
  }
}
```

### `gate.verify`

Submit proof to complete a challenge.

**Request:**
```json
{
  "method": "gate.verify",
  "params": {
    "challengeId": "uuid",
    "token": "tokenJWT",
    "proof": "signature-over-nonce"
  }
}
```

**Response:**
```json
{
  "result": {
    "granted": true,
    "sessionToken": "session-jwt",
    "expiresAt": 1700003600
  }
}
```

## Booth protocol

### `booth.catalog`

Browse available items.

**Response:**
```json
{
  "result": {
    "items": [
      {
        "itemId": "concert-ticket",
        "name": "VIP Ticket",
        "price": { "amount": 50, "currency": "TAT" },
        "available": 100
      }
    ]
  }
}
```

### `booth.invoice`

Create an order and receive an invoice.

**Request:**
```json
{
  "method": "booth.invoice",
  "params": {
    "itemId": "concert-ticket",
    "quantity": 2,
    "buyerAddress": "receive-pubkey"
  }
}
```

**Response:**
```json
{
  "result": {
    "invoiceId": "uuid",
    "amount": { "amount": 100, "currency": "TAT" },
    "paymentMethods": ["TAT"],
    "expiresAt": 1700000600
  }
}
```

### `booth.pay`

Submit payment for an invoice.

### `booth.receipt`

Retrieve a receipt after fulfillment.

## HTLC protocol

Hash Time-Locked Contracts enable atomic swaps between different Forges.

### Flow

1. Alice locks tokens with an HTLC hash on Forge A
2. Bob locks tokens with the same HTLC hash on Forge B
3. Alice reveals the preimage to claim Bob's tokens on Forge B
4. Bob uses the revealed preimage to claim Alice's tokens on Forge A

Both parties either complete the swap or both get refunded after the time lock expires.

## Forge authorization

Third-party Forge authorization allows delegated minting:

```ts
// Forge owner authorizes another key to mint
await forge.addAuthorizedForger(delegatePubkey);

// Authorized forger can now mint on behalf of the forge
// The forge's onlyAuthorized middleware checks this
```

## Discovery events

TAT Protocol uses Nostr event kinds for service discovery:

| Kind | Purpose |
|------|---------|
| 30100 | Forge discovery (announces a token issuer) |
| 30101 | Gate discovery (announces an access verifier) |
| 30102 | Booth discovery (announces a commerce endpoint) |

These events allow clients to discover available services on the Nostr network.
