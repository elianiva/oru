# Workspaces are a provider registry; git worktree is the default entry

Thread provisioning used to name git worktrees directly: the host shelled to
`git worktree`, the RPC said `Worktree`, and replacing the mechanism meant
changing the host. bb keeps the same split one level up: a provision-type
union dispatches to unmanaged, managed-worktree, personal, and reconnect
strategies behind one `HostWorkspace` interface, so callers never name git.

oru already owns the extension point bb's union plays: the contribution kind.
`@oru/workspace` defines `WorkspaceProvider` (`meta`, `list`, `provision`,
`remove`), `WorkspaceKind`, and the `Workspaces` registry, mirroring
`HarnessKind` and the harness registry exactly. `oru/workspace-git`
contributes the git-worktree strategy under id `worktree`. Listing fans out
best effort across providers and skips the ones that cannot read a checkout;
creating and removing resolve one provider by name or fall back to the host
`workspaceProvider` default (`config.json`, `ORU_WORKSPACE_PROVIDER`), then to
the first registered. A user replaces the mechanism by contributing another
provider plugin, the way a harness bridge replaces pi, with no host change.

## Considered options

- **Keep worktrees hardcoded**: no new packages, but every new strategy forks the host RPC and handlers.
- **A provider map in host config**: selectable without plugins, but a second extension convention beside contribution kinds.
- **Contribution-kind registry** (chosen): one convention for harnesses and workspaces, live activation and deactivation, defaults as plugin `Config` data.

## Consequences

- `WorktreeFailed` becomes `WorkspaceFailed` with a `provider` member; `UnknownProvider` covers unregistered names.
- RPC renames `List/Create/RemoveWorktree` to `List/Create/RemoveWorkspace` with an optional `provider`; the picker keeps carrying only the path into submit.
- Per-thread cwd overrides are untouched: they name checkouts, never strategies.
