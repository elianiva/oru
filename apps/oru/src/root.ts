import { Effect, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import { GraphRpc } from './graph-rpc.ts'
import { Panel, ViewGraph } from './view-graph.ts'

export const Model = Schema.Struct({
  panels: Schema.Array(Panel),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Message = defineMessageUnion({
  GraphArrived: { graph: ViewGraph },
  ClickedToggleLogging: {},
})
export type Message = Schema.Schema.Type<typeof Message>

export const init = () => ({ model: { panels: [] } })

export const SetLogging = Command.define('SetLogging', {
  args: { live: Schema.Boolean },
  messages: [Message.GraphArrived],
  execute: ({ live }) =>
    GraphRpc.pipe(
      Effect.flatMap((rpc) => rpc.setLive('logging', live)),
      Effect.map((graph) => Message.GraphArrived({ graph })),
      Effect.orDie,
    ),
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GraphArrived: ({ graph }) => ({ model: { panels: graph.active } }),
    ClickedToggleLogging: () => ({
      model,
      commands: [SetLogging({ live: !model.panels.some((panel) => panel.plugin === 'logging') })],
    }),
  })

export const subscriptions = Subscription.make<Model, Message, GraphRpc>()(() => ({
  graph: Subscription.persistent(
    Stream.unwrap(
      GraphRpc.pipe(
        Effect.map((rpc) => rpc.watch.pipe(Stream.map((graph) => Message.GraphArrived({ graph })))),
      ),
    ),
  ),
}))

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.main(
    [],
    [
      h.button(
        [h.Attribute('data-logging-toggle', ''), h.OnClick(Message.ClickedToggleLogging())],
        [
          model.panels.some((panel) => panel.plugin === 'logging')
            ? 'Turn logging off'
            : 'Turn logging on',
        ],
      ),
      ...model.panels.map((panel) =>
        h.keyed('section')(panel.plugin, [h.Attribute('data-plugin', panel.plugin)], [panel.title]),
      ),
    ],
  )
