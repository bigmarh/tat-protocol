# Agent Payment Flow: Calling a Paid NWPC Method

This document describes the complete user flow for an AI agent calling a paid method on an NWPC server.

## Scenario

An AI agent wants to use a paid text generation service. The service costs 100 tokens per call.

**Server Registration:**
```typescript
server.use("ai.generate", tokenAuth, handler, {
  description: "Generate AI response",
  tokenAuth: {
    mode: "payment",
    cost: 100,
    issuerPubkey: FORGE_PUBKEY,
    acquireMethod: "forge",
  },
  idempotent: false,
});
```

---

## Step 1: Discovery

Agent contacts server to discover capabilities:

```typescript
// Agent
const info = await peer.request("nwpc.info", {}, SERVER_PUBKEY);
```

**Response:**
```json
{
  "server": {
    "name": "AI Generation Service",
    "version": "1.0.0",
    "pubkey": "npub1server..."
  },
  "protocol": { "name": "NWPC", "version": "1.0" },
  "methods": [
    {
      "name": "ai.generate",
      "description": "Generate AI response",
      "params": {
        "prompt": { "type": "string", "required": true },
        "maxTokens": { "type": "number", "default": 500 }
      },
      "tokenAuth": {
        "mode": "payment",
        "cost": 100,
        "issuerPubkey": "npub1forge...",
        "acquireMethod": "forge"
      },
      "idempotent": false
    }
  ]
}
```

---

## Step 2: Agent Reasoning

Agent analyzes the introspection response and determines:

| Field | Value | Meaning |
|-------|-------|---------|
| `tokenAuth.mode` | `"payment"` | Token is spent on use (not reusable) |
| `tokenAuth.cost` | `100` | Each call costs 100 token units |
| `tokenAuth.issuerPubkey` | `"npub1forge..."` | Tokens must come from this forge |
| `tokenAuth.acquireMethod` | `"forge"` | Call this method on issuer to get tokens |
| `idempotent` | `false` | Don't retry with same token on timeout |

---

## Step 3: Acquire Payment Token

Agent calls the forge to mint tokens:

```typescript
// Agent requests 100 tokens (exact cost) locked to itself
const tokenResponse = await peer.request(
  "forge",                    // acquireMethod from discovery
  { amount: 100, to: AGENT_PUBKEY },
  "npub1forge..."             // issuerPubkey from discovery
);
```

**Response:**
```json
{
  "result": {
    "token": "eyJhbGciOiJTY2hub3JyIiwidHlwIjoiRlVOR0lCTEUiLCJ0b2tlbl9oYXNoIjoiYWJjMTIzLi4uIn0.eyJpc3MiOiJucHViMWZvcmdlLi4uIiwiaWF0IjoxNzA5MTIzNDU2LCJhbW91bnQiOjEwMCwiUDJQS2xvY2siOiJucHViMWFnZW50Li4uIn0.c2lnbmF0dXJlLi4u"
  }
}
```

**Token Contents (decoded):**
```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "FUNGIBLE",
    "token_hash": "abc123..."
  },
  "payload": {
    "iss": "npub1forge...",
    "iat": 1709123456,
    "amount": 100,
    "P2PKlock": "npub1agent..."
  }
}
```

---

## Step 4: Call Protected Method

Agent calls `ai.generate` with the payment token:

```typescript
const result = await peer.request(
  "ai.generate",
  {
    _token: tokenResponse.result.token,  // Payment token in _token param
    prompt: "Explain quantum computing in simple terms",
    maxTokens: 500
  },
  SERVER_PUBKEY
);
```

---

## Step 5: Server-Side Processing

```
1. Request arrives at server
   ↓
2. tokenAuth middleware extracts _token from params
   ↓
3. Validates token:
   ✓ Signature valid (signed by npub1forge...)
   ✓ Not expired
   ✓ Issuer matches required issuerPubkey
   ✓ Amount (100) >= cost (100)
   ✓ Not already spent (checks with forge)
   ↓
4. Sets ctx.paymentToken and ctx.paymentCost = 100
   ↓
5. Calls next() → handler executes AI generation
   ↓
6. Handler succeeds → marks token as spent with forge
   ↓
7. Returns response to agent
```

---

## Step 6: Response

**Success:**
```json
{
  "result": {
    "text": "Quantum computing uses quantum bits or 'qubits' which can exist in multiple states simultaneously, unlike classical bits that are either 0 or 1...",
    "tokensUsed": 487,
    "receipt": "tx_abc123..."
  }
}
```

**Error - Token Already Spent:**
```json
{
  "error": {
    "code": 2002,
    "message": "Token already spent"
  }
}
```

**Error - Insufficient Amount:**
```json
{
  "error": {
    "code": 2003,
    "message": "Insufficient amount: need 100, got 50"
  }
}
```

---

## Step 7: Agent Handles Result

```typescript
if (result.error) {
  switch (result.error.code) {
    case 2000:
    case 2001:
      // Token invalid or expired - get new token
      break;
    case 2002:
    case 2003:
      // Token spent or insufficient amount
      // Since idempotent=false, DON'T auto-retry (risk of double-charge)
      throw new Error("Payment failed - manual intervention needed");
    case 2008:
    case 2009:
      // Wrong issuer or audience
      break;
  }
} else {
  // Success - use the generated text
  console.log(result.result.text);
}
```

---

## Complete Agent Implementation

```typescript
async function generateWithPayment(prompt: string): Promise<string> {
  // 1. Discover server capabilities
  const info = await peer.request("nwpc.info", {}, SERVER_PUBKEY);
  const method = info.result.methods.find(m => m.name === "ai.generate");

  if (!method?.tokenAuth) {
    throw new Error("Method not found or no auth required");
  }

  const { issuerPubkey, cost, acquireMethod } = method.tokenAuth;

  // 2. Acquire payment token from forge
  const tokenRes = await peer.request(
    acquireMethod,
    { amount: cost, to: AGENT_PUBKEY },
    issuerPubkey
  );

  if (tokenRes.error) {
    throw new Error(`Failed to get token: ${tokenRes.error.message}`);
  }

  // 3. Call the paid method with token
  const result = await peer.request(
    "ai.generate",
    {
      _token: tokenRes.result.token,
      prompt
    },
    SERVER_PUBKEY
  );

  if (result.error) {
    throw new Error(`Generation failed: ${result.error.message}`);
  }

  return result.result.text;
}

// Usage
const text = await generateWithPayment("Explain quantum computing");
```

---

## Edge Cases & Agent Behavior

| Scenario | Error Code | Agent Behavior |
|----------|------------|----------------|
| Token expired before use | 2001 | Get new token, retry |
| Token already spent | 2002 | Get new token, but **don't auto-retry** (`idempotent=false`) |
| Insufficient amount | 2003 | Get token with higher amount |
| Wrong issuer | 2009 | Find correct forge from `issuerPubkey` |
| Wrong audience | 2008 | Token bound to different server |
| Network timeout | - | **Don't retry** - might double-charge |
| Overpayment (200 for 100 cost) | - | Server returns `changeToken` with 100 remaining |

---

## Overpayment & Change

If agent sends more tokens than required:

```typescript
// Agent sends 200 tokens for a 100-cost method
const result = await peer.request("ai.generate", {
  _token: tokenWith200Units,
  prompt: "..."
}, SERVER_PUBKEY);
```

**Response with change:**
```json
{
  "result": {
    "text": "...",
    "changeToken": "eyJ...change token JWT with 100 remaining..."
  }
}
```

Agent should save the `changeToken` for future use.

---

## Agent Discovery Flow (Summary)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PAYMENT TOKEN FLOW                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

1. DISCOVERY
   Agent ──────────────────────────────────────────────────────► Server
         nwpc.info
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { methods: [{ tokenAuth: { mode: "payment", cost: 100,
                                    issuerPubkey: "npub1forge...",
                                    acquireMethod: "forge" },
                       idempotent: false }] }

2. TOKEN ACQUISITION (to forge)
   Agent ──────────────────────────────────────────────────────► Forge
         forge({ amount: 100, to: agentPubkey })
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { token: "eyJ..." }   // Single-use payment token

3. CALL PAID METHOD
   Agent ──────────────────────────────────────────────────────► Server
         ai.generate({ _token: "eyJ...", prompt: "..." })
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { result: { text: "...", changeToken?: "eyJ..." } }

   ⚠️  Token is NOW SPENT - cannot be reused!

4. FOR NEXT CALL
   └──► Go back to step 2, get NEW token from forge
        (DO NOT retry on timeout if idempotent=false)
```

**Compact version:**
```
1. Agent → Server.nwpc.info
   ← { tokenAuth: { mode: "payment", cost, issuerPubkey, acquireMethod }, idempotent }

2. Agent → Forge.acquireMethod({ amount: cost })   // Get fresh token each call
   ← { token: "eyJ..." }

3. Agent → Server.method({ _token, ...params })    // Token spent on this call
   ← { result, changeToken? }

4. Next call → Get NEW token (step 2)
   ⚠️ On timeout + idempotent=false → DON'T retry (risk double-charge)
```

---

## Security Considerations

1. **Audience binding**: Tokens can be bound to a specific server pubkey to prevent replay across servers
2. **P2PK lock**: Tokens are locked to the agent's pubkey - only the agent can spend them
3. **Spent tracking**: Server verifies with forge that token hasn't been double-spent
4. **Idempotency flag**: Critical for payment methods - tells agents whether retry is safe
5. **No auto-retry on timeout**: For `idempotent: false`, agents should NOT automatically retry as the original request may have succeeded
