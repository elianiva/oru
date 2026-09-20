import { Context, Schema, type Effect, type Option } from 'effect'
import { defineContributionKind, type ContributionKind, type ProjectId } from '@oru/kernel'

/**
 * One checkout a thread can run in, as a provider reports it. `provider` names
 * the provider that owns the row, so a picker can offer several strategies at
 * once and the submit carries the path, never the mechanism.
 */
export const WorkspaceInfo = Schema.Struct({
  path: Schema.NonEmptyString,
  branch: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
  isCurrent: Schema.Boolean,
  provider: Schema.NonEmptyString,
})
export type WorkspaceInfo = typeof WorkspaceInfo.Type

export class WorkspaceFailed extends Schema.TaggedError<WorkspaceFailed>()('WorkspaceFailed', {
  project: Schema.String,
  provider: Schema.String,
  path: Schema.String,
  reason: Schema.String,
}) {}

export class UnknownProvider extends Schema.TaggedError<UnknownProvider>()('UnknownProvider', {
  provider: Schema.String,
}) {}

export interface WorkspaceMeta {
  readonly id: string
  readonly label: string
}

export interface WorkspaceProvisionOptions {
  readonly branch?: string | undefined
}

/**
 * A strategy that branches a repository into a runnable checkout. The host
 * never names git: it resolves a provider by id and calls this contract, so a
 * user replaces the mechanism by contributing another provider, not by
 * changing the host.
 */
export interface WorkspaceProvider {
  readonly meta: WorkspaceMeta
  readonly list: (
    project: ProjectId,
    cwd: string,
  ) => Effect.Effect<readonly WorkspaceInfo[], WorkspaceFailed>
  readonly provision: (
    project: ProjectId,
    cwd: string,
    path: string,
    options?: WorkspaceProvisionOptions,
  ) => Effect.Effect<WorkspaceInfo, WorkspaceFailed>
  readonly remove: (
    project: ProjectId,
    cwd: string,
    path: string,
  ) => Effect.Effect<string, WorkspaceFailed>
}

/** Define a workspace provider. */
export const defineWorkspaceProvider = (provider: WorkspaceProvider): WorkspaceProvider => provider

/**
 * The token for this contribution kind. Several workspace plugins contribute
 * under it at once, so a host offers many strategies without colliding on a
 * service token.
 */
export const WorkspaceKind: ContributionKind<WorkspaceProvider> =
  defineContributionKind<WorkspaceProvider>('oru/workspace')

/** A provider behind the registry, with the plugin that put it there. */
export interface WorkspaceEntry {
  readonly plugin: string
  readonly provider: WorkspaceProvider
}

/**
 * The host's own selection for a provision nobody named, resolved from the
 * host config. Absent leaves the choice to the registry: the first registered
 * provider, so the answer is always deterministic.
 */
export interface WorkspaceDefaults {
  readonly provider?: string | undefined
}

/**
 * The live answer to "which workspace strategies does this host have". A
 * consumer reads it per call, so activating or deactivating a provider changes
 * the answer without a restart.
 */
export interface WorkspacesContract {
  readonly list: () => Effect.Effect<readonly WorkspaceEntry[]>
  readonly get: (id: string) => Effect.Effect<Option.Option<WorkspaceEntry>>
  /** The provider an unnamed provision runs: the host's default when registered, otherwise the first by plugin id. */
  readonly preferred: () => Effect.Effect<Option.Option<WorkspaceEntry>>
  /** The host's own default selection, for the picker. */
  readonly defaults: () => WorkspaceDefaults
}

export class Workspaces extends Context.Service<Workspaces, WorkspacesContract>()(
  'oru/workspaces',
) {}
