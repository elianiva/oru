import { Effect, Schema, SchemaTransformation } from 'effect'
import { contribute, defineContributionKind } from '@oru/kernel'

export interface ToolOutcome {
  readonly ok: boolean
  readonly result: string
}

export interface ToolContribution {
  readonly name: string
  readonly description: string
  readonly parameters: Schema.Codec<unknown>
  readonly runJson: (argumentsJson: string) => Effect.Effect<ToolOutcome>
}

const JsonUnknown = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, SchemaTransformation.fromJsonString()),
)

export const defineTool = <A>(spec: {
  readonly name: string
  readonly description: string
  readonly parameters: Schema.Schema<A>
  readonly execute: (input: A) => Effect.Effect<string>
}): ToolContribution => ({
  name: spec.name,
  description: spec.description,
  // SAFETY: ToolKind stores mixed tools; A is recovered by this closure via decode
  parameters: spec.parameters as Schema.Codec<unknown>,
  runJson: (argumentsJson) => {
    const ran = Effect.gen(function* () {
      const raw = yield* Schema.decodeUnknownEffect(JsonUnknown)(argumentsJson)
      const input = yield* Schema.decodeUnknownEffect(spec.parameters)(raw)
      const result = yield* spec.execute(input)
      return { ok: true as const, result }
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed({
          ok: false as const,
          result: cause instanceof Error && cause.message !== '' ? cause.message : String(cause),
        }),
      ),
    )
    // SAFETY: execute is Effect<string> with no remaining requirements; decode is schema-only
    return ran as Effect.Effect<ToolOutcome>
  },
})

export const ToolKind = defineContributionKind<ToolContribution>('oru/tool')

export const contributeTool = (spec: ToolContribution) => contribute(ToolKind, spec)
