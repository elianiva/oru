import { Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { Card } from '@/components/ui/card.ts'
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
  Card(
    { size: 'sm' },
    [
      Card.content(
        { className: 'flex items-center gap-2' },
        [
          button(
            {
              onClick: Message.ClickedTitle(),
              variant: 'outline',
              className: 'flex-1',
            },
            model.title,
            h,
          ),
          ...(model.acks > 0 ? [badge({ variant: 'secondary' }, ['acked'], h)] : []),
        ],
        h,
      ),
    ],
    h,
  ),
)
