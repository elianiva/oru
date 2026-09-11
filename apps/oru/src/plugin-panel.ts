import { Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import type { PanelUi } from './fixtures.ts'

export const Model = Schema.Struct({
  title: Schema.String,
  acks: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedTitle: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedAck: {},
})
export type OutMessage = typeof OutMessage.Type

export const init = (ui: PanelUi): Model => ({ title: ui.title, acks: 0 })

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    ClickedTitle: () => ({
      model: { ...model, acks: model.acks + 1 },
      outMessage: OutMessage.RequestedAck(),
    }),
  })

export const view = defineView<Model, Message>((model, h) =>
  h.section(
    [],
    [
      h.button(
        [h.OnClick(Message.ClickedTitle())],
        model.acks > 0 ? [model.title, 'acked'] : [model.title],
      ),
    ],
  ),
)
