import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

/**
 * pi's RPC framing, on both directions of both channels.
 *
 * Records are LF-delimited and nothing else is. A payload may legally contain
 * `U+2028` / `U+2029` inside a JSON string, so `node:readline` is not usable
 * here because it splits on those too. (`packages/coding-agent/docs/rpc.md`,
 * "Framing".)
 */
export const serializeJsonLine = <Value>(value: Value): string => `${JSON.stringify(value)}\n`

/** A line longer than this is a protocol fault, not a payload worth buffering. */
export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024

export const attachJsonlLineReader = (
  stream: Readable,
  onLine: (line: string) => void,
  options: {
    readonly maxLineBytes?: number
    readonly onOverflow?: (bytes: number) => void
  } = {},
): (() => void) => {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let overflowed = false

  const emit = (line: string) => {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line)
  }

  // Byte streams only: a reader that took strings would have to guess the
  // framing, which is the thing this reader exists to get right.
  const onData = (chunk: Buffer) => {
    pending += decoder.write(chunk)
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline === -1) {
        if (pending.length > maxLineBytes && !overflowed) {
          overflowed = true
          options.onOverflow?.(pending.length)
          pending = ''
        }
        return
      }
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (overflowed) {
        overflowed = false
        continue
      }
      emit(line)
    }
  }

  const onEnd = () => {
    pending += decoder.end()
    if (pending.length > 0) {
      emit(pending)
      pending = ''
    }
  }

  stream.on('data', onData)
  stream.on('end', onEnd)

  return () => {
    stream.off('data', onData)
    stream.off('end', onEnd)
  }
}
