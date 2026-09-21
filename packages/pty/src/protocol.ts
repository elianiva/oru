import { Option, Schema } from 'effect'

/**
 * The restty WS dialect (`restty.pages.dev/docs`).
 *
 * Client → server JSON: `{type:"input",data}`, `{type:"resize",cols,rows,...}`.
 * The upgrade query also honors `?cols=&rows=&shell=` (plus `projectId`
 * beside it; the cwd itself is plugin-scoped, resolved from `projectId`,
 * never trusted from the client). Server → client: raw/binary UTF-8 PTY
 * output, or JSON `{type:"status"|"error"|"exit"}`. Non-status JSON-looking
 * text is output.
 */

export const PtyInput = Schema.Struct({
  type: Schema.Literal('input'),
  data: Schema.String,
})
export type PtyInput = typeof PtyInput.Type

export const PtyResize = Schema.Struct({
  type: Schema.Literal('resize'),
  cols: Schema.Number,
  rows: Schema.Number,
  widthPx: Schema.optional(Schema.Number),
  heightPx: Schema.optional(Schema.Number),
})
export type PtyResize = typeof PtyResize.Type

export const ClientMessage = Schema.Union([PtyInput, PtyResize])
export type ClientMessage = typeof ClientMessage.Type

export const StatusMessage = Schema.Struct({
  type: Schema.Literal('status'),
  shell: Schema.optional(Schema.String),
})
export type StatusMessage = typeof StatusMessage.Type

export const ErrorMessage = Schema.Struct({
  type: Schema.Literal('error'),
  message: Schema.String,
  errors: Schema.optional(Schema.Unknown),
})
export type ErrorMessage = typeof ErrorMessage.Type

export const ExitMessage = Schema.Struct({
  type: Schema.Literal('exit'),
  code: Schema.Number,
})
export type ExitMessage = typeof ExitMessage.Type

export const ServerMessage = Schema.Union([StatusMessage, ErrorMessage, ExitMessage])
export type ServerMessage = typeof ServerMessage.Type

const decodeClient = Schema.decodeUnknownOption(ClientMessage)

/** Parse one inbound text frame. Unknown JSON is output, never a crash. */
export const parseClientMessage = (text: string): ClientMessage | { readonly raw: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { raw: text }
  }
  const decoded = decodeClient(parsed)
  return Option.isSome(decoded) ? decoded.value : { raw: text }
}

export const encodeStatus = (shell?: string): string =>
  shell === undefined ? `{"type":"status"}` : JSON.stringify({ type: 'status', shell })

export const encodeError = (message: string): string => JSON.stringify({ type: 'error', message })

export const encodeExit = (code: number): string => JSON.stringify({ type: 'exit', code })
