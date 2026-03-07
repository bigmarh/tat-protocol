# @tat-protocol/pocket

Wallet/client state engine for receiving, storing, and transferring TAT protocol tokens.

## Install

```bash
npm install @tat-protocol/pocket
```

## Exports

- `Pocket`
- Types: `PocketConfig`, `PocketState`

## Quick Start

```ts
import { Pocket } from "@tat-protocol/pocket";
import { NodeStore } from "@tat-protocol/storage";
import { KeySigner } from "@tat-protocol/signers";

const pocket = await Pocket.create({
  signer: new KeySigner(process.env.POCKET_SECRET_KEY!),
  storage: new NodeStore(".pocket"),
  relays: ["wss://relay.damus.io"],
});

const receivePubkey = await pocket.getNewReceiveAddress();
console.log("Receive address:", receivePubkey);
```

## Common Methods

- `getBalance(issuer, setID)`
- `getToken(issuer, tokenHash)`
- `getTAT(issuer, tokenID)`
- `transfer(issuer, to, amount, changeKey?)`
- `sendTAT(issuer, to, tokenID)`
- `sendRequestWithSingleUseKey(method, payload, forgePubkey)`

## Storage Notes

- Node: use `NodeStore`.
- Browser: use `storageType: "browser"` with `allowInsecureStorage: true`, or provide your own encrypted storage implementation.
