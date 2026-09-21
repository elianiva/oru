import { Schema } from 'effect'
import { CustomElement } from 'foldkit'
import { Restty, createWebSocketPtyTransport } from 'restty'

/**
 * The `<oru-terminal>` custom element: the imperative boundary for restty.
 *
 * Foldkit views are pure declarations; restty needs a stable-size root
 * element plus explicit `destroy()` on unmount. The element owns that:
 * `connectedCallback` creates one single-pane `Restty` and calls
 * `connectPty(wsUrl)`, and `disconnectedCallback` destroys it (which
 * closes the WS; the host kills the zigpty child on socket close).
 * Literal `ws-url`/`session-id` attributes (not properties, not `data-*`)
 * drive reconnects through `observedAttributes`.
 *
 * The transport delegates to restty's default WebSocket transport with
 * tapped error/exit callbacks driving an overlay, so a dead session says
 * so instead of rendering blank. Restty's own callbacks always run first;
 * they own the status line and disconnect handling.
 *
 * `restty` ships its WASM (`libghostty-vt`) as an inlined string, so
 * `oru-build-plugin`'s single-file tsdown UI bundle keeps working with
 * no separate `.wasm` asset to emit.
 */

export const terminalElementSpec = CustomElement.define({
  tag: 'oru-terminal',
  properties: {
    sessionId: Schema.String,
    wsUrl: Schema.String,
  },
  events: {},
})

interface MountedTerminal {
  readonly destroy: () => void
  readonly wsUrl: string
  readonly overlay: HTMLElement
}

const MOUNTED = new Map<HTMLElement, MountedTerminal>()

const wsUrlOf = (element: HTMLElement): string =>
  element.getAttribute('ws-url') ?? element.getAttribute('wsurl') ?? ''

const overlayOf = (root: HTMLElement): HTMLElement => {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-terminal-status', '')
  overlay.style.cssText = `position:absolute;left:8px;right:8px;bottom:8px;display:none;padding:6px 10px;border-radius:6px;font-size:12px;font-family:monospace;`
  root.appendChild(overlay)
  return overlay
}

const showOverlay = (overlay: HTMLElement, text: string): void => {
  overlay.textContent = text
  overlay.style.display = 'block'
}

const hideOverlay = (overlay: HTMLElement): void => {
  overlay.textContent = ''
  overlay.style.display = 'none'
}

export const mountTerminal = (root: HTMLElement): void => {
  const wsUrl = wsUrlOf(root)
  const existing = MOUNTED.get(root)
  if (wsUrl.length === 0) {
    // An emptied URL releases the stale instance instead of leaking it.
    if (existing !== undefined) {
      MOUNTED.delete(root)
      existing.destroy()
    }
    return
  }
  if (existing !== undefined && existing.wsUrl === wsUrl) return
  existing?.destroy()
  const overlay = existing?.overlay ?? overlayOf(root)
  hideOverlay(overlay)
  let restty: Restty
  try {
    const base = createWebSocketPtyTransport()
    restty = new Restty({
      root,
      surface: { shortcuts: true, searchUi: true, defaultContextMenu: true },
      terminal: { renderer: 'auto', fontSize: 14, ligatures: true },
      services: {
        ptyTransport: {
          ...base,
          connect: (options) =>
            base.connect({
              ...options,
              callbacks: {
                ...options.callbacks,
                onError: (message, errors) => {
                  options.callbacks?.onError?.(message, errors)
                  showOverlay(overlay, `terminal error: ${message}`)
                },
                onExit: (code) => {
                  options.callbacks?.onExit?.(code)
                  showOverlay(overlay, `shell exited (code ${code})`)
                },
              },
            }),
        },
      },
    })
  } catch {
    // A constructor throw leaves nothing behind to retry against.
    MOUNTED.delete(root)
    return
  }
  const destroy = (): void => {
    try {
      overlay.remove()
    } catch {
      void 0
    }
    try {
      restty.destroy()
    } catch {
      void 0
    }
  }
  MOUNTED.set(root, { destroy, wsUrl, overlay })
  try {
    restty.connectPty(wsUrl)
  } catch {
    MOUNTED.delete(root)
    destroy()
  }
}

export const unmountTerminal = (root: HTMLElement): void => {
  const existing = MOUNTED.get(root)
  if (existing === undefined) return
  MOUNTED.delete(root)
  existing.destroy()
}

export const defineTerminalElement = (): void => {
  if (typeof customElements === 'undefined') return
  if (customElements.get('oru-terminal') !== undefined) return
  class OruTerminal extends HTMLElement {
    connectedCallback(): void {
      mountTerminal(this)
    }
    disconnectedCallback(): void {
      unmountTerminal(this)
    }
    static get observedAttributes(): string[] {
      return ['ws-url', 'session-id']
    }
    attributeChangedCallback(): void {
      if (this.isConnected) mountTerminal(this)
    }
  }
  customElements.define('oru-terminal', OruTerminal)
}
