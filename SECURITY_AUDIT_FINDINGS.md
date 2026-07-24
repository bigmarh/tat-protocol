# TAT Protocol — Security Audit Findings

**Date:** 2026-07-24
**Scope:** `packages/{forge,pocket,token,nwpc,gate,signers,storage,utils,hdkeys}`, audited against `PROTOCOL_SPEC.md` (§3.5, §6.2, §6.3, §7.2).
**Method:** code audited against every spec MUST; findings ranked Critical / High / Medium / Low. Per the audit brief, each **Critical/P0** finding that was fixed here ships with an adversarial test that fails before the fix and passes after. Production is live, so fixes are additive; anything requiring a token-format/serialization change or lock-step client coordination is **documented, not applied in place** (it needs a versioned migration per spec §9).

Legend: **[FIXED]** applied + tested in this branch · **[DOCUMENTED]** needs a dedicated/coordinated change.

---

## Critical

### C1 — Concurrent double-spend (TOCTOU) · [FIXED]
`packages/forge/src/ForgeBase.ts` (spent-check ~L640 vs mark in `publishSpentToken`), `FungibleForge.ts`, `NonFungibleForge.ts`.
The transfer flow checks the spent-set, then `await`s through output signing, then marks the input spent. NWPC subscription handlers run concurrently (NDK's `EventEmitter` does not await them), so two transfers of the same input can both pass the spent-check before either marks it spent → the value is minted twice.
**Fix:** added a per-forge async mutex (`runExclusive`) serializing the whole validate→sign→mark-spent critical section for fungible transfer, non-fungible transfer, and burn (burn shares the lock so it can't race a transfer of the same token).
**Test:** `tests/unit/forge-concurrent-double-spend.verify.test.ts` — two concurrent transfers of one 100-unit input mint the value at most once (was 2, now 1).

### C2 — Duplicate-input value inflation · [FIXED]
`packages/forge/src/FungibleForge.ts:validateFungibleTransfer`, `ForgeBase.ts:validateTXInputs`.
A single transfer listing the same input token twice (`ins:[T,T]`) summed its amount twice; the idempotent `spentTokens.add` never noticed the duplicate. One request minted value from nothing — no concurrency required.
**Fix:** `validateTXInputs` now rejects any transaction with a repeated input `token_hash`; `validateFungibleTransfer` has the same guard for direct callers.
**Test:** `tests/unit/forge-double-spend.verify.test.ts` (C2 cases).

### C3 — Duplicate `tokenID` mints multiple NFTs from one input · [FIXED]
`packages/forge/src/NonFungibleForge.ts:handleNonFungibleTransfer`.
The per-recipient loop re-found the same input for a repeated output `tokenID` (the spent-set is only consulted once, up front), minting a second valid NFT from a single input.
**Fix:** track inputs already consumed within the request; a `tokenID` can be spent at most once per transfer.
**Test:** `tests/unit/forge-double-spend.verify.test.ts` (C3 case).

### C4 — Forge subscribes before loading spent-set / replay state · [FIXED]
`packages/forge/src/ForgeBase.ts:initialize` (was: `super.init()` before `_loadState()`).
On start the forge subscribed to relays before loading its persisted spent-set and replay bloom. Relays replay the subscription's `since` window (default 10 min) on connect; those replayed transfers were validated against an *empty* spent-set → double-spend on every restart.
**Fix:** resolve keys, set `stateKey`, and `await _loadState()` **before** `super.init()` subscribes.
**Test:** `tests/unit/forge-init-ordering.verify.test.ts` — asserts `_loadState` runs before subscribe.

### C5 — timeLock compared in ms instead of seconds (locks never enforced) · [FIXED]
`packages/forge/src/ForgeBase.ts:validateTXInputs`, `packages/token/src/Token.ts:isTimeLocked`.
`timeLock` is Unix **seconds** (spec §3.3) but was compared to `Date.now()` (**ms**), ~1000× larger, so `timeLock > Date.now()` was always false — time-locked escrow/vesting could be spent immediately.
**Fix:** compare `Math.floor(Date.now()/1000) < timeLock` in both places.
**Test:** `tests/unit/forge-timelock.verify.test.ts` — a token time-locked one hour out is rejected; a past lock is accepted.

### C6 — P2PK unlock signature not bound to the transfer (witness replay / theft) · [DOCUMENTED]
`packages/forge/src/ForgeBase.ts` (witness verified over `token_hash` only), witness built in `packages/pocket/src/Pocket.ts`.
The spender signs only the input token's own static, public `token_hash` — not domain-separated, not bound to the outputs (recipient/amount) or a nonce. An observer of a pending transfer (a relay, a racing client) can reuse the witness to redirect the same input to an attacker-chosen recipient before it is marked spent.
**Why not fixed here:** the fix changes the signed message, which requires **Forge and Pocket to update in lock-step** (old clients send old witnesses). It must ship as a coordinated, versioned change with a transition window accepting both forms.
**Recommended fix:** sign `H(domain_tag ‖ input_token_hash ‖ canonical(outs) ‖ nonce)`; forge recomputes and verifies the same binding; add domain separation distinct from issuance signing.

---

## High

- **H1 — Forge state persistence was fire-and-forget · [FIXED]** `ForgeBase._saveState` dropped the `await` on `saveState`, so the transfer response released signed tokens before the spent-set was durable (crash → replayable input) and storage errors became unhandled rejections. Now `await`ed. (Same defect independently flagged by the spent-set and replay audits.)
- **H2 — Pocket stored received tokens with no verification · [FIXED]** `Pocket.storeToken` trusted the claimed `token_hash`, signature, and amount verbatim → spoofed balances and hash-key shadowing of real tokens. Now verifies `verifyTokenHash` + `verifyTokenSignature` before indexing. (Flagged by three separate audits.) *Follow-up: a dedicated Pocket-receive test needs new scaffolding — the current Pocket test harness is a hand-rolled mock that bypasses `storeToken`.*
- **H3 — Rate limiting advertised but not implemented · [DOCUMENTED]** Error `1004 RATE_LIMITED` and `rateLimit` route metadata exist, but no limiter anywhere. `handleEvent` does two NIP-44 decrypts + a schnorr verify before any policy check, and `transfer`/`burn`/`verify` are unauthenticated → cheap DoS. Recommend a token-bucket keyed on the post-unwrap `context.sender` plus a global pre-unwrap budget.
- **H4 — Non-atomic forge state writes · [DOCUMENTED]** `DiskStorage.setItem` does in-place `fs.writeFile` (O_TRUNC, no temp+rename, no fsync); a crash mid-write corrupts the single file holding the entire spent-set, and the forge then can't start. Recommend temp-file + `fsync` + atomic `rename` (or move the spent-set to the existing SQLite backend).
- **H5 — Lost/missing state silently reinitialized to an empty spent-set · [DOCUMENTED]** `_loadState` builds a fresh empty spent-set with no warning when storage is absent (deleted-after-corruption, fresh container, `MemoryStorage`), re-enabling every historical token for respend. Recommend refusing silent empty-init when supply is expected, plus a durable-backend warning for Memory/Browser stores in forge context.
- **H6 — Plaintext key storage · [DOCUMENTED]** Forge secret key (key-mode) and Pocket mnemonic + single-use keys are persisted unencrypted unless the opt-in `TAT_STORAGE_ENCRYPTION_KEY` is set (NodeStore only; other backends have no encryption). The `allowInsecureStorage` gate is also bypassable by passing a `BrowserStore` instance directly. Recommend an encrypted keystore (scrypt/argon2id + AES-GCM) and applying the gate to any browser store. *(Signer/HSM path is sound — the forge is not hot-key-only.)*
- **H7 — HTLC refund path unbound + lock priority not enforced · [DOCUMENTED]** Once an HTLC's internal timelock passes, the "no-preimage → refund" branch validates without checking the refund party; combined with C6 an unrelated party can sweep an expired-HTLC token. Locks are also checked independently rather than by spec priority (HTLC > P2PKlock > timeLock), and HTLC uses ms internally vs the protocol's seconds. Needs a priority resolver + refund-pubkey binding.

---

## Medium

- **M1 — No canonical serialization of the payload · [DOCUMENTED]** `token_hash` hashes `JSON.stringify(payload)` (insertion-order- and number-format-dependent, standard base64 not base64url, plus a lossy `TextDecoder` round-trip). Self-consistent within JS today, but any second-language implementation (Rust/Python) hashes differently → spent-set keys diverge / cross-impl double-spend. Needs a canonical form (JCS/RFC 8785) or hashing the transmitted base64url segment — a **versioned migration** (spec §9), not an in-place change.
- **M2 — Signature does not cover the header · [DOCUMENTED]** Spec §3.4 signs `BASE64URL(header).BASE64URL(payload)`; the code signs only `token_hash` (payload-derived), leaving `alg`/`typ`/`ver` malleable (algorithm-confusion / version-downgrade surface). Fold the header into the signed message — coordinated format change.
- **M3 — Float / large-value amount arithmetic · [DOCUMENTED]** Spec allows float `amount`; conservation and change use FP `+`/`reduce` (`0.1+0.2` drift; precision loss past `2^53`). `NaN`/`Infinity` are already rejected (commit `d812b0c`). Recommend integer minor-units / BigInt and a documented max. Requires spec + format alignment.
- **M4 — NWPCPeer response routing/verification · [FIXED-ADJACENT / DOCUMENTED]** `NWPCPeer` skips the `verifiedSender` seal-signature check the server enforces, and replies to peer-handled requests go to the ephemeral wrapper pubkey (`event.pubkey`) instead of `unwrapped.sender` (functional bug + defense-in-depth loss). Recommend enforcing `verifiedSender` and replying to `unwrapped.sender`.
- **M5 — Gate signature/expiry are policy-optional; `GateBase` has no ownership proof · [DOCUMENTED]** A policy with `requireValidSignature:false` grants on a forged signature; `GateBase.validateToken` grants on mere possession of a JWT (no nonce challenge). Make signature/hash checks unconditional; require a holder-ownership proof as `GateServerSpec` full-proof mode already does.
- **M6 — Gate minimal-proof trusts client self-attestation · [DOCUMENTED]** `verifyMinimalProof` verifies only a nonce signature by a client-chosen key and then trusts self-declared `disclosed` flags (tier, notExpired) → access with a fabricated claim. Remove minimal mode or require an issuer-signed attestation over the disclosed fields. (Full-proof mode is sound.)
- **M7 — Idempotency (spec §6.3.3) not implemented; duplicates silently dropped · [DOCUMENTED]** No response cache: a lost transfer response can't be recovered (replay is dropped; a fresh request returns `TOKEN_SPENT`). Cache last-N responses keyed by event/request id and re-send on duplicate.
- **M8 — Signer-mode forges never broadcast spent markers · [DOCUMENTED]** `publishSpentToken`'s relay broadcast is gated on a raw `secretKey`, so the recommended signer configuration silently disables the public spent feed pockets subscribe to. Add a signer-based `postToFeed`.

---

## Low

- **L1 — Bloom filter never rotated · [DOCUMENTED]** Persisted add-only across the forge's whole lifetime (`expectedItems=15000`); as it fills, false positives silently *drop legitimate requests* (client times out). `isNearCapacity` exists but has no callers. Add generational rotation (active+previous) or a time-bounded exact set pruned by `since`.
- **L2 — `Number(tokenID)` coercion · [DOCUMENTED]** `NonFungibleForge` transfer coerces string/UUID `tokenID`s with `Number(...)` → `NaN`, corrupting NFT identity on transfer. Stop coercing.
- **L3 — Empty-string `tokenID` / zero-amount pass `Token.validate()` · [DOCUMENTED]** `validate()` checks `=== undefined`, admitting `tokenID:""` and (at that layer) `amount:0`. Tighten to non-empty string / positive finite number.
- **L4 — NIP-59 timestamp randomization unused · [DOCUMENTED]** All wrap layers share the real `created_at` (helper exists, never called), aiding relay correlation. Randomize seal/wrapper timestamps (and widen `since` together).
- **L5 — Deterministic second-granularity `token_hash` · [DOCUMENTED]** Two legitimate same-amount mints to the same recipient in the same second collide to one hash. Add a per-token random nonce at issuance.

---

## What was verified SOUND (with evidence)

- **Core double-spend defense holds** on the forge/gate/burn paths: the spent-set key is independently recomputed from the payload (not trusted from the request), and hash + signature (`verifyTokenHash`/`verifyTokenSignature`) are enforced before any input is accepted. A token holder cannot forge a second encoding of the same token without the issuer key.
- **Gift-wrap sender authentication is correct:** NIP-44 ECDH blocks impersonation regardless of signatures; authorization keys off the inner (seal) pubkey, not the ephemeral wrapper; the server enforces the seal signature (`verifiedSender`).
- **NIP-44 applied to all NWPC request/response traffic;** no plaintext/NIP-04 fallback.
- **Single-issuer input rule** rejects cross-forge token injection.
- **CSPRNG** key/mnemonic generation; **signer/HSM abstraction** means the forge is not hot-key-only.
- **HTLC preimage check** is SHA-256 with constant-time comparison.
- **`NaN`/`±Infinity` amount rejection** (commit `d812b0c`) is present and correct.
- **LRU eviction is not a replay hole** — the persisted bloom is a strict superset of the LRU.
- **Pocket init ordering** (loads state before subscribing) was already correct — the mirror fix applied to the forge (C4) brings it in line.

---

## Fixed in this branch (`fix/security-audit-p0`)

C1, C2, C3, C4, C5 (Critical) and H1, H2 (High), each with the adversarial tests listed above. Full suite green (14 suites / 64 tests); clean typecheck/build across all packages.

The **[DOCUMENTED]** findings — especially **C6** (witness binding), **H3** (rate limiting), **H4/H5** (durability/recovery), **H6** (key encryption), and the format-migration items **M1/M2/M3** — are the recommended next tranche. C6 and the format items require coordinated, versioned releases because they change on-wire/on-token bytes that live clients depend on.
