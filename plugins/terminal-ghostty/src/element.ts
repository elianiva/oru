import { Schema } from 'effect'
import { CustomElement } from 'foldkit'
import { Restty } from 'restty'

/**
 * The `<oru-terminal>` custom element: the imperative boundary for restty.
 *
 * Foldkit views are pure declarations; restty needs a stable-size root
 * element plus explicit `destroy()` on unmount. The element owns that:
 * `connectedCallback` creates one single-pane `Restty` and calls
 * `connectPty(wsUrl)` (default `createWebSocketPtyTransport`), and
 * `disconnectedCallback` destroys it (which closes the WS; the host kills
 * the zigpty child on socket close). Property changes reconnect.
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

const MOUNTED = new Map<HTMLElement, { destroy: () => void; wsUrl: string }>()

const wsUrlOf = (element: HTMLElement): string =>
  element.getAttribute('ws-url') ?? element.getAttribute('wsurl') ?? ''

export const mountTerminal = (root: HTMLElement): void => {
  const wsUrl = wsUrlOf(root)
  if (wsUrl.length === 0) return
  const existing = MOUNTED.get(root)
  if (existing !== undefined && existing.wsUrl === wsUrl) return
  existing?.destroy()
  const restty = new Restty({
    root,
    surface: { shortcuts: true, searchUi: true, defaultContextMenu: true },
    terminal: { renderer: 'auto', fontSize: 14, ligatures: true },
  })
  const destroy = (): void => {
    try {
      restty.destroy()
    } catch {
      void 0
    }
  }
  MOUNTED.set(root, { destroy, wsUrl })
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
