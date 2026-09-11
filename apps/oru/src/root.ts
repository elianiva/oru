import { Effect, HashMap, Option, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { PluginId } from '@oru/kernel'
import { syncActivePanels } from './active-panels.ts'
import { decodePanelUi, fixturePlugins, type PanelUi } from './fixtures.ts'
import { GraphRpc } from './graph-rpc.ts'
import * as PluginPanel from './plugin-panel.ts'
import { ViewGraph } from './view-graph.ts'

const uiByPlugin = new Map(fixturePlugins.map((plugin) => [plugin.id, plugin.ui]))

const panelUiFor = (id: string, fallbackTitle: string): PanelUi =>
  Option.getOrElse(decodePanelUi(uiByPlugin.get(id)), () => ({ title: fallbackTitle }))

export const Model = Schema.Struct({
  panels: Schema.HashMap(PluginId, PluginPanel.Model),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GraphArrived: { graph: ViewGraph },
  ClickedToggleLogging: {},
  GotPluginMessage: { plugin: PluginId, message: PluginPanel.Message },
})
export type Message = typeof Message.Type

export const init = () => ({ model: { panels: HashMap.empty<string, PluginPanel.Model>() } })

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

const foldPluginOutMessage = (outMessage: PluginPanel.OutMessage): Update.Step<Model, Message> =>
  PluginPanel.OutMessage.match(outMessage, {
    RequestedAck: () => (model) => ({ model }),
  })

const foldPlugin = (plugin: string) =>
  Update.foldChild({
    update: PluginPanel.update,
    read: (model: Model) => HashMap.get(model.panels, plugin),
    write: (model, nextChild) => ({
      ...model,
      panels: HashMap.set(model.panels, plugin, nextChild),
    }),
    toParentMessage: (message: PluginPanel.Message) =>
      Message.GotPluginMessage({ plugin, message }),
    foldOutMessage: foldPluginOutMessage,
  })

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GraphArrived: ({ graph }) => {
      const titles = new Map(graph.active.map((panel) => [panel.plugin, panel.title]))
      return {
        model: {
          panels: syncActivePanels(
            model.panels,
            new Set(graph.active.map((panel) => panel.plugin)),
            (id) => PluginPanel.init(panelUiFor(id, titles.get(id) ?? id)),
          ),
        },
      }
    },
    ClickedToggleLogging: () => ({
      model,
      commands: [SetLogging({ live: !HashMap.has(model.panels, 'logging') })],
    }),
    GotPluginMessage: ({ plugin, message: childMessage }) =>
      foldPlugin(plugin)(model, childMessage),
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
        [HashMap.has(model.panels, 'logging') ? 'Turn logging off' : 'Turn logging on'],
      ),
      ...HashMap.toEntries(model.panels).map(([plugin, child]) =>
        h.submodel({
          slotId: plugin,
          model: child,
          view: PluginPanel.view,
          toParentMessage: (childMessage) =>
            Message.GotPluginMessage({ plugin, message: childMessage }),
        }),
      ),
    ],
  )
