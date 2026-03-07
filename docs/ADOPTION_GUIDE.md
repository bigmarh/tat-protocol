# TAT Protocol Adoption Guide

This guide is for teams integrating the protocol as an open-source dependency.

## 1. Pick Your Integration Shape

### Option A: Unified SDK (`@tat-protocol/tdk`)

Use when you want one import surface and faster onboarding.

### Option B: Package-by-package

Use when you need strict dependency boundaries or only specific roles:

- Issuer: `@tat-protocol/forge`
- Wallet/client: `@tat-protocol/pocket`
- Transport: `@tat-protocol/nwpc`
- Verification: `@tat-protocol/gate`
- Commerce: `@tat-protocol/booth`

## 2. Environment Decisions

### Runtime

- Node services: `NodeStore`, `KeySigner`
- Browser apps: `NIP07Signer`, browser-safe storage strategy

### Relay Strategy

- Start with 2-3 reliable relays.
- Separate staging vs production relay sets.
- Keep relay lists configurable at deploy time.

## 3. Security Baseline

- Use signer-based APIs where possible.
- Never log raw secret keys or full token payload/signature data.
- Configure `TAT_STORAGE_ENCRYPTION_KEY` for encrypted `NodeStore` payloads.
- Rotate service keys and keep storage directories isolated per service.

## 4. Minimal End-to-End Topology

1. Forge service issues tokens.
2. Pocket receives and stores tokens.
3. NWPC carries encrypted requests/responses.
4. Gate validates access based on token proofs.
5. Booth handles invoice/payment and settlement orchestration.

## 5. Suggested Rollout Plan

1. Local sandbox:
- One forge + one pocket + one relay set.
- Validate mint, transfer, and spend checks.

2. Staging:
- Add gate verification and booth invoice/payment flow.
- Enable test automation for critical paths.

3. Production:
- Enable encrypted node storage.
- Add monitoring around request latency, verification failures, and relay health.
- Document incident and key-rotation playbooks.

## 6. Testing Commands

```bash
pnpm build
pnpm test
```

Add protocol-specific smoke tests for your own issuer policies and payment rules.

## 7. Open-Source Onboarding Checklist

- `README.md` links to all package docs.
- Working quick start scripts for forge/pocket/nwpc.
- Clear env var contract for secrets and relays.
- CI runs build + tests on pull requests.
- Release process documented in `RELEASING.md`.
