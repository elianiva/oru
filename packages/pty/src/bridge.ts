import { encodeError, encodeExit, encodeStatus, parseClientMessage } from './protocol.ts'
import { clampGrid, type PtyHandle } from './pty.ts'

/**
 * One WS peer ↔ one zigpty handle, speaking the restty dialect.
 *
 * Inbound text frames decode as `{input|resize}`; anything else (including
 * unparseable text) forwards as raw input, matching restty's
 * "non-status JSON-looking text is output" rule in reverse. PTY bytes go
 * out verbatim; `{status}` once on open, `{exit}` once on child exit.
 * The socket closes after exit; the caller kills the PTY on socket close.
 */

export interface PtyPeer {
  readonly send: (data: string) => void
  readonly close: () => void
}

export const attachPtyPeer = (options: {
  readonly peer: PtyPeer
  readonly pty: PtyHandle
  readonly shell?: string
}): void => {
  const { peer, pty, shell } = options
  try {
    peer.send(encodeStatus(shell))
  } catch {
    // A peer that died between upgrade and open has nothing to hear;
    // its close kills the session below, never the PTY.
    void 0
  }
  pty.onData((data) => {
    try {
      peer.send(data)
    } catch {
      // A dead peer kills on close below; never crash the PTY on send.
      void 0
    }
  })
  pty.onExit(({ exitCode }) => {
    try {
      peer.send(encodeExit(exitCode))
    } finally {
      peer.close()
    }
  })
}

export const handlePtyFrame = (pty: PtyHandle, peer: PtyPeer, frame: string): void => {
  const message = parseClientMessage(frame)
  if ('raw' in message) {
    try {
      pty.write(message.raw)
    } catch {
      peer.send(encodeError('pty write failed'))
    }
    return
  }
  if (message.type === 'input') {
    try {
      pty.write(message.data)
    } catch {
      peer.send(encodeError('pty write failed'))
    }
    return
  }
  const grid = clampGrid(message.cols, message.rows)
  try {
    pty.resize(grid.cols, grid.rows)
  } catch {
    peer.send(encodeError('pty resize failed'))
  }
}
