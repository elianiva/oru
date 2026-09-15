import { Schema } from 'effect'
import { PluginId, ProjectId, ThreadId, TokenId } from './primitives.ts'

export const ServiceMissing = Schema.TaggedStruct('ServiceMissing', { token: TokenId })

/** A plugin returned a service its declaration never claimed, so nothing can resolve it. */
export const ServiceUndeclared = Schema.TaggedStruct('ServiceUndeclared', { token: TokenId })

export const MismatchProblem = Schema.Union([ServiceMissing, ServiceUndeclared])
export type MismatchProblem = typeof MismatchProblem.Type

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  'ProviderUnavailable',
  {
    token: TokenId,
  },
) {}

/**
 * A provider was swapped for one whose method builds a different kind of
 * description than the caller already committed to. A facade cannot hand a
 * `Stream` back to a call that expected an `Effect`, so it says so instead.
 */
export class ProviderReturnKindChanged extends Schema.TaggedError<ProviderReturnKindChanged>()(
  'ProviderReturnKindChanged',
  {
    token: TokenId,
  },
) {}

export class CoeffectsUnmet extends Schema.TaggedError<CoeffectsUnmet>()('CoeffectsUnmet', {
  plugin: PluginId,
  missing: Schema.Array(TokenId),
}) {}

export class DeclarationMismatch extends Schema.TaggedError<DeclarationMismatch>()(
  'DeclarationMismatch',
  {
    plugin: PluginId,
    problems: Schema.Array(MismatchProblem),
  },
) {}

export class SetupFailed extends Schema.TaggedError<SetupFailed>()('SetupFailed', {
  plugin: PluginId,
  cause: Schema.Unknown,
}) {}

export class DuplicateProvider extends Schema.TaggedError<DuplicateProvider>()(
  'DuplicateProvider',
  {
    token: TokenId,
    existing: PluginId,
    incoming: PluginId,
  },
) {}

export class GraphCycle extends Schema.TaggedError<GraphCycle>()('GraphCycle', {
  plugins: Schema.Array(PluginId),
}) {}

export const ActivationError = Schema.Union([CoeffectsUnmet, DeclarationMismatch, SetupFailed])
export type ActivationError = typeof ActivationError.Type

export class FacetImportFailed extends Schema.TaggedError<FacetImportFailed>()(
  'FacetImportFailed',
  {
    url: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class FacetInvalid extends Schema.TaggedError<FacetInvalid>()('FacetInvalid', {
  url: Schema.String,
}) {}

export const FacetLoadError = Schema.Union([FacetImportFailed, FacetInvalid])
export type FacetLoadError = typeof FacetLoadError.Type

export const BootError = Schema.Union([DuplicateProvider, GraphCycle])
export type BootError = typeof BootError.Type

export class UnknownProject extends Schema.TaggedError<UnknownProject>()('UnknownProject', {
  project: ProjectId,
}) {}

export class UnknownThread extends Schema.TaggedError<UnknownThread>()('UnknownThread', {
  thread: ThreadId,
}) {}

export class RelativeCwd extends Schema.TaggedError<RelativeCwd>()('RelativeCwd', {
  cwd: Schema.String,
}) {}

export class ApprovalUndecided extends Schema.TaggedError<ApprovalUndecided>()(
  'ApprovalUndecided',
  {
    request: Schema.String,
  },
) {}
