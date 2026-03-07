# Message Flows

This page describes the standard message flows between TAT Protocol components.

## Minting flow

A Forge mints tokens and sends them to a Pocket.

```
┌────────┐              ┌───────┐              ┌────────┐
│ Pocket │              │ Relay │              │ Forge  │
└───┬────┘              └───┬───┘              └───┬────┘
    │                       │                      │
    │  1. getNewReceiveAddress()                   │
    │  (generates single-use keypair)              │
    │                       │                      │
    │                       │   2. mint request    │
    │                       │◄─────────────────────┤
    │                       │   (encrypted, NIP-59)│
    │   3. Forward          │                      │
    │◄──────────────────────┤                      │
    │                       │                      │
    │  4. Decrypt, validate, store token           │
    │     Update balance                           │
    │                       │                      │
```

**Steps:**
1. Pocket generates a single-use receive address (public key)
2. Forge creates the token, signs it, wraps it in NIP-59, and sends via relay
3. Relay forwards the encrypted event to the Pocket
4. Pocket decrypts, validates the token signature, stores it, and updates balance

## Transfer flow

A sender Pocket transfers tokens to a receiver Pocket via the Forge.

```
┌────────┐    ┌────────┐    ┌───────┐    ┌───────┐
│ Sender │    │Receiver│    │ Relay │    │ Forge │
│ Pocket │    │ Pocket │    │       │    │       │
└───┬────┘    └───┬────┘    └───┬───┘    └───┬───┘
    │             │             │            │
    │  1. Build transfer tx                  │
    │     (select tokens, sign witness)      │
    │                                        │
    │  2. transfer request (encrypted)       │
    ├───────────────────────────────────────►│
    │             │             │            │
    │             │             │  3. Forge: │
    │             │             │  - Validate│
    │             │             │  - Mark    │
    │             │             │    spent   │
    │             │             │  - Mint    │
    │             │             │    new     │
    │             │             │            │
    │  4. Change tokens (encrypted)         │
    │◄──────────────────────────────────────┤
    │             │             │            │
    │             │  5. New tokens           │
    │             │◄────────────────────────┤
    │             │             │            │
    │             │  6. Store tokens         │
```

**Steps:**
1. Sender Pocket selects tokens to spend, builds transaction, signs P2PK witness data
2. Sender sends the transfer request to the Forge over encrypted relay
3. Forge validates: checks signatures, P2PK locks, not double-spent, amounts match. Marks input tokens as spent. Mints new tokens for the recipient (and change tokens for the sender if needed).
4. Forge sends change tokens back to the sender
5. Forge sends new tokens to the receiver
6. Receiver Pocket stores the tokens and updates balance

## Burn flow

A Pocket burns tokens via the Forge.

```
┌────────┐              ┌───────┐              ┌────────┐
│ Pocket │              │ Relay │              │ Forge  │
└───┬────┘              └───┬───┘              └───┬────┘
    │                       │                      │
    │  1. burn request      │                      │
    ├──────────────────────────────────────────────►│
    │                       │                      │
    │                       │  2. Validate + mark  │
    │                       │     spent, decrement │
    │                       │     circulating supply│
    │                       │                      │
    │  3. burn confirmation │                      │
    │◄─────────────────────────────────────────────┤
```

## Gate verification flow

A Gate verifies a token for access control.

```
┌────────┐              ┌───────┐              ┌────────┐
│ Holder │              │ Gate  │              │ Forge  │
│ Pocket │              │       │              │(optional)
└───┬────┘              └───┬───┘              └───┬────┘
    │                       │                      │
    │  1. Present token     │                      │
    ├──────────────────────►│                      │
    │                       │                      │
    │                       │  2. Validate:        │
    │                       │  - Structure         │
    │                       │  - Signature         │
    │                       │  - Expiration        │
    │                       │  - Policy check      │
    │                       │  - Strategy check    │
    │                       │                      │
    │                       │  3. (Optional) Verify│
    │                       │     with forge       │
    │                       ├─────────────────────►│
    │                       │◄─────────────────────┤
    │                       │                      │
    │  4. Grant / Deny      │                      │
    │◄──────────────────────┤                      │
    │                       │                      │
    │                       │  5. Record attempt   │
```

## Booth purchase flow

A Pocket purchases tokens through a Booth.

```
┌────────┐              ┌───────┐              ┌────────┐
│ Buyer  │              │ Booth │              │ Forge  │
│ Pocket │              │       │              │        │
└───┬────┘              └───┬───┘              └───┬────┘
    │                       │                      │
    │  1. Browse catalog    │                      │
    │◄─────────────────────►│                      │
    │                       │                      │
    │  2. Create order      │                      │
    ├──────────────────────►│                      │
    │                       │                      │
    │  3. Invoice (amount,  │                      │
    │     payment methods)  │                      │
    │◄──────────────────────┤                      │
    │                       │                      │
    │  4. Submit payment    │                      │
    │     (TAT tokens)      │                      │
    ├──────────────────────►│                      │
    │                       │                      │
    │                       │  5. Verify payment   │
    │                       │  6. Request mint     │
    │                       ├─────────────────────►│
    │                       │                      │
    │                       │  7. Minted tokens    │
    │                       │◄─────────────────────┤
    │                       │                      │
    │  8. Deliver tokens    │                      │
    │     + receipt         │                      │
    │◄──────────────────────┤                      │
```

## Replay protection

Both Forge and Pocket MUST track processed events:

1. **Event ID tracking** — Nostr event IDs stored in a hybrid Bloom filter + LRU cache
2. **Token hash tracking** — spent token hashes stored permanently
3. **Idempotency** — re-processing the same event ID returns a cached response instead of re-executing
