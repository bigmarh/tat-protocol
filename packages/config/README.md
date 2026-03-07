# @tat-protocol/config

Default protocol configuration values used by SDK packages.

## Install

```bash
npm install @tat-protocol/config
```

## Exports

- `PROTOCOL_VERSION`
- `defaultConfig`

## Usage

```ts
import { defaultConfig, PROTOCOL_VERSION } from "@tat-protocol/config";

console.log(PROTOCOL_VERSION);
console.log(defaultConfig.relays);
```

## Notes

- `defaultConfig.relays` is intentionally minimal; production apps should provide their own relay set.
- Most packages accept `relays` directly in their constructor config.
