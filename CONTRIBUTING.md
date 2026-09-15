# Contributing

## Setup

Node 26 or newer. The repo pins pnpm in the root `package.json` `packageManager` field.

```
pnpm install
```

How to run the host and the browser app is in [README.md](./README.md).

## Gate

A change is ready when this stays green:

```
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test && pnpm build
```

`pnpm check` is a shorter local shortcut. It runs format, lint, typecheck, and test, and it skips `build`. The line above is the gate CI and a pull request must pass.

Use [CONTEXT.md](./CONTEXT.md) vocabulary in new code and docs. Record architecture choices in [docs/adr](./docs/adr). How to bump the host and pack a tarball is in [docs/release.md](./docs/release.md). The README browser check is the check for view changes.

Anyone can open an issue. Use the bug template when you have a reproduction.
