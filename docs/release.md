# How to cut an oru release

The installable artifact is a tarball of `@oru/host`. It ships the `oru-host` binary. `@oru/kernel` and the other workspace packages stay unpublished (see [ADR-0008](./adr/0008-monorepo-unpublished.md)).

A release is one git commit. That commit holds the version in `apps/host/package.json`, the matching [CHANGELOG.md](../CHANGELOG.md) section, and the tarball you get from `pnpm pack:host` at that commit.

## What to bump

Run the bump script. Do not edit a version field by hand.

```
pnpm bump patch
```

`minor` and `major` are the other kinds. The script writes `apps/host/package.json` only. That is the version `oru-host --version` prints. If a second package later carries a user-visible version, add its path to `PUBLIC_MANIFESTS` in `scripts/version.mjs`. CI runs `pnpm check:lockstep` and fails when those versions disagree, or when a workspace package sets `"private": false`.

## What to write in the changelog

Add a dated heading under the current `[Unreleased]` notes in `CHANGELOG.md`, using Keep a Changelog. Move the notes that belong in the release under that heading. Leave `[Unreleased]` in place for the next cycle.

## What to verify

From the commit you intend to tag:

```
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test && pnpm build
pnpm check:lockstep
pnpm pack:smoke
```

`pnpm pack:smoke` builds the host, packs a tarball whose `exports` and `main` point at `dist/*.js`, installs that tarball in an empty npm prefix, runs `oru-host --version`, then starts the host and stops it with SIGTERM.

## What a release consists of

1. `pnpm bump <kind>`
2. Changelog heading and notes for that version
3. The verification commands above
4. A git tag `v<version>` on that commit
5. The tarball `pnpm pack:host` prints, published with `pnpm publish` from the staging layout the pack script already used, or attached to the GitHub release

Do not publish `@oru/kernel`.
