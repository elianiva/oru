import type { View as SubmodelView } from 'foldkit/submodel'
import type { SlotId, UiSignal } from '@oru/ui'

/**
 * One `panel` slot definition the terminal plugin contributes, typed by
 * the submodel it wraps (same shape as chat-ui's `ChatUiDef`). The loader
 * validates the record by schema at runtime; concrete defs assign without
 * casts. A def never returns commands — the app executes everything.
 */
export interface TerminalDef<Model, Message, Props, OutMessage> {
  readonly slot: SlotId
  readonly defId: string
  readonly init: () => Model
  readonly update: (
    model: Model,
    message: Message,
  ) => {
    readonly model: Model
    readonly outMessage?: OutMessage
  }
  readonly view: SubmodelView<Model, Message, Props>
  readonly absorb?: (model: Model, props: Props) => Model
  readonly signal?: (model: Model, signal: UiSignal) => Model
}
