import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import type { ConversationProps } from '@oru/ui'

/**
 * The conversation slot's definition: a thread's viewer. The header names
 * the thread the route selected; the column between it and the composer
 * holds nothing yet, because live thread state still arrives over RPC the
 * app does not subscribe to — that subscription is the recorded follow-up,
 * and this def is where it lands.
 */

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Noop: {},
})
export type Message = typeof Message.Type

export const init = (): Model => ({})

type ConversationReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): ConversationReturn =>
  Message.match<ConversationReturn>(message, {
    Noop: () => ({ model }),
  })

const threadName = (id: string): string => id

export const view = defineView<Model, Message, ConversationProps>((model, props, h) =>
  h.div(
    [h.Class('flex min-h-0 flex-1 flex-col')],
    [
      h.header(
        [h.Class('flex h-10 shrink-0 items-center px-5')],
        [
          h.span(
            [h.Class('truncate text-sm font-medium')],
            [props.threadId === undefined ? '' : threadName(props.threadId)],
          ),
        ],
      ),
      h.div([h.Class('min-h-0 flex-1')], []),
    ],
  ),
)
