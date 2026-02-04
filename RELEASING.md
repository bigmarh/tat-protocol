# Releasing @tat-protocol

This repo is a monorepo. The root package is `private`; only `packages/*` are published to npm.

## Versioning
- Decide the new version(s) first.
- Preferred: bump all changed packages together for simplicity.

Example (interactive):
```bash
pnpm -r version patch
```

## Build
```bash
pnpm -r build
```

## Test
```bash
pnpm test
```

## Publish
```bash
pnpm -r publish --access public
```

Notes:
- Ensure you're logged into npm with the correct account.
- If publishing to a registry other than npmjs, set `npm_config_registry`.

## Git Tags
- Use a single repo tag for the release, e.g. `vX.Y.Z`.
```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

## Verification
- Confirm npm shows updated versions.
- Install a package in a clean project and run a quick sanity check.

