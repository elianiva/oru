import { Effect, Schema, SchemaTransformation } from 'effect'
import type { Document, JsonSchema } from 'effect/JSONSchema'
import { defineContributionKind } from '@oru/kernel'

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

/** A tool plugin contributes under this kind; the runtime reads it per turn. */
export const ToolKind = defineContributionKind<ToolContribution>('oru/tool')

/** An object schema with no properties: what a tool offers when generation fails. */
const EMPTY_PARAMETERS: JsonSchema = { type: 'object' }

/** The harness-facing view of a tool: a name, a description, and parameters. */
export interface HarnessToolDescriptor {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
}

/**
 * Render a contribution into the JSON Schema draft-2020-12 document the
 * bridge hands its provider. Derived at the turn boundary, so the log owns
 * Effect Schema and the wire owns JSON.
 */
export const descriptorOf = (tool: ToolContribution): HarnessToolDescriptor => {
  // SAFETY: ToolKind stores mixed tools whose schemas take no services; the codec decodes JSON-compatible input, so compiling it reads only its static shape.
  const schema = tool.parameters as Schema.Schema<unknown>
  let document: Document<'draft-2020-12'>
  try {
    document = Schema.toJsonSchemaDocument(schema)
  } catch {
    return { name: tool.name, description: tool.description, parameters: EMPTY_PARAMETERS }
  }
  return { name: tool.name, description: tool.description, parameters: document.schema }
}
