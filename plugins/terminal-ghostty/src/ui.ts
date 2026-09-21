import type { PanelProps } from '@oru/ui'
import type { TerminalDef } from './defs.ts'
import * as Terminal from './terminal.ts'

/**
 * The `ui` facet entry: the definitions the host bundles and the app
 * imports. The loader reads `defs` and validates each record's slot and
 * definition id against the snapshot before mounting it.
 */
export const terminalDef: TerminalDef<
  Terminal.Model,
  Terminal.Message,
  PanelProps,
  Terminal.OutMessage
> = {
  slot: 'panel',
  defId: 'terminal',
  init: Terminal.init,
  update: Terminal.update,
  view: Terminal.view,
  absorb: Terminal.absorbProps,
}

export const defs = [terminalDef]
