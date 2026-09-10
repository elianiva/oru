import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { Panel, ViewGraph } from './view-graph.ts'

export const Model = Schema.Struct({
  panels: Schema.Array(Panel),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Message = defineMessageUnion({
  GraphArrived: { graph: ViewGraph },
})
export type Message = Schema.Schema.Type<typeof Message>

export const update = (model: Model, message: Message): { model: Model } =>
  Message.match(message, {
    GraphArrived: ({ graph }) => ({ model: { panels: graph.active } }),
  })

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.main(
    [],
    model.panels.map((panel) =>
      h.keyed('section')(panel.plugin, [h.Attribute('data-plugin', panel.plugin)], [panel.title]),
    ),
  )
