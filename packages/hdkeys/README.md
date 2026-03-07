# @tat-protocol/hdkeys

HD key generation and derivation utilities used by Pocket and related tooling.

## Install

```bash
npm install @tat-protocol/hdkeys
```

## Exports

- `HDKey`
- Types: `SingleUseKey`, `KeyPair`

## Quick Start

```ts
import { HDKey } from "@tat-protocol/hdkeys";

const mnemonic = HDKey.generateMnemonic(128);
const seed = await HDKey.mnemonicToSeed(mnemonic);

const master = HDKey.fromMasterSeed(seed);
const child = master.derive("m/44'/1237'/0'/0/0");

console.log(child.privateKey);
console.log(child.publicKey);
```

## What It Is Used For

- Deterministic wallet identities.
- Single-use receiving keys.
- Recoverable key hierarchies.
