import { Schema } from 'effect'
import { PluginId, TokenId } from './primitives.ts'

export const ServiceMissing = Schema.TaggedStruct('ServiceMissing', { token: TokenId })

export const MismatchProblem = Schema.Union([ServiceMissing])
export type MismatchProblem = typeof MismatchProblem.Type

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  'ProviderUnavailable',
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

export const BootError = Schema.Union([DuplicateProvider, GraphCycle])
export type BootError = typeof BootError.Type
