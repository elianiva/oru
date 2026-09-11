import { Effect, HashMap, Option, Result, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { inferencePlugin } from '@oru/inference'
import { PluginId, ThreadId } from '@oru/kernel'
import { button } from '@/components/ui/button.ts'
import { syncActivePanels } from './active-panels.ts'
import { decodePanelUi, fixturePlugins, type PanelUi } from './fixtures.ts'
import { GraphRpc } from './graph-rpc.ts'
import * as PluginPanel from './plugin-panel.ts'
import { twoPane } from './shell.ts'
import { ThreadClient } from './thread-client.ts'
import * as ThreadPanel from './thread-panel.ts'
import { lineOf } from './transcript.ts'
import { ViewGraph } from './view-graph.ts'

const uiByPlugin = new Map(fixturePlugins.map((plugin) => [plugin.id, plugin.ui]))

const panelUiFor = (id: string, fallbackTitle: string): PanelUi =>
  Option.getOrElse(decodePanelUi(uiByPlugin.get(id)), () => ({ title: fallbackTitle }))

const titledPlugins = (graph: ViewGraph): ReadonlySet<string> => {
  const ids = new Set<string>()
  for (const panel of graph.active) {
    if (Option.isSome(decodePanelUi(uiByPlugin.get(panel.plugin)))) ids.add(panel.plugin)
  }
  return ids
}

const inferenceLive = (graph: ViewGraph): boolean =>
  graph.active.some((panel) => panel.plugin === inferencePlugin.id)

export const Model = Schema.Struct({
  panels: Schema.HashMap(PluginId, PluginPanel.Model),
  thread: Schema.UndefinedOr(ThreadPanel.Model),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GraphArrived: { graph: ViewGraph },
  ClickedToggleLogging: {},
  GotPluginMessage: { plugin: PluginId, message: PluginPanel.Message },
  GotThreadMessage: { message: ThreadPanel.Message },
  SendFinished: {},
})
export type Message = typeof Message.Type

export const init = () => ({
  model: {
    panels: HashMap.empty<string, PluginPanel.Model>(),
    thread: undefined,
  },
})

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

export const CreateThread = Command.define('CreateThread', {
  messages: [Message.GotThreadMessage],
  execute: ThreadClient.pipe(
    Effect.flatMap((rpc) => rpc.create),
    Effect.map((created) =>
      Message.GotThreadMessage({
        message: ThreadPanel.Message.Opened({ threadId: created.threadId }),
      }),
    ),
    Effect.orDie,
  ),
})

export const SendMessage = Command.define('SendMessage', {
  args: { threadId: ThreadId, text: Schema.String },
  messages: [Message.SendFinished],
  execute: ({ threadId, text }) =>
    ThreadClient.pipe(
      Effect.flatMap((rpc) => rpc.send(threadId, text)),
      Effect.as(Message.SendFinished()),
      Effect.orDie,
    ),
})

const foldPluginOutMessage = (outMessage: PluginPanel.OutMessage): Update.Step<Model, Message> =>
  PluginPanel.OutMessage.match(outMessage, {
    RequestedAck: () => (model) => ({ model }),
  })

const foldThreadOutMessage = (
  outMessage: ThreadPanel.OutMessage,
): Update.Step<Model, Message, ThreadClient> =>
  ThreadPanel.OutMessage.match(outMessage, {
    RequestedSend:
      ({ text }) =>
      (model) => {
        const threadId = model.thread?.threadId
        if (threadId === undefined) return { model }
        return { model, commands: [SendMessage({ threadId, text })] }
      },
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

const foldThread = Update.foldChild({
  update: ThreadPanel.update,
  read: (model: Model) => Option.fromUndefinedOr(model.thread),
  write: (model, nextChild) => ({ ...model, thread: nextChild }),
  toParentMessage: (message: ThreadPanel.Message) => Message.GotThreadMessage({ message }),
  foldOutMessage: foldThreadOutMessage,
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GraphArrived: ({ graph }) => {
      const titles = new Map(graph.active.map((panel) => [panel.plugin, panel.title]))
      const panels = syncActivePanels(model.panels, titledPlugins(graph), (id) =>
        PluginPanel.init(panelUiFor(id, titles.get(id) ?? id)),
      )
      if (!inferenceLive(graph)) return { model: { panels, thread: undefined } }
      if (model.thread !== undefined) return { model: { panels, thread: model.thread } }
      return {
        model: { panels, thread: ThreadPanel.init() },
        commands: [CreateThread()],
      }
    },
    ClickedToggleLogging: () => ({
      model,
      commands: [SetLogging({ live: !HashMap.has(model.panels, 'logging') })],
    }),
    GotPluginMessage: ({ plugin, message: childMessage }) =>
      foldPlugin(plugin)(model, childMessage),
    GotThreadMessage: ({ message: childMessage }) => foldThread(model, childMessage),
    SendFinished: () => ({ model }),
  })

export const subscriptions = Subscription.make<Model, Message, GraphRpc | ThreadClient>()(
  (entry) => ({
    graph: Subscription.persistent(
      Stream.unwrap(
        GraphRpc.pipe(
          Effect.map((rpc) =>
            rpc.watch.pipe(Stream.map((graph) => Message.GraphArrived({ graph }))),
          ),
        ),
      ),
    ),
    thread: entry(
      { threadId: Schema.UndefinedOr(ThreadId) },
      {
        modelToDependencies: (model) => ({ threadId: model.thread?.threadId }),
        dependenciesToStream: ({ threadId }) => {
          if (threadId === undefined) return Stream.empty
          return Stream.unwrap(
            ThreadClient.pipe(
              Effect.map((rpc) =>
                rpc.watch(threadId).pipe(
                  Stream.filterMap((event) => {
                    const line = lineOf(event)
                    if (line === undefined) return Result.failVoid
                    return Result.succeed(line)
                  }),
                  Stream.map((line) =>
                    Message.GotThreadMessage({
                      message: ThreadPanel.Message.LineArrived({ line }),
                    }),
                  ),
                ),
              ),
            ),
          )
        },
      },
    ),
  }),
)

export const view = (model: Model, h: HtmlBuilder<Message>) => {
  const loggingOn = HashMap.has(model.panels, 'logging')
  return twoPane(h, {
    rail: [
      button(
        {
          onClick: Message.ClickedToggleLogging(),
          variant: 'ghost',
          size: 'sm',
          className: 'w-full justify-start font-normal text-sidebar-foreground/85',
          attributes: [h.Attribute('data-logging-toggle', '')],
        },
        loggingOn ? 'Turn logging off' : 'Turn logging on',
        h,
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
    pane:
      model.thread === undefined
        ? undefined
        : h.submodel({
            slotId: 'thread',
            model: model.thread,
            view: ThreadPanel.view,
            toParentMessage: (childMessage) => Message.GotThreadMessage({ message: childMessage }),
          }),
  })
}
