# @tat-protocol/nwpc

NWPC (Nostr Wrapped Procedure Call) transport for encrypted request/response flows.

## Install

```bash
npm install @tat-protocol/nwpc
```

## Exports

- `NWPCPeer`
- `NWPCServer`
- `NWPCResponseObject`
- `NWPC_SPEC_ERRORS`
- Types: `NWPCConfig`, `NWPCRequest`, `NWPCResponse`, `NWPCContext`, metadata types

## Quick Start

```ts
import { NWPCServer, NWPCPeer } from "@tat-protocol/nwpc";
import { NodeStore } from "@tat-protocol/storage";
import { KeySigner } from "@tat-protocol/signers";

const relays = ["wss://relay.damus.io"];

const server = new NWPCServer({
  signer: new KeySigner(process.env.SERVER_SECRET_KEY!),
  storage: new NodeStore(".nwpc-server"),
  relays,
});

server.use("ping", async (_req, context, res) => {
  return res.send({ pong: true, from: context.recipient }, context.sender);
});

await server.init();

const peer = new NWPCPeer({
  signer: new KeySigner(process.env.CLIENT_SECRET_KEY!),
  storage: new NodeStore(".nwpc-client"),
  relays,
});

await peer.init();
const response = await peer.request("ping", {}, server.getPublicKey()!);
console.log(response.result);
```

## Runtime Notes

- Requires a `StorageInterface` implementation.
- Supports both signer-based and key-based configs (signer preferred).
- Includes optional route introspection metadata.
