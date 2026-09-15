import { Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'

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

export const init = (title: string): Model => ({ title, acks: 0 })

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    ClickedTitle: () => ({
      model: { ...model, acks: model.acks + 1 },
      outMessage: OutMessage.RequestedAck(),
    }),
  })

export const view = defineView<Model, Message>((model, h) =>
  button(
    {
      onClick: Message.ClickedTitle(),
      variant: 'ghost',
      size: 'sm',
      className: 'w-full min-w-0 justify-start gap-2 font-normal text-sidebar-foreground/85',
    },
    model.acks > 0
      ? [model.title, badge({ variant: 'secondary', className: 'ml-auto shrink-0' }, ['acked'], h)]
      : model.title,
    h,
  ),
)
