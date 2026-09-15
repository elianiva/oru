import { Effect, Match, Result } from 'effect'
import * as Tool from '@effect-uai/core/Tool'
import * as ToolEvent from '@effect-uai/core/ToolEvent'
import * as Toolkit from '@effect-uai/core/Toolkit'
import { serializeValue } from '@effect-uai/core/ToolResult'

/**
 * What the extension registers: a name, a description, and the draft-2020-12
 * JSON Schema pi's side converts to TypeBox. This is effect-uai's own
 * descriptor, unchanged; the bridge adds no vocabulary of its own.
 */
export type PiDynamicTool = Tool.ToolDescriptor

export interface PiToolOutcome {
  readonly text: string
  readonly isError: boolean
}

/** The bridge's view of one request's toolkit: what pi sees, and how oru runs it. */
export interface PiToolBridge {
  readonly tools: readonly PiDynamicTool[]
  readonly run: (
    name: string,
    argumentsJson: string,
    onProgress: (callId: string, delta: string) => void,
  ) => Promise<PiToolOutcome>
}

const unknownTool = (name: string): PiToolOutcome => ({
  text: JSON.stringify({ error: { kind: 'unknown_tool', message: `No tool named "${name}"` } }),
  isError: true,
})

const failure = (kind: string, message: string): PiToolOutcome => ({
  text: JSON.stringify({ error: { kind, message } }),
  isError: true,
})

/**
 * Run one of oru's tools for a call pi forwarded, reporting progress as it
 * arrives. The tool's own typed error is a result the model reads and adapts
 * to, so it comes back as `isError` text rather than a bridge fault. The text
 * is effect-uai's own wire form, so the model sees the same body whichever
 * harness ran the tool.
 */
export const runDynamicToolCall = async (
  toolkit: Toolkit.Toolkit,
  name: string,
  argumentsJson: string,
  onProgress: (callId: string, delta: string) => void,
): Promise<PiToolOutcome> => {
  const tool = Object.hasOwn(toolkit, name) ? toolkit[name] : undefined
  if (tool === undefined) return unknownTool(name)
  return Match.value(tool).pipe(
    Match.tag('LocalTool', async (tool) => {
      const call = {
        type: 'function_call' as const,
        call_id: `pi-${name}`,
        name,
        arguments: argumentsJson,
      }
      const decoded = await Effect.runPromise(Tool.decodeCallInput(tool, call))
      return Match.value(decoded).pipe(
        Match.tag('parseError', () =>
          Promise.resolve(
            failure('input_parse_error', `Arguments for "${name}" were not valid JSON`),
          ),
        ),
        Match.tag('invalid', (decoded) => {
          const issues = decoded.issues
            .map((issue) => issue.message)
            .join('; ')
            .slice(0, 500)
          return Promise.resolve(
            failure('input_validation_error', issues === '' ? 'Input failed validation' : issues),
          )
        }),
        Match.tag('ok', async (decoded) => {
          const executed = tool.run(decoded.input, (event: ToolEvent.ToolEvent) =>
            Effect.sync(() => {
              if (ToolEvent.isProgress(event)) {
                onProgress(event.call_id, serializeValue(event.data))
              }
            }),
          )
          // SAFETY: the bridge runs oru tools as a host with no leftover services
          const ran = await Effect.runPromise(
            Effect.result(executed as Effect.Effect<unknown, unknown>),
          )
          return Result.isSuccess(ran)
            ? { text: serializeValue(ran.success), isError: false }
            : failure('execution_error', String(ran.failure))
        }),
        Match.exhaustive,
      )
    }),
    Match.orElse(() =>
      Promise.resolve(
        failure('non_local_tool', `Tool "${name}" is model-visible but has no local executor`),
      ),
    ),
  )
}

/** Bind one request's toolkit to the bridge that runs its tool calls. */
export const toolBridgeOf = (toolkit: Toolkit.Toolkit): PiToolBridge => ({
  tools: Toolkit.descriptors(toolkit),
  run: (name, argumentsJson, onProgress) =>
    runDynamicToolCall(toolkit, name, argumentsJson, onProgress),
})
