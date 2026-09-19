import type { View as SubmodelView } from 'foldkit/submodel'
import type { SlotId, UiSignal } from '@oru/ui'

/**
 * One slot definition chat-ui contributes, typed by the submodel it wraps.
 * Concrete defs name their own Model, Message, and props, so the facet
 * entry below assigns without a single cast; the loader validates the same
 * records by schema at runtime. A def never returns commands — the app
 * executes everything, the def only announces intents.
 *
 * `absorb` folds host facts that arrive as props into state, silently and
 * without out-messages. `signal` delivers one-shot plain-data signals root
 * cannot construct messages for.
 */
export interface ChatUiDef<Model, Message, Props, OutMessage> {
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
