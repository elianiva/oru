import { descriptorOf, type ToolContribution } from '@oru/harness'

/**
 * What the extension registers: a name, a description, and the draft-2020-12
 * JSON Schema pi's side converts to TypeBox. oru tools are JSON; the bridge
 * adds no vocabulary of its own.
 */
export interface PiDynamicTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface PiToolOutcome {
  readonly text: string
  readonly isError: boolean
}

/** The bridge's view of one request's tools: what pi sees, and how oru runs it. */
export interface PiToolBridge {
  readonly tools: readonly PiDynamicTool[]
  readonly run: (name: string, argumentsJson: string) => Promise<PiToolOutcome>
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
 * Run one of oru's tools for a call pi forwarded. The tool's own typed error
 * is a result the model reads and adapts to, so it comes back as `isError`
 * text rather than a bridge fault.
 */
export const runDynamicToolCall = async (
  tools: readonly ToolContribution[],
  execute: (input: {
    readonly name: string
    readonly argumentsJson: string
  }) => Promise<{ readonly ok: boolean; readonly result: string }>,
  name: string,
  argumentsJson: string,
): Promise<PiToolOutcome> => {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) return unknownTool(name)
  try {
    JSON.parse(argumentsJson)
  } catch {
    return failure('input_parse_error', `Arguments for "${name}" were not valid JSON`)
  }
  const outcome = await execute({ name, argumentsJson })
  // The result is already the string the model reads; serializing it again
  // would double-encode it.
  return outcome.ok
    ? { text: outcome.result, isError: false }
    : failure('execution_error', outcome.result)
}

/** Bind one request's tools to the bridge that runs its tool calls. */
export const toolBridgeOf = (
  tools: readonly ToolContribution[],
  execute: (input: {
    readonly name: string
    readonly argumentsJson: string
  }) => Promise<{ readonly ok: boolean; readonly result: string }>,
): PiToolBridge => ({
  tools: tools.map((tool) => {
    const descriptor = descriptorOf(tool)
    return {
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.parameters,
    }
  }),
  run: (name, argumentsJson) => runDynamicToolCall(tools, execute, name, argumentsJson),
})
