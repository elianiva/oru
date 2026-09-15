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

`pnpm check` is a shorter local shortcut. It runs format, lint, typecheck, and test, and it skips `build`. The line above is the gate CI and a pull request must pass. The `browser` job also runs `pnpm --filter ./apps/oru e2e`.

Use [CONTEXT.md](./CONTEXT.md) vocabulary in new code and docs. Record architecture choices in [docs/adr](./docs/adr). For view changes, run the README browser check or `pnpm --filter ./apps/oru e2e`. When a bug escapes, add a row to [docs/qa/missed-invariants.md](./docs/qa/missed-invariants.md). How to reproduce a host failure, a pi bridge failure, and a stuck turn is in [docs/qa/debug-and-qa.md](./docs/qa/debug-and-qa.md).

Anyone can open an issue. Use the bug template when you have a reproduction.
