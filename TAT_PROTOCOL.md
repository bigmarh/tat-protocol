# TAT Protocol Overview

## Introduction
The TAT Protocol is a decentralized, Nostr-based system for issuing, transferring, and managing digital tokens. It is designed to support both fungible and non-fungible tokens (TATs: Transferable Access Tokens) with robust replay protection and extensibility.

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