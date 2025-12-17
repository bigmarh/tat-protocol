# TAT Protocol Overview

## Introduction
The TAT Protocol is a decentralized, Nostr-based system for issuing, transferring, and managing digital tokens. It is designed to support both fungible and non-fungible tokens (TATs: Transferable Access Tokens) with robust replay protection and extensibility.

**Core Principle**: Unlike blockchain-based tokenization where network consensus determines validity, TAT Protocol maintains the **issuer as the sole authority** over their tokens. This architectural decision enables simpler validation, faster finality, and direct issuer control while preserving cryptographic security and token portability.

---

## Issuer-Authority Model

### Fundamental Difference from Blockchains

TAT Protocol represents a fundamentally different approach to tokenization:

#### Blockchain Model
- **Authority**: Network consensus (miners/validators)
- **Validation**: All network participants verify transactions
- **Double-Spend Prevention**: Consensus mechanism
- **Finality**: Probabilistic or eventually deterministic
- **Trust**: Distributed across network participants
- **Token Validity**: Determined by blockchain state

#### TAT Protocol Model
- **Authority**: Token issuer (Forge)
- **Validation**: Issuer validates all transfers
- **Double-Spend Prevention**: Issuer tracks spent tokens
- **Finality**: Immediate upon issuer confirmation
- **Trust**: Users trust the issuer (like trusting a bank or loyalty program)
- **Token Validity**: Determined by issuer's signature and spent-token database

### Why Issuer Authority?

**Advantages:**
1. **Simplicity**: No consensus mechanism needed
2. **Performance**: Instant validation, no block times
3. **Cost**: No mining/gas fees
4. **Scalability**: Limited only by issuer capacity
5. **Flexibility**: Issuer can implement custom policies
6. **Regulatory Alignment**: Clear accountability
7. **Privacy**: Only issuer sees all transactions

**Trade-offs:**
1. **Trust Required**: Users must trust the issuer
2. **Centralization**: Issuer is a single point of control
3. **Issuer Liveness**: Transfers require issuer to be online
4. **No Smart Contracts**: Logic lives in applications, not protocol

### Use Cases Well-Suited to Issuer Authority

- **Loyalty Points**: Company controls their own points
- **Event Tickets**: Venue controls ticket validity
- **Gift Cards**: Merchant controls balance/redemption
- **Membership Tokens**: Organization controls access
- **Company Credits**: Business controls their currency
- **Digital Coupons**: Brand controls redemption

These are all scenarios where users *already trust* a central authority, making blockchain consensus unnecessary overhead.

### Issuer Responsibilities

As the authority, the Forge (issuer) MUST:

1. **Validate All Transfers**: Check signatures, amounts, spent status
2. **Track Spent Tokens**: Maintain authoritative spent-token database
3. **Enforce Supply Limits**: Respect total/circulating supply caps
4. **Provide Availability**: Be online to process transfers
5. **Maintain Security**: Protect issuer keys and database
6. **Honor Commitments**: Respect published token policies

### Token Lifecycle with Issuer Authority

```
1. MINTING
   Forge creates token → Signs with issuer key → Sends to recipient
   ✓ Only issuer can mint
   ✓ Issuer signature proves authenticity

2. TRANSFER
   Holder sends tokens to Forge → Forge validates → Creates new tokens for recipient
   ✓ Issuer checks not double-spent
   ✓ Issuer marks old tokens as spent
   ✓ Issuer creates new tokens (change if needed)

3. VALIDATION
   Anyone can verify: Token signature + Not in spent set = Valid
   ✓ Cryptographic proof (signature)
   ✓ Issuer authority (spent tracking)

4. REVOCATION
   Issuer marks token as spent/invalid
   ✓ Only issuer can revoke
   ✓ Immediate effect
```

### Security Model

**Threat Protection:**
- ✅ Token Forgery: Prevented by Schnorr signatures
- ✅ Double-Spending: Prevented by issuer's spent-token tracking
- ✅ Replay Attacks: Prevented by event ID tracking
- ✅ Impersonation: Prevented by cryptographic signatures

**Trust Requirements:**
- Users trust issuer to honor tokens
- Users trust issuer not to arbitrarily revoke
- Users trust issuer to track spent tokens correctly
- Users do NOT need to trust relays (messages encrypted)

### Comparison with Open Protocols

TAT Protocol is like **HTTP for tokens**:

| Protocol | Authority | Use Case |
|----------|-----------|----------|
| HTTP | Web server | Serve content |
| SMTP | Mail server | Route email |
| TAT Protocol | Token issuer | Issue/validate tokens |

Just as you trust Gmail to deliver your email (not blockchain consensus), you trust issuers to honor their tokens.

---

## Architecture

### Building Blocks
- **Token**: The base data structure for all token types (fungible and non-fungible).
- **TAT (Transferable Access Token)**: A non-fungible token (NFT) with a unique `tokenID`.
- **NWPC (Nostr Wrapped Procedure Calls)**: The RPC/event protocol layer built on Nostr events.
- **Forge**: The authority that mints (forges) tokens, enforces supply, and handles burning.
- **Pocket**: The wallet/client that receives, stores, and spends tokens.

---

## Token Structure

Tokens are represented as JWTs with a payload and header. Key fields include:
- `iss`: Issuer (Forge public key)
- `iat`: Issued at timestamp
- `exp`: Expiry timestamp (optional)
- `amount`: Amount (for fungible tokens)
- `tokenID`: Unique identifier (for TATs)
- `P2PKlock`: Public key lock (ownership)
- `ext`: Extension fields (for custom data)

### Token Types
- **FUNGIBLE**: Interchangeable tokens (e.g., credits, points)
- **TAT**: Unique, non-fungible tokens (e.g., tickets, passes)

---

## NWPC: Nostr Wrapped Procedure Calls

NWPC provides a secure, RPC-like communication layer over Nostr events. All protocol actions (mint, transfer, burn, verify, etc.) are NWPC calls.

- **Request/Response**: Each action is a request event, with a matching response event.
- **Handlers**: Each role (Forge, Pocket) implements handlers for relevant NWPC methods.
- **Replay Protection**: Each event has a unique `id` and is tracked to prevent reprocessing.

---

## Roles

### Forge
- Forges new tokens (fungible and TAT)
- Enforces total/circulating supply
- Handles burning and transfer requests
- Implements replay protection (tracks processed event IDs)

### Pocket
- Receives, stores, and spends tokens
- Maintains token indices and balances
- Subscribes to Nostr events for token reception
- Implements replay protection (tracks processed event IDs)

---

## TAT Lifecycle Example

1. **Minting**: A Forge forges a new TAT by creating a token with a unique `tokenID` and sending it to a Pocket via NWPC.
2. **Transfer**: The Pocket can transfer the TAT to another Pocket by sending a transfer request to the Forge, which issues a new TAT for the recipient.
3. **Burning**: The Pocket can burn (invalidate) a TAT by sending a burn request to the Forge.
4. **Replay Protection**: All events are tracked by their unique `id` to prevent double-processing.

---

## Message Flow (Simplified)

1. **Forge** receives a `forge` NWPC request, forges a token, and sends it to the recipient.
2. **Pocket** receives the token event, stores it, and updates its indices/balances.
3. **Pocket** can initiate a `transfer` or `burn` by sending an NWPC request to the Forge.
4. **Forge** processes the request, updates supply, and sends a response.

---

## Replay Protection

- Both Forge and Pocket maintain a set of processed event IDs (persisted in state).
- Before processing an event, they check if the event's `id` is already processed.
- If yes, the event is skipped, ensuring idempotency and preventing double-processing.

---

## Extensibility

- The protocol supports extension via the `ext` field in tokens and by adding new NWPC methods.
- Custom token types, metadata, and business logic can be layered on top of the core protocol.

---

## Security Considerations

- All messages are cryptographically signed and wrapped using Nostr keys.
- Replay protection is enforced at both the Forge and Pocket level.
- Only authorized users can forge tokens.

---

## Glossary
- **TAT**: Transferable Access Token (non-fungible token)
- **NWPC**: Nostr Wrapped Procedure Call
- **Forge**: Token authority (forge, burn, transfer)
- **Pocket**: Wallet/client
- **Token**: Digital asset (fungible or non-fungible)

---

## References
- See the `token/`, `forge/`, `pocket/`, and `nwpc/` directories for implementation details.
- For questions or contributions, see the project README or contact the maintainers. 