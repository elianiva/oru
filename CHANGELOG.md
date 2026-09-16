# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The app is a client of the host: it asks `ProjectClient.list()` as it loads and renders the host's projects, an empty state on a host with none, and a named `Host unreachable` state with a retry when the host does not answer.
- `/thread/:id`: a thread has a URL, the selection is the route rather than app state, and the middle column is the hero composer at `/` and the conversation in a thread.
- MIT `LICENSE`, contribution guide, changelog, and a GitHub bug-report form.
- An installable `@oru/host` tarball, a version bump script, and a pack smoke in CI.
- Host configuration: `~/.oru/config.json` (mode 0600), a `data/` directory, `config list` / `set` / `unset`, and one precedence chain (flags, then file, then environment, then defaults).

### Changed

- `@oru/rpc` facades fail with `HostUnreachable` instead of dying, so a client renders a host that is down ([ADR-0013](./docs/adr/0013-host-unreachable-is-a-state.md)).
- The browser suite starts its own host on a port the kernel picks and takes its dev-server port from `ORU_E2E_PORT`, so it runs beside a `pnpm dev`; a dev server proxies to `ORU_PROXY_TARGET` when one is set.
