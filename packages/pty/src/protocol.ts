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
const decodeServer = Schema.decodeUnknownOption(ServerMessage)

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

/** True when an outbound text frame is a protocol message, not PTY output. */
export const isServerMessage = (text: string): boolean => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  return Option.isSome(decodeServer(parsed))
}

export const encodeStatus = (shell?: string): string =>
  shell === undefined ? `{"type":"status"}` : JSON.stringify({ type: 'status', shell })

export const encodeError = (message: string): string => JSON.stringify({ type: 'error', message })

export const encodeExit = (code: number): string => JSON.stringify({ type: 'exit', code })

/** `?projectId=&cols=&rows=&shell=` from the upgrade query. */
export interface PtyQuery {
  readonly projectId?: string | undefined
  readonly cols?: number | undefined
  readonly rows?: number | undefined
  readonly shell?: string | undefined
}

export const parsePtyQuery = (search: string): PtyQuery => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const num = (key: string): number | undefined => {
    const raw = params.get(key)
    if (raw === null) return undefined
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    return parsed
  }
  const str = (key: string): string | undefined => {
    const raw = params.get(key)
    if (raw === null || raw.length === 0) return undefined
    return raw
  }
  return { projectId: str('projectId'), cols: num('cols'), rows: num('rows'), shell: str('shell') }
}
