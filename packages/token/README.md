# @tat-protocol/token

Core token model for TAT protocol JWT-like tokens.

## Install

```bash
npm install @tat-protocol/token
```

## Exports

- `Token` (default export as `Token`, plus named export)
- `TokenType` (`FUNGIBLE`, `TAT`)
- Types: `Header`, `Payload`
- `TokenValidator`

## Quick Start

```ts
import { Token, TokenType } from "@tat-protocol/token";
import { KeySigner } from "@tat-protocol/signers";

const signer = new KeySigner(process.env.ISSUER_SECRET_KEY!);
const issuerPubkey = await signer.getPublicKey();

const token = new Token();
await token.build({
  token_type: TokenType.FUNGIBLE,
  payload: Token.createPayload({
    iss: issuerPubkey,
    amount: 100,
    P2PKlock: process.env.RECIPIENT_PUBKEY,
  }),
});

const signatureHex = await signer.sign(await token.data_to_sign());
const jwt = await token.toJWT(signatureHex);

const restored = await new Token().restore(jwt);
await restored.validate();
```

## Use Cases

- Token issuance and parsing.
- Signature and hash verification.
- Lock checks (`P2PKlock`, `HTLC`, `timeLock`).
- Derived token creation (`Token.createDerivedToken`).
