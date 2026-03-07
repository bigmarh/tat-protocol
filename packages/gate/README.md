# @tat-protocol/gate

Gate services for access verification and challenge/proof workflows.

## Install

```bash
npm install @tat-protocol/gate
```

## Exports

- `GateServerSpec` (spec-oriented NWPC gate service)
- `GateBase` (extensible base class)
- `Gate` (minimal wrapper)
- Types from `types.ts` and `spec-types.ts`

## Quick Start (Spec Server)

```ts
import { GateServerSpec } from "@tat-protocol/gate";
import { NodeStore } from "@tat-protocol/storage";
import { KeySigner } from "@tat-protocol/signers";

const gate = await GateServerSpec.create({
  signer: new KeySigner(process.env.GATE_SECRET_KEY!),
  storage: new NodeStore(".gate"),
  relays: ["wss://relay.damus.io"],
  serviceName: "Premium API",
  challengeExpiry: 300,
  sessionExpiry: 3600,
});

console.log(gate.getPublicKey());
```

## Protocol Flow

1. Client calls `gate.request_access`.
2. Server returns challenge (`gate.challenge`).
3. Client submits proof to `gate.verify`.
4. Server responds with `gate.result` and optional session token.

## Runtime Notes

- Session validation is available via `verifySession(sessionToken)`.
- Gate supports full and minimal proof modes.
- Persist state to avoid replay gaps across restarts.
