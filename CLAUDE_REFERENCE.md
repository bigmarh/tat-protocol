# TAT Protocol - Reference Guide for Application Development

**Purpose**: This document provides comprehensive reference information about TAT Protocol to help build applications on top of the protocol.

**Target Applications**:
1. Exclusive social media platform with TAT-gated content
2. TAT discovery and tracking site (like CoinMarketCap for TATs)

---

## Table of Contents

- [What is TAT Protocol?](#what-is-tat-protocol)
- [Core Architecture](#core-architecture)
- [Token Types and Structure](#token-types-and-structure)
- [Key Components](#key-components)
- [Message Flow and NWPC](#message-flow-and-nwpc)
- [Building Applications](#building-applications)
- [Use Case 1: Exclusive Social Media Platform](#use-case-1-exclusive-social-media-platform)
- [Use Case 2: TAT Discovery Site](#use-case-2-tat-discovery-site)
- [Security Considerations](#security-considerations)
- [Code Examples](#code-examples)

---

## What is TAT Protocol?

TAT Protocol is a **decentralized token system** built on [Nostr](https://github.com/nostr-protocol/nostr) that enables:

- 🪙 **Fungible Tokens** - Digital currencies, loyalty points, credits
- 🎫 **Non-Fungible Tokens (TATs)** - Unique access tokens, tickets, memberships, collectibles
- 🔐 **End-to-end Encryption** - Private, secure transactions
- 🌐 **Decentralized** - No central server, runs on Nostr relays
- ⚡ **Fast & Lightweight** - Instant validation, no blockchain delays

### Fundamental Difference: Issuer-Authority Model

**Unlike blockchain tokenization**, TAT Protocol uses an **issuer-authority model**:

| Aspect | Blockchain Tokens | TAT Protocol |
|--------|------------------|--------------|
| **Authority** | Network consensus | Token issuer (Forge) |
| **Validation** | All network participants | Issuer validates transfers |
| **Double-Spend Prevention** | Consensus mechanism | Issuer tracks spent tokens |
| **Finality** | Probabilistic/Deterministic | Immediate upon issuer confirmation |
| **Trust** | Distributed across network | Users trust the issuer |
| **Cost** | Gas fees | Relay costs (minimal) |
| **Scalability** | Limited by consensus | Limited by issuer capacity |

**Key Principle**: The issuer (Forge) is the ultimate authority for their tokens. Users trust issuers like they trust a bank, loyalty program, or event venue.

### Perfect Use Cases

- Loyalty points (company controls their points)
- Event tickets (venue controls ticket validity)
- Membership tokens (organization controls access)
- Gift cards (merchant controls redemption)
- Access passes (gated content/communities)
- Exclusive memberships (premium content access)

---

## Core Architecture

### Building Blocks

1. **Token**: Base data structure (JWT format) for all token types
2. **TAT (Transferable Access Token)**: Non-fungible token with unique `tokenID`
3. **Forge**: The authority that mints tokens, validates transfers, tracks spent tokens
4. **Pocket**: The wallet/client that receives, stores, and spends tokens
5. **NWPC (Nostr Wrapped Procedure Calls)**: RPC protocol layer built on Nostr events

### Trust Model

Users trust:
- **Cryptography**: Schnorr signatures (secp256k1), NIP-44 encryption
- **Issuer Reputation**: Like trusting a business or organization
- **Open Protocol**: Anyone can verify token structure and signatures

Users do NOT need to trust:
- Network consensus
- Miners/validators
- Relay operators (messages are encrypted)

---

## Token Types and Structure

### Token Format

Tokens use **JWT (JSON Web Token)** format:
```
BASE64URL(Header).BASE64URL(Payload).BASE64URL(Signature)
```

### Header

```typescript
{
  "alg": "Schnorr",           // REQUIRED: Signature algorithm
  "typ": "FUNGIBLE" | "TAT",  // REQUIRED: Token type
  "token_hash": string,       // REQUIRED: SHA-256 hash of payload
  "ver": "1.0.0"             // REQUIRED: Protocol version
}
```

### Payload - Common Fields

```typescript
{
  "iss": string,              // REQUIRED: Issuer public key (64-char hex)
  "iat": number,              // REQUIRED: Issued at (Unix timestamp, seconds)
  "exp"?: number,             // OPTIONAL: Expiration timestamp
  "P2PKlock"?: string,        // OPTIONAL: Locked to public key
  "timeLock"?: number,        // OPTIONAL: Cannot spend before timestamp
  "HTLC"?: string,            // OPTIONAL: Hash for HTLC
  "data_uri"?: string,        // OPTIONAL: URI to external data
  "ext"?: object              // OPTIONAL: Extension fields (custom data)
}
```

### FUNGIBLE Tokens

```typescript
{
  "amount": number,           // REQUIRED: Token amount
  "setID"?: string           // OPTIONAL: Token set identifier (e.g., "USD", "loyalty-points")
}
```

**Example**: Loyalty points, digital currency, credits

### TAT Tokens (Non-Fungible)

```typescript
{
  "tokenID": string          // REQUIRED: Unique token identifier
}
```

**Example**: Event ticket, membership pass, collectible

### Example TAT Token

```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "TAT",
    "token_hash": "f1e2d3c4b5a6...",
    "ver": "1.0.0"
  },
  "payload": {
    "iss": "abc123...",
    "iat": 1703001600,
    "exp": 1735624800,
    "tokenID": "premium-member-2025",
    "P2PKlock": "ghi789...",
    "ext": {
      "membershipType": "Premium",
      "tier": "Gold",
      "benefits": ["Exclusive content", "Early access"],
      "profile": {
        "username": "alice",
        "avatar": "https://example.com/avatar.jpg"
      }
    }
  },
  "signature": "uvw456..."
}
```

### Extension Fields (`ext`)

The `ext` field allows custom application data:
- **Any valid JSON** - Objects, arrays, primitives
- **Included in token hash** - Tamper-proof
- **Signed by issuer** - Authenticated
- **Application-defined** - No standardized schema

**Use cases**:
- Membership details
- Event information
- Content metadata
- User profiles
- Access permissions

---

## Key Components

### 1. Forge (Token Issuer)

The **authority** that creates and validates tokens.

**Responsibilities**:
- Mint new tokens (fungible and TAT)
- Validate all transfer requests
- Track spent tokens (prevent double-spending)
- Enforce supply limits
- Maintain availability for transfers

**Example**:
```typescript
import { FungibleForge } from '@tat-protocol/tdk';

const forge = await FungibleForge.create({
  storage: new NodeStorage({ path: './.forge' }),
  keys: { secretKey, publicKey },
  relays: ['wss://relay.damus.io'],
  setID: 'premium-membership',
  denomination: [1, 12, 36], // Monthly subscriptions
  totalSupply: 10000
});
```

### 2. Pocket (Wallet)

The **client** that holds and manages tokens.

**Capabilities**:
- Receive tokens from Forge or other Pockets
- Store tokens securely
- Transfer tokens to others
- Query balances and holdings
- Check TAT ownership

**Example**:
```typescript
import { Pocket } from '@tat-protocol/tdk';

const pocket = await Pocket.create({
  storage: new NodeStorage({ path: './.pocket' }),
  keys: { secretKey, publicKey },
  relays: ['wss://relay.damus.io']
});

// Get receiving address
const address = await pocket.getNewReceiveAddress();

// Check balance
const balance = pocket.getBalance(issuerPubKey, 'premium-membership');

// Get specific TAT
const membershipTAT = pocket.getTAT(issuerPubKey, 'premium-member-2025');
```

### 3. NWPC (Network Communication)

**Nostr Wrapped Procedure Call** - RPC-style communication over Nostr.

**Security Features**:
- End-to-end encrypted (NIP-44)
- Authenticated (Nostr signatures)
- Sealed sender (NIP-59 gift wrap)
- Relay agnostic

**Standard Methods**:
- `mint` - Create new tokens
- `transfer` - Transfer tokens between users
- `burn` - Destroy tokens
- `verify` - Check token validity
- `getSupply` - Query supply information

---

## Message Flow and NWPC

### Token Lifecycle

```
1. MINTING
   Forge creates token → Signs with issuer key → Sends to Pocket
   ✓ Only issuer can mint
   ✓ Issuer signature proves authenticity

2. TRANSFER
   Holder sends tokens to Forge → Forge validates → Creates new tokens for recipient
   ✓ Forge checks not double-spent
   ✓ Forge marks old tokens as spent
   ✓ Forge creates new tokens (change if needed)

3. VALIDATION
   Token signature + Not in spent set = Valid
   ✓ Cryptographic proof (signature)
   ✓ Issuer authority (spent tracking)

4. VERIFICATION
   Application queries Pocket or Forge to check token ownership
   ✓ Check user holds specific TAT
   ✓ Verify token not expired
   ✓ Validate token metadata
```

### Communication Flow

```
┌────────┐         ┌───────┐         ┌───────┐
│ Pocket │◄────────│ Relay │────────►│ Forge │
└────────┘         └───────┘         └───────┘
    │                                    │
    │ 1. Request (encrypted NWPC)       │
    ├───────────────────────────────────►│
    │                                    │
    │ 2. Process & validate              │
    │                                    │
    │ 3. Response (encrypted NWPC)      │
    │◄───────────────────────────────────┤
```

All messages:
- Encrypted end-to-end (NIP-44)
- Signed by sender
- Transmitted via Nostr relays (kind 1059 - Gift Wrap)

---

## Building Applications

### SDK Installation

```bash
npm install @tat-protocol/tdk
```

The TDK (Token Development Kit) includes all packages:
- `@tat-protocol/forge` - Token minting
- `@tat-protocol/pocket` - Wallet functionality
- `@tat-protocol/nwpc` - Network communication
- `@tat-protocol/token` - Token creation/validation
- `@tat-protocol/storage` - Storage backends
- `@tat-protocol/utils` - Utilities
- `@tat-protocol/hdkeys` - HD key management

### Basic Setup

```typescript
import {
  Pocket,
  FungibleForge,
  NodeStorage,
  BrowserStorage,
  generateSecretKey,
  getPublicKey,
  DebugLogger
} from '@tat-protocol/tdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Enable debug logging (development only)
const Debug = DebugLogger.getInstance();
Debug.enableAll();

// Generate keys
const secretKey = bytesToHex(generateSecretKey());
const publicKey = getPublicKey(hexToBytes(secretKey));
```

### Storage Backends

**Node.js**:
```typescript
import { NodeStorage } from '@tat-protocol/tdk';
const storage = new NodeStorage({ path: './data' });
```

**Browser**:
```typescript
import { BrowserStorage } from '@tat-protocol/tdk';
const storage = new BrowserStorage(); // Uses localStorage
```

---

## Use Case 1: Exclusive Social Media Platform

### Concept

Users share exclusive media (posts, photos, videos) that can **only be viewed by holders of their TAT**.

**Example Flow**:
1. Creator mints a TAT representing "Premium Access to @alice"
2. Creator sells/distributes TATs to fans
3. Creator posts exclusive content
4. App checks if viewer holds creator's TAT
5. Content shown only to TAT holders

### Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Creator    │         │  TAT Forge   │         │   Viewer     │
│  (Issuer)    │────────►│  (Backend)   │◄────────│  (Holder)    │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                        │
       │ 1. Mint TAT           │                        │
       │ "premium-access"      │                        │
       ├──────────────────────►│                        │
       │                        │ 2. Buy/Receive TAT    │
       │                        ├───────────────────────►│
       │                        │                        │
       │ 3. Post content        │                        │
       │ (gated by TAT)         │                        │
       │                        │ 4. Request content     │
       │                        │◄───────────────────────┤
       │                        │                        │
       │                        │ 5. Verify TAT ownership│
       │                        │ (Check Pocket)         │
       │                        │                        │
       │ 6. Serve content       │                        │
       │    (if TAT held)       ├───────────────────────►│
       │◄──────────────────────────────────────────────►│
```

### Implementation Steps

#### 1. Creator Setup (Forge)

```typescript
// Creator creates a Forge for their exclusive content TATs
const creatorForge = await TATForge.create({
  storage: new NodeStorage({ path: './creator-forge' }),
  keys: { secretKey: creatorSecretKey, publicKey: creatorPubKey },
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band']
});

// Mint membership TATs for fans
await creatorForge.mintTAT({
  tokenID: `premium-access-${fanPubKey}`,
  recipient: fanAddress,
  ext: {
    creator: 'alice',
    creatorPubKey: creatorPubKey,
    tier: 'premium',
    expiresAt: '2025-12-31',
    benefits: ['Exclusive posts', 'Behind the scenes', 'Early access'],
    metadata: {
      creatorName: 'Alice',
      creatorAvatar: 'https://example.com/alice.jpg'
    }
  }
});
```

#### 2. Fan Setup (Pocket)

```typescript
// Fan creates a Pocket to receive TATs
const fanPocket = await Pocket.create({
  storage: new BrowserStorage(),
  keys: { secretKey: fanSecretKey, publicKey: fanPubKey },
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band']
});

// Fan receives TAT (automatically via NWPC)
// Check if fan holds creator's TAT
function checkAccess(creatorPubKey: string): boolean {
  // Get all TATs from this creator
  const state = fanPocket.getState();
  const creatorTokens = state.TATs.get(creatorPubKey);

  if (!creatorTokens) return false;

  // Check if any TAT is valid for premium access
  for (const [tokenID, tokenHash] of creatorTokens) {
    if (tokenID.startsWith('premium-access-')) {
      const tokenJWT = fanPocket.getToken(creatorPubKey, tokenHash);
      if (tokenJWT) {
        const token = await new Token().restore(tokenJWT);

        // Check not expired
        if (token.payload.exp && Date.now() < token.payload.exp * 1000) {
          return true; // Has valid access
        }
      }
    }
  }

  return false; // No valid TAT
}
```

#### 3. Content Gating Logic

```typescript
// Backend API endpoint
app.get('/api/posts/:postId', async (req, res) => {
  const postId = req.params.postId;
  const viewerPubKey = req.user.publicKey; // From auth

  // Get post metadata
  const post = await db.posts.findById(postId);

  if (post.isExclusive) {
    // Verify viewer holds creator's TAT
    const hasAccess = await verifyTATOwnership(
      viewerPubKey,
      post.creatorPubKey,
      'premium-access'
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Requires premium membership TAT',
        requiredTAT: {
          issuer: post.creatorPubKey,
          type: 'premium-access'
        }
      });
    }
  }

  // Serve content
  res.json({ post });
});

// TAT verification helper
async function verifyTATOwnership(
  userPubKey: string,
  issuerPubKey: string,
  tokenIDPrefix: string
): Promise<boolean> {
  // Query user's Pocket
  const userPocket = await loadUserPocket(userPubKey);
  const state = userPocket.getState();
  const tats = state.TATs.get(issuerPubKey);

  if (!tats) return false;

  for (const [tokenID, tokenHash] of tats) {
    if (tokenID.startsWith(tokenIDPrefix)) {
      const tokenJWT = userPocket.getToken(issuerPubKey, tokenHash);
      const token = await new Token().restore(tokenJWT);

      // Validate token
      if (await token.validate()) {
        // Check expiration
        if (!token.payload.exp || Date.now() < token.payload.exp * 1000) {
          return true;
        }
      }
    }
  }

  return false;
}
```

#### 4. Frontend Implementation

```typescript
// React component example
function ExclusivePost({ post, creatorPubKey }) {
  const { userPocket } = useWallet(); // Custom hook
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      const state = userPocket.getState();
      const tats = state.TATs.get(creatorPubKey);

      if (tats) {
        for (const [tokenID, tokenHash] of tats) {
          if (tokenID.startsWith('premium-access-')) {
            const tokenJWT = userPocket.getToken(creatorPubKey, tokenHash);
            const token = await new Token().restore(tokenJWT);

            if (await token.validate()) {
              if (!token.payload.exp || Date.now() < token.payload.exp * 1000) {
                setHasAccess(true);
                break;
              }
            }
          }
        }
      }

      setLoading(false);
    }

    checkAccess();
  }, [userPocket, creatorPubKey]);

  if (loading) return <Spinner />;

  if (!hasAccess) {
    return (
      <div className="locked-content">
        <Lock />
        <h3>Premium Content</h3>
        <p>This content requires a Premium Access TAT</p>
        <button onClick={() => navigate(`/creator/${creatorPubKey}/purchase`)}>
          Get Access
        </button>
      </div>
    );
  }

  return <PostContent post={post} />;
}
```

### Key Features

- **TAT-Gated Content**: Only TAT holders see exclusive posts
- **Creator Control**: Creators mint and distribute their own TATs
- **Flexible Tiers**: Different TATs for different access levels
- **Time-Limited Access**: Use `exp` field for subscriptions
- **Transferable**: Fans can resell/gift TATs to others
- **Metadata-Rich**: Store creator info, benefits, branding in `ext`

---

## Use Case 2: TAT Discovery Site

### Concept

A website like **CoinMarketCap but for TATs** - discover, track, and explore TATs issued on the Nostr network.

**Features**:
- Browse all TATs on Nostr
- View issuer information
- See TAT metadata (event details, membership info, etc.)
- Track TAT activity and transfers
- Search and filter TATs
- Display supply information

### Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Nostr Relays │────────►│  Discovery   │────────►│   Users      │
│   (Events)   │         │   Backend    │         │  (Browser)   │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                        │
       │ 1. Listen for          │                        │
       │    NWPC events         │                        │
       │    (kind 1059)         │                        │
       │                        │                        │
       │ 2. Decrypt & parse     │                        │
       │    mint events         │                        │
       │                        │                        │
       │                        │ 3. Index TAT data      │
       │                        │    in database         │
       │                        │                        │
       │                        │ 4. Query TATs          │
       │                        │◄───────────────────────┤
       │                        │                        │
       │                        │ 5. Return TAT list     │
       │                        ├───────────────────────►│
```

### Implementation Steps

#### 1. TAT Discovery Service

```typescript
import { NWPCPeer } from '@tat-protocol/tdk';
import { kinds } from 'nostr-tools';

class TATDiscoveryService {
  private nwpc: NWPCPeer;
  private db: Database; // Your database

  async start() {
    // Create NWPC peer to listen for events
    this.nwpc = new NWPCPeer({
      relays: [
        'wss://relay.damus.io',
        'wss://relay.nostr.band',
        'wss://relay.snort.social',
        'wss://nos.lol'
      ]
    });

    // Subscribe to all gift wrap events (kind 1059)
    await this.nwpc.subscribe('*', this.handleEvent.bind(this));
  }

  async handleEvent(event: NostrEvent) {
    try {
      // Attempt to decrypt NWPC message
      const message = await this.nwpc.decryptMessage(event);

      // Check if it's a mint request/response
      if (message.method === 'mint' || message.result?.token) {
        await this.indexTAT(message);
      }
    } catch (error) {
      // Not all events will be decryptable (sealed sender)
      // This is expected - only recipients can decrypt
    }
  }

  async indexTAT(message: any) {
    const tokenJWT = message.result?.token || message.params?.token;
    if (!tokenJWT) return;

    const token = await new Token().restore(tokenJWT);

    // Only index TAT tokens (not fungible)
    if (token.header.typ !== 'TAT') return;

    // Extract metadata
    const tatData = {
      tokenID: token.payload.tokenID,
      issuer: token.payload.iss,
      issuedAt: token.payload.iat,
      expiresAt: token.payload.exp,
      metadata: token.payload.ext || {},
      tokenHash: token.header.token_hash,
      discoveredAt: Date.now()
    };

    // Store in database
    await this.db.tats.upsert(tatData);

    // Update issuer stats
    await this.updateIssuerStats(token.payload.iss);
  }

  async updateIssuerStats(issuerPubKey: string) {
    const tatCount = await this.db.tats.countByIssuer(issuerPubKey);

    await this.db.issuers.upsert({
      publicKey: issuerPubKey,
      tatCount: tatCount,
      lastActivity: Date.now()
    });
  }
}
```

#### 2. Nostr Profile Integration

```typescript
// Fetch issuer metadata from Nostr
async function getIssuerProfile(issuerPubKey: string) {
  const pool = new SimplePool();

  const events = await pool.list(
    ['wss://relay.damus.io', 'wss://relay.nostr.band'],
    {
      kinds: [0], // Metadata events
      authors: [issuerPubKey],
      limit: 1
    }
  );

  if (events.length > 0) {
    const profile = JSON.parse(events[0].content);
    return {
      name: profile.name,
      about: profile.about,
      picture: profile.picture,
      nip05: profile.nip05,
      website: profile.website
    };
  }

  return null;
}
```

#### 3. API Endpoints

```typescript
// Express API example
app.get('/api/tats', async (req, res) => {
  const { page = 1, limit = 50, search, issuer, category } = req.query;

  const query: any = {};

  if (search) {
    query.$or = [
      { tokenID: { $regex: search, $options: 'i' } },
      { 'metadata.name': { $regex: search, $options: 'i' } }
    ];
  }

  if (issuer) {
    query.issuer = issuer;
  }

  if (category) {
    query['metadata.category'] = category;
  }

  const tats = await db.tats
    .find(query)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ discoveredAt: -1 });

  // Enrich with issuer profiles
  for (const tat of tats) {
    tat.issuerProfile = await getIssuerProfile(tat.issuer);
  }

  res.json({ tats, page, total: await db.tats.count(query) });
});

app.get('/api/tats/:tokenHash', async (req, res) => {
  const tat = await db.tats.findOne({ tokenHash: req.params.tokenHash });

  if (!tat) {
    return res.status(404).json({ error: 'TAT not found' });
  }

  // Get issuer profile
  tat.issuerProfile = await getIssuerProfile(tat.issuer);

  // Get transfer history (if tracked)
  tat.transfers = await db.transfers.find({ tokenHash: tat.tokenHash });

  res.json({ tat });
});

app.get('/api/issuers', async (req, res) => {
  const issuers = await db.issuers
    .find()
    .sort({ tatCount: -1 })
    .limit(100);

  // Enrich with profiles
  for (const issuer of issuers) {
    issuer.profile = await getIssuerProfile(issuer.publicKey);
  }

  res.json({ issuers });
});

app.get('/api/issuers/:pubkey', async (req, res) => {
  const issuer = await db.issuers.findOne({ publicKey: req.params.pubkey });

  if (!issuer) {
    return res.status(404).json({ error: 'Issuer not found' });
  }

  // Get profile
  issuer.profile = await getIssuerProfile(issuer.publicKey);

  // Get all TATs from this issuer
  issuer.tats = await db.tats
    .find({ issuer: issuer.publicKey })
    .sort({ issuedAt: -1 });

  res.json({ issuer });
});
```

#### 4. Frontend Components

```typescript
// React TAT List
function TATList() {
  const [tats, setTats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tats')
      .then(res => res.json())
      .then(data => {
        setTats(data.tats);
        setLoading(false);
      });
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="tat-list">
      {tats.map(tat => (
        <TATCard key={tat.tokenHash} tat={tat} />
      ))}
    </div>
  );
}

function TATCard({ tat }) {
  return (
    <div className="tat-card">
      <div className="tat-header">
        <img src={tat.issuerProfile?.picture} alt="Issuer" />
        <div>
          <h3>{tat.metadata.name || tat.tokenID}</h3>
          <p>by {tat.issuerProfile?.name || tat.issuer.slice(0, 8)}</p>
        </div>
      </div>

      <div className="tat-metadata">
        {tat.metadata.description && (
          <p>{tat.metadata.description}</p>
        )}

        {tat.metadata.category && (
          <span className="badge">{tat.metadata.category}</span>
        )}
      </div>

      <div className="tat-stats">
        <div>
          <label>Issued</label>
          <span>{formatDate(tat.issuedAt)}</span>
        </div>

        {tat.expiresAt && (
          <div>
            <label>Expires</label>
            <span>{formatDate(tat.expiresAt)}</span>
          </div>
        )}
      </div>

      <Link to={`/tat/${tat.tokenHash}`}>View Details</Link>
    </div>
  );
}
```

### Key Features

- **Discovery**: Find all TATs on Nostr network
- **Issuer Profiles**: Display creator information from Nostr metadata
- **Search & Filter**: By name, category, issuer, etc.
- **Metadata Display**: Show event details, membership info, custom fields
- **Activity Tracking**: Monitor new TAT issuance
- **Issuer Rankings**: Top TAT creators by volume

### Privacy Considerations

**Challenge**: NWPC messages are encrypted (NIP-44) and gift-wrapped (NIP-59) - only sender and recipient can decrypt.

**Solutions**:
1. **Public TAT Registry**: Issuers voluntarily publish TAT metadata in public Nostr events (kind TBD)
2. **Issuer Cooperation**: Issuers share mint events with discovery service
3. **Relay Monitoring**: Track mint request patterns (can't decrypt, but can detect activity)
4. **User-Submitted**: TAT holders submit their TATs for listing

---

## Security Considerations

### For Application Developers

1. **Always Validate Tokens**
   ```typescript
   const token = await new Token().restore(tokenJWT);
   const isValid = await token.validate();
   if (!isValid) throw new Error('Invalid token');
   ```

2. **Check Expiration**
   ```typescript
   if (token.payload.exp && Date.now() > token.payload.exp * 1000) {
     throw new Error('Token expired');
   }
   ```

3. **Verify Issuer**
   ```typescript
   if (token.payload.iss !== expectedIssuerPubKey) {
     throw new Error('Untrusted issuer');
   }
   ```

4. **Query Spent Status**
   ```typescript
   const isSpent = await forge.checkIfSpent(token.header.token_hash);
   if (isSpent) throw new Error('Token already spent');
   ```

5. **Protect Private Keys**
   - Never expose in client-side code
   - Use environment variables for backend keys
   - Implement encryption for stored keys
   - Consider HSM for high-value forges

6. **Rate Limiting**
   - Protect Forge endpoints from abuse
   - Implement request throttling
   - Monitor unusual activity

### Key Management

**Current SDK**: Keys stored **unencrypted** on disk (`./.pocket/`, `./.forge/`)

**Production Recommendations**:
- Use OS keychain (macOS Keychain, Windows Credential Manager)
- Implement password-based encryption
- Use HD keys (BIP-32) for key derivation
- Backup mnemonic phrases securely

### Network Security

- All NWPC messages encrypted (NIP-44)
- Gift wrap provides sender anonymity (NIP-59)
- Use multiple Nostr relays for redundancy
- Consider self-hosting relays for critical applications

---

## Code Examples

### Complete Example: Minting and Verifying TATs

```typescript
import {
  FungibleForge,
  Pocket,
  Token,
  NodeStorage,
  generateSecretKey,
  getPublicKey
} from '@tat-protocol/tdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

async function main() {
  // 1. Setup Forge (Issuer)
  const forgeSecretKey = bytesToHex(generateSecretKey());
  const forgePubKey = getPublicKey(hexToBytes(forgeSecretKey));

  const forge = await TATForge.create({
    storage: new NodeStorage({ path: './.forge' }),
    keys: { secretKey: forgeSecretKey, publicKey: forgePubKey },
    relays: ['wss://relay.damus.io']
  });

  // 2. Setup Pocket (User)
  const userSecretKey = bytesToHex(generateSecretKey());
  const userPubKey = getPublicKey(hexToBytes(userSecretKey));

  const pocket = await Pocket.create({
    storage: new NodeStorage({ path: './.pocket' }),
    keys: { secretKey: userSecretKey, publicKey: userPubKey },
    relays: ['wss://relay.damus.io']
  });

  // 3. Get user's receiving address
  const userAddress = await pocket.getNewReceiveAddress();

  // 4. Mint TAT for user
  await forge.mintTAT({
    tokenID: 'premium-member-001',
    recipient: userAddress,
    exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
    ext: {
      membershipType: 'Premium',
      tier: 'Gold',
      benefits: ['Exclusive content', 'Early access', 'Priority support']
    }
  });

  // 5. Wait for message delivery
  await new Promise(r => setTimeout(r, 3000));

  // 6. Verify user has the TAT
  const tatHash = pocket.getTAT(forgePubKey, 'premium-member-001');
  console.log('User has TAT:', !!tatHash);

  // 7. Get token details
  if (tatHash) {
    const tokenJWT = pocket.getToken(forgePubKey, tatHash);
    const token = await new Token().restore(tokenJWT);

    console.log('Token metadata:', token.payload.ext);
    console.log('Expires:', new Date(token.payload.exp * 1000));
    console.log('Valid:', await token.validate());
  }
}

main();
```

### Checking Access in an Express API

```typescript
app.get('/api/premium-content', async (req, res) => {
  const userPubKey = req.user.publicKey; // From authentication
  const requiredIssuer = 'abc123...'; // Your Forge public key

  try {
    // Load user's pocket
    const pocket = await loadUserPocket(userPubKey);

    // Check for premium TAT
    const tatHash = pocket.getTAT(requiredIssuer, 'premium-member-001');

    if (!tatHash) {
      return res.status(403).json({
        error: 'Premium membership required',
        requiredTAT: {
          issuer: requiredIssuer,
          tokenID: 'premium-member-001'
        }
      });
    }

    // Validate token
    const tokenJWT = pocket.getToken(requiredIssuer, tatHash);
    const token = await new Token().restore(tokenJWT);

    if (!await token.validate()) {
      return res.status(403).json({ error: 'Invalid TAT' });
    }

    if (token.payload.exp && Date.now() > token.payload.exp * 1000) {
      return res.status(403).json({ error: 'Membership expired' });
    }

    // Grant access
    res.json({ content: 'Premium content here!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify access' });
  }
});
```

---

## Additional Resources

### Documentation

- [Getting Started Guide](./GETTING_STARTED.md) - Quick start tutorial
- [Protocol Specification](./PROTOCOL_SPEC.md) - Formal protocol spec
- [TAT Protocol Overview](./TAT_PROTOCOL.md) - Architecture details
- [Security Guide](./SECURITY.md) - Security best practices

### Package Documentation

- [TDK](./packages/tdk/README.md) - Complete development kit
- [Pocket](./packages/pocket/README.md) - Wallet functionality
- [Forge](./packages/forge/README.md) - Token issuance
- [NWPC](./packages/nwpc/README.md) - Network protocol

### Examples

- `examples/forge/` - Forge examples
- `examples/pocket/` - Pocket examples
- `examples/nwpc/` - Network communication examples

---

## Quick Reference

### Common Operations

```typescript
// Create Pocket
const pocket = await Pocket.create({ storage, keys, relays });

// Create Forge
const forge = await FungibleForge.create({ storage, keys, relays, setID, denomination, totalSupply });

// Get receiving address
const address = await pocket.getNewReceiveAddress();

// Mint fungible tokens
await forge.mintFungible(recipientAddress, amount);

// Mint TAT
await forge.mintTAT({ tokenID, recipient, ext });

// Check balance
const balance = pocket.getBalance(issuerPubKey, setID);

// Check TAT ownership
const tatHash = pocket.getTAT(issuerPubKey, tokenID);

// Transfer tokens
await pocket.transfer(issuerPubKey, recipientAddress, amount);

// Validate token
const token = await new Token().restore(tokenJWT);
const isValid = await token.validate();
```

### Key Types

- **Secret Key**: 64-char hex string (32 bytes)
- **Public Key**: 64-char hex string (32 bytes, x-coordinate)
- **Token Hash**: 64-char hex string (SHA-256 hash)
- **Address**: Base64-encoded receiving address

---

**Version**: 1.0.0
**Last Updated**: 2025-12-30
**Protocol Version**: 1.0.0
