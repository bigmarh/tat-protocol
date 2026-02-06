# Agent Access Flow: Using Third-Party Bearer Tokens

This document describes the complete user flow for an AI agent calling a method protected by a third-party access token issuer.

## Scenario

An AI agent wants to use a profile service. The service requires a bearer token from a trusted identity provider (not the service itself).

**Server Registration:**
```typescript
server.use("user.profile", tokenAuth, profileHandler, {
  description: "Get user profile",
  tokenAuth: {
    mode: "bearer",
    scopes: ["profile:read"],
    issuerPubkey: IDENTITY_PROVIDER_PUBKEY,  // Third-party issuer
    acquireMethod: "auth.token",
    acquireHint: "Get access token from identity provider",
    relays: ["wss://identity.example.com"],  // Where to find the issuer
  },
});
```

---

## Step 1: Discovery

Agent contacts service to discover capabilities:

```typescript
// Agent
const info = await peer.request("nwpc.info", {}, SERVICE_PUBKEY);
```

**Response:**
```json
{
  "server": {
    "name": "User Profile Service",
    "version": "1.0.0",
    "pubkey": "npub1service..."
  },
  "protocol": { "name": "NWPC", "version": "1.0" },
  "methods": [
    {
      "name": "user.profile",
      "description": "Get user profile",
      "params": {
        "userId": { "type": "string", "required": false }
      },
      "tokenAuth": {
        "mode": "bearer",
        "scopes": ["profile:read"],
        "issuerPubkey": "npub1identity...",
        "acquireMethod": "auth.token",
        "acquireHint": "Get access token from identity provider",
        "relays": ["wss://identity.example.com"]
      }
    }
  ]
}
```

---

## Step 2: Agent Reasoning

Agent analyzes the introspection response and determines:

| Field | Value | Meaning |
|-------|-------|---------|
| `tokenAuth.mode` | `"bearer"` | Token is reusable (not spent on use) |
| `tokenAuth.scopes` | `["profile:read"]` | Token must have this scope |
| `tokenAuth.issuerPubkey` | `"npub1identity..."` | Tokens must come from this identity provider |
| `tokenAuth.acquireMethod` | `"auth.token"` | Call this method to get a token |
| `tokenAuth.relays` | `["wss://identity..."]` | Connect to these relays to reach issuer |

**Key difference from payment:** The issuer is a THIRD PARTY, not the service itself.

---

## Step 3: Connect to Identity Provider

Agent connects to the identity provider's relays:

```typescript
// Agent connects to third-party identity provider
const identityPeer = new NWPCPeer({
  keys: AGENT_KEYS,
  storage: agentStorage,
  relays: ["wss://identity.example.com"],  // From discovery
});
await identityPeer.connect();
```

---

## Step 4: Acquire Access Token

Agent requests a scoped access token from the identity provider:

```typescript
// Request access token with required scopes
const tokenResponse = await identityPeer.request(
  "auth.token",                    // acquireMethod from discovery
  {
    scopes: ["profile:read"],      // Required scopes from discovery
    audience: SERVICE_PUBKEY,      // Optional: bind to specific service
  },
  "npub1identity..."               // issuerPubkey from discovery
);
```

**Response:**
```json
{
  "result": {
    "token": "eyJhbGciOiJTY2hub3JyIiwidHlwIjoiVEFUIn0.eyJpc3MiOiJucHViMWlkZW50aXR5Li4uIiwiaWF0IjoxNzA5MTIzNDU2LCJleHAiOjE3MDkyMDk4NTYsImFjY2Vzc1J1bGVzIjp7InNjb3BlcyI6WyJwcm9maWxlOnJlYWQiXX19.c2lnbmF0dXJl",
    "expiresAt": 1709209856
  }
}
```

**Token Contents (decoded):**
```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "TAT"
  },
  "payload": {
    "iss": "npub1identity...",
    "iat": 1709123456,
    "exp": 1709209856,
    "aud": "npub1service...",
    "accessRules": {
      "scopes": ["profile:read"]
    }
  }
}
```

**Note:** Bearer tokens have:
- `exp` (expiration) - can be reused until expired
- `accessRules.scopes` - what actions are permitted
- `aud` (audience) - optionally bound to specific service
- NO `amount` field (not payment tokens)

---

## Step 5: Call Protected Method

Agent calls the service with the bearer token:

```typescript
const result = await servicePeer.request(
  "user.profile",
  {
    _token: tokenResponse.result.token,  // Bearer token in _token param
    userId: "alice"
  },
  SERVICE_PUBKEY
);
```

---

## Step 6: Server-Side Processing

```
1. Request arrives at service
   |
2. tokenAuth middleware extracts _token from params
   |
3. Validates token:
   * Signature valid (signed by npub1identity...)
   * Not expired (exp > now)
   * Issuer matches required issuerPubkey
   * Has required scopes (profile:read)
   * Audience matches (if token has aud field)
   |
4. Sets ctx.validatedToken = token
   |
5. Calls next() -> handler executes
   |
6. Returns response
   (Bearer token NOT marked as spent - can be reused)
```

---

## Step 7: Token Reuse

**Key difference from payment tokens:** Bearer tokens can be reused until they expire.

```typescript
// Agent caches the token
let cachedToken = tokenResponse.result.token;
let tokenExpiry = tokenResponse.result.expiresAt;

// Reuse for multiple calls
const profile1 = await servicePeer.request("user.profile", {
  _token: cachedToken,
  userId: "alice"
}, SERVICE_PUBKEY);

const profile2 = await servicePeer.request("user.profile", {
  _token: cachedToken,  // Same token!
  userId: "bob"
}, SERVICE_PUBKEY);

// Check expiry before use
if (Date.now() / 1000 > tokenExpiry - 60) {
  // Token expiring soon, refresh it
  const newToken = await identityPeer.request("auth.token", {
    scopes: ["profile:read"],
  }, IDENTITY_PROVIDER_PUBKEY);
  cachedToken = newToken.result.token;
  tokenExpiry = newToken.result.expiresAt;
}
```

---

## Complete Agent Implementation

```typescript
class TokenCache {
  private tokens = new Map<string, { jwt: string; expiresAt: number }>();

  get(key: string): string | undefined {
    const entry = this.tokens.get(key);
    if (!entry) return undefined;
    // Return if not expiring within 60 seconds
    if (Date.now() / 1000 < entry.expiresAt - 60) {
      return entry.jwt;
    }
    this.tokens.delete(key);
    return undefined;
  }

  set(key: string, jwt: string, expiresAt: number): void {
    this.tokens.set(key, { jwt, expiresAt });
  }
}

const tokenCache = new TokenCache();

async function callProtectedMethod(
  servicePeer: NWPCPeer,
  method: string,
  params: Record<string, unknown>,
  servicePubkey: string
): Promise<unknown> {
  // 1. Discover service capabilities
  const info = await servicePeer.request("nwpc.info", {}, servicePubkey);
  const methodInfo = info.result.methods.find(m => m.name === method);

  if (!methodInfo?.tokenAuth) {
    // No auth required
    return servicePeer.request(method, params, servicePubkey);
  }

  const { mode, issuerPubkey, scopes, acquireMethod, relays } = methodInfo.tokenAuth;

  if (mode !== "bearer") {
    throw new Error("This example handles bearer tokens only");
  }

  // 2. Check cache for valid token
  const cacheKey = `${issuerPubkey}:${scopes?.join(",")}`;
  let token = tokenCache.get(cacheKey);

  // 3. Acquire new token if needed
  if (!token) {
    // Connect to identity provider
    const identityPeer = new NWPCPeer({
      keys: AGENT_KEYS,
      storage: agentStorage,
      relays: relays || DEFAULT_RELAYS,
    });
    await identityPeer.connect();

    // Request scoped access token
    const tokenRes = await identityPeer.request(
      acquireMethod,
      { scopes, audience: servicePubkey },
      issuerPubkey
    );

    if (tokenRes.error) {
      throw new Error(`Failed to get token: ${tokenRes.error.message}`);
    }

    token = tokenRes.result.token;
    tokenCache.set(cacheKey, token, tokenRes.result.expiresAt);

    await identityPeer.disconnect();
  }

  // 4. Call the protected method
  const result = await servicePeer.request(
    method,
    { _token: token, ...params },
    servicePubkey
  );

  // 5. Handle token expiry
  if (result.error?.code === 2000 || result.error?.code === 2001) {
    // Token invalid/expired, clear cache and retry once
    tokenCache.tokens.delete(cacheKey);
    return callProtectedMethod(servicePeer, method, params, servicePubkey);
  }

  return result;
}

// Usage
const profile = await callProtectedMethod(
  servicePeer,
  "user.profile",
  { userId: "alice" },
  SERVICE_PUBKEY
);
```

---

## Bearer vs Payment: When to Use Each

| Aspect | Bearer Token | Payment Token |
|--------|--------------|---------------|
| **Use case** | Access control, identity | Pay-per-call services |
| **Reusable** | Yes, until expiry | No, single use |
| **Key field** | `scopes` | `amount` |
| **Spent tracking** | Not needed | Required |
| **Cache strategy** | Cache until near expiry | Never cache |
| **Retry safe** | Yes | Only if `idempotent: true` |
| **Issuer** | Often third-party | Often service itself |

---

## Agent Discovery Flow (Summary)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BEARER TOKEN FLOW (Third-Party Issuer)                                      │
└─────────────────────────────────────────────────────────────────────────────┘

1. DISCOVERY
   Agent ──────────────────────────────────────────────────────► Service
         nwpc.info
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { methods: [{ tokenAuth: { mode: "bearer", scopes: [...],
                                    issuerPubkey: "npub1identity...",
                                    relays: ["wss://identity..."] } }] }

2. TOKEN ACQUISITION (to third-party issuer)
   Agent ──────────────────────────────────────────────────────► Identity Provider
         auth.token({ scopes: ["profile:read"], audience: servicePubkey })
         (via relays from discovery)
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { token: "eyJ...", expiresAt: 1709209856 }

3. CALL PROTECTED METHOD
   Agent ──────────────────────────────────────────────────────► Service
         user.profile({ _token: "eyJ...", userId: "alice" })
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { result: { name: "Alice", ... } }

4. REUSE TOKEN (bearer tokens don't expire on use)
   Agent ──────────────────────────────────────────────────────► Service
         user.profile({ _token: "eyJ...", userId: "bob" })  // Same token!
                                                                    │
   Agent ◄──────────────────────────────────────────────────────────┘
         { result: { name: "Bob", ... } }

5. ON EXPIRY (2001 error)
   └──► Go back to step 2, get new token from identity provider
```

**Compact version:**
```
1. Agent → Service.nwpc.info
   ← { tokenAuth: { mode: "bearer", issuerPubkey, scopes, relays } }

2. Agent → IdentityProvider.auth.token({ scopes })   // Connect via relays hint
   ← { token: "eyJ...", expiresAt }

3. Agent → Service.method({ _token, ...params })     // Can reuse until expiry
   ← { result }

4. On 2001 → Refresh token (go to step 2)
```

---

## Third-Party Issuer Benefits

1. **Separation of concerns**: Identity/auth separate from service logic
2. **Single sign-on**: One token works across multiple services
3. **Trust delegation**: Services trust the identity provider
4. **Reduced complexity**: Services don't manage user credentials

---

## Error Handling

| Scenario | Error Code | Agent Behavior |
|----------|------------|----------------|
| Token expired | 2001 | Get new token, retry |
| Wrong scopes | 2007 | Get token with correct scopes |
| Wrong issuer | 2009 | Find correct identity provider |
| Wrong audience | 2008 | Get token for this service |
| Identity provider unreachable | - | Use relay hints, fallback relays |

```typescript
if (result.error) {
  switch (result.error.code) {
    case 2000:
    case 2001:
      // Token invalid or expired
      tokenCache.delete(cacheKey);
      // Retry with fresh token
      break;
    case 2007:
    case 2008:
    case 2009:
      if (result.error.message.includes("scope")) {
        // Request token with required scopes
      } else if (result.error.message.includes("issuer")) {
        // Wrong identity provider - check issuerPubkey
      } else if (result.error.message.includes("audience")) {
        // Get token bound to this service
      }
      break;
  }
}
```

---

## Security Considerations

1. **Audience binding**: Tokens should be bound to specific service pubkey to prevent replay
2. **Scope minimization**: Request only the scopes you need
3. **Token storage**: Securely store cached tokens (memory preferred over disk)
4. **Expiry padding**: Refresh tokens before they expire (60s buffer)
5. **Issuer verification**: Only accept tokens from the declared issuer
6. **Relay trust**: Use relays specified by the service for issuer discovery
