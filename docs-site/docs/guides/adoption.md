# Adoption & Rollout

This guide is for teams integrating TAT Protocol into a product.

## 1. Choose your integration shape

### Option A: Unified SDK (recommended)

```bash
npm install @tat-protocol/tdk
```

One import surface, faster onboarding. Best for most applications.

### Option B: Individual packages

```bash
npm install @tat-protocol/forge @tat-protocol/pocket @tat-protocol/nwpc
```

Use when you need strict dependency boundaries or only specific roles:

| Role | Packages |
|------|----------|
| Issuer | `forge` + `token` + `storage` + `signers` + `nwpc` |
| Wallet | `pocket` + `storage` + `signers` + `nwpc` |
| Verifier | `gate` + `token` + `signers` + `nwpc` |
| Commerce | `booth` + `token` + `signers` + `nwpc` |

## 2. Environment decisions

### Runtime

| Environment | Signer | Storage |
|-------------|--------|---------|
| Node.js (server) | `KeySigner` | `NodeStore` |
| Browser | `NIP07Signer` | `BrowserStore` |

### Relay strategy

- Start with 2-3 reliable relays
- Separate staging vs production relay sets
- Keep relay lists configurable at deploy time

## 3. Security baseline

- Use signer-based APIs (`createPocketWithKey`, not raw key constructors)
- Never log raw secret keys or full token JWT data
- Rotate service keys periodically
- Keep storage directories isolated per service
- See the [Security Best Practices](/deployment/security) guide

## 4. Minimal topology

A complete TAT Protocol deployment needs:

1. **Forge service** — issues and validates tokens
2. **Pocket** — receives and stores tokens (client or server)
3. **Nostr relays** — carry encrypted NWPC messages
4. **Gate** (optional) — verifies tokens at entry points
5. **Booth** (optional) — handles commerce flows

## 5. Rollout plan

### Phase 1: Local sandbox

- One Forge + one Pocket + one relay
- Validate mint, transfer, and balance checks
- Run: `pnpm build && pnpm test`

### Phase 2: Staging

- Add Gate verification and Booth invoice/payment flow
- Enable test automation for critical paths
- Test with multiple relays

### Phase 3: Production

- Enable encrypted storage
- Add monitoring: request latency, verification failures, relay health
- Document incident response and key rotation playbooks

## 6. Onboarding checklist

- [ ] Install SDK (`@tat-protocol/tdk` or individual packages)
- [ ] Configure environment variables for keys and relays
- [ ] Set up storage directories with appropriate permissions
- [ ] Verify Forge can mint and Pocket can receive
- [ ] Verify transfers work between two Pockets
- [ ] Add CI that runs `pnpm build && pnpm test`
- [ ] Document your issuer policies and payment rules

## Next steps

- [Quickstart](/guides/quickstart) — get running in 5 minutes
- [Package Overview](/sdk/packages) — choosing packages by role
- [Security Best Practices](/deployment/security)
