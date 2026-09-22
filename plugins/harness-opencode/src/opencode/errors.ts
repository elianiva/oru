import { Predicate } from 'effect'
import { HarnessError, type Mutable } from '@oru/harness'

/**
 * Every failure the bridge produces, as the contract's own error.
 *
 * There is one class rather than a bridge-error-plus-HarnessError pair because
 * nothing here crosses a process boundary: the embedded host's failures are
 * Effect failures this module already sees as data, so wrapping them twice
 * would only add a conversion to keep in sync. Codes are the vocabulary the
 * runtime and the pane surface, so they are named once, here.
 */
export const bridgeError = (
  code: string,
  message: string,
  options: { readonly retryable?: boolean; readonly cause?: unknown } = {},
): HarnessError => {
  const fields: Mutable<{ message: string; code: string; retryable?: boolean; cause?: unknown }> = {
    message,
    code,
  }
  if (options.retryable !== undefined) fields.retryable = options.retryable
  if (options.cause !== undefined) fields.cause = options.cause
  return new HarnessError(fields)
}

/** The embedded host failed to open (or to answer); the next call retries. */
export const hostOpenFailed = (cause: unknown): HarnessError =>
  bridgeError('host_open_failed', `the embedded OpenCode host did not open: ${describe(cause)}`, {
    retryable: true,
    cause,
  })

/** The thread's history does not end in a prompt, so there is nothing to admit. */
export const malformedHistory = (): HarnessError =>
  bridgeError('malformed_history', "the thread's history does not end in a user message")

/** No turn is running, so there is nothing to steer into. The runtime queues. */
export const noActiveTurn = (threadId: string): HarnessError =>
  bridgeError('no_active_turn', `no active turn on thread ${threadId}`)

/** The operation exists but OpenCode's own API has no faithful counterpart. */
export const unsupportedOperation = (message: string): HarnessError =>
  bridgeError('unsupported_operation', message)

export const aborted = (): HarnessError => bridgeError('aborted', 'the turn was aborted')

export const interrupted = (reason: string, retryable: boolean): HarnessError =>
  bridgeError('interrupted', `the turn was interrupted: ${reason}`, { retryable })

export const executionFailed = (message: string, retryable: boolean): HarnessError =>
  bridgeError('execution_failed', message, { retryable })

const describe = (cause: unknown): string => {
  if (cause === undefined) return 'no cause was reported'
  if (cause instanceof Error) return cause.message
  if (Predicate.isString(cause)) return cause
  return JSON.stringify(cause) ?? 'an unknown failure was reported'
}
