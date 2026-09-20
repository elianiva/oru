import { Schema } from 'effect'
import { PluginId, ProjectId, ThreadId, TokenId } from './primitives.ts'

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

export class InjectUnmet extends Schema.TaggedError<InjectUnmet>()('CoeffectsUnmet', {
  plugin: PluginId,
  missing: Schema.Array(TokenId),
}) {}

export const CoeffectsUnmet = InjectUnmet

export type CoeffectsUnmet = InjectUnmet

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

export const ActivationError = Schema.Union([CoeffectsUnmet, SetupFailed, DuplicateProvider])
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

export const BootError = DuplicateProvider
export type BootError = typeof BootError.Type

export class UnknownProject extends Schema.TaggedError<UnknownProject>()('UnknownProject', {
  project: ProjectId,
}) {}

/** The Personal singleton answers reads but refuses deletion: chat without a project must survive. */
export class PersonalProjectLocked extends Schema.TaggedError<PersonalProjectLocked>()(
  'PersonalProjectLocked',
  {
    project: ProjectId,
  },
) {}

export class UnknownThread extends Schema.TaggedError<UnknownThread>()('UnknownThread', {
  thread: ThreadId,
}) {}

export class RelativeCwd extends Schema.TaggedError<RelativeCwd>()('RelativeCwd', {
  cwd: Schema.String,
}) {}

export class NotDirectory extends Schema.TaggedError<NotDirectory>()('NotDirectory', {
  path: Schema.String,
}) {}

export class DirectoryMissing extends Schema.TaggedError<DirectoryMissing>()('DirectoryMissing', {
  path: Schema.String,
}) {}

export class ApprovalUndecided extends Schema.TaggedError<ApprovalUndecided>()(
  'ApprovalUndecided',
  {
    request: Schema.String,
  },
) {}
