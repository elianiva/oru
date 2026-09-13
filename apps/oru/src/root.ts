import { Effect, HashMap, Option, Result, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Inference } from '@oru/inference'
import { PluginId, ThreadId } from '@oru/kernel'
import { button } from '@/components/ui/button.ts'
import * as Sidebar from '@/components/ui/sidebar.ts'
import { syncActivePanels } from './active-panels.ts'
import { chatStub, initInfoSidebar, initRailSidebar } from './chat-stub.ts'
import { decodePanelUi, fixturePlugins, type PanelUi } from './fixtures.ts'
import { GraphRpc } from './graph-rpc.ts'
import * as PluginPanel from './plugin-panel.ts'
import { twoPane } from './shell.ts'
import { ThreadClient } from './thread-client.ts'
import * as ThreadPanel from './thread-panel.ts'
import { lineOf } from './transcript.ts'
import { ThreadConfig } from './thread-options.ts'
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

const inferenceLive = (graph: ViewGraph): boolean => graph.tokens.includes(Inference.key)

export const Model = Schema.Struct({
  panels: Schema.HashMap(PluginId, PluginPanel.Model),
  thread: Schema.UndefinedOr(ThreadPanel.Model),
  leftSidebar: Sidebar.Model,
  rightSidebar: Sidebar.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GraphArrived: { graph: ViewGraph },
  ClickedToggleLogging: {},
  GotPluginMessage: { plugin: PluginId, message: PluginPanel.Message },
  GotThreadMessage: { message: ThreadPanel.Message },
  GotLeftSidebar: { message: Sidebar.Message },
  GotRightSidebar: { message: Sidebar.Message },
  SendFinished: {},
})
export type Message = typeof Message.Type

export const init = () => ({
  model: {
    panels: HashMap.empty<string, PluginPanel.Model>(),
    thread: undefined,
    leftSidebar: initRailSidebar(),
    rightSidebar: initInfoSidebar(),
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
    Effect.flatMap((rpc) =>
      rpc.create(undefined).pipe(
        // A new thread opens with the choices it has, so the pane never shows an
        // empty picker and then fills it in.
        Effect.flatMap((created) =>
          rpc
            .options(created.threadId)
            .pipe(Effect.map((options) => ({ threadId: created.threadId, options }))),
        ),
      ),
    ),
    Effect.map((opened) =>
      Message.GotThreadMessage({ message: ThreadPanel.Message.Opened(opened) }),
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

export const ConfigureThread = Command.define('ConfigureThread', {
  args: { threadId: ThreadId, config: ThreadConfig },
  messages: [Message.GotThreadMessage],
  execute: ({ threadId, config }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.configure(threadId, config)),
      Effect.map((options) =>
        Message.GotThreadMessage({ message: ThreadPanel.Message.OptionsArrived(options) }),
      ),
      Effect.orDie,
    ),
})

export const StopThread = Command.define('StopThread', {
  args: { threadId: ThreadId },
  messages: [Message.SendFinished],
  execute: ({ threadId }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.stop(threadId)),
      Effect.as(Message.SendFinished()),
      Effect.orDie,
    ),
})

export const CompactThread = Command.define('CompactThread', {
  args: { threadId: ThreadId },
  messages: [Message.SendFinished],
  execute: ({ threadId }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.compact(threadId)),
      Effect.as(Message.SendFinished()),
      Effect.orDie,
    ),
})

const foldPluginOutMessage = (outMessage: PluginPanel.OutMessage): Update.Step<Model, Message> =>
  PluginPanel.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
    RequestedAck: () => (model) => ({ model }),
  })

const foldThreadOutMessage = (
  outMessage: ThreadPanel.OutMessage,
): Update.Step<Model, Message, ThreadClient> =>
  ThreadPanel.OutMessage.match<Update.Step<Model, Message, ThreadClient>>(outMessage, {
    RequestedSend:
      ({ text }) =>
      (model) => {
        const threadId = model.thread?.threadId
        if (threadId === undefined) return { model }
        return { model, commands: [SendMessage({ threadId, text })] }
      },
    RequestedConfigure:
      ({ config }) =>
      (model) => {
        const threadId = model.thread?.threadId
        if (threadId === undefined) return { model }
        return { model, commands: [ConfigureThread({ threadId, config })] }
      },
    RequestedStop: () => (model) => {
      const threadId = model.thread?.threadId
      if (threadId === undefined) return { model }
      return { model, commands: [StopThread({ threadId })] }
    },
    RequestedCompact: () => (model) => {
      const threadId = model.thread?.threadId
      if (threadId === undefined) return { model }
      return { model, commands: [CompactThread({ threadId })] }
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

const foldLeftSidebar = Update.foldChild({
  update: Sidebar.update,
  read: (model: Model) => Option.some(model.leftSidebar),
  write: (model, nextChild) => ({ ...model, leftSidebar: nextChild }),
  toParentMessage: (message: Sidebar.Message) => Message.GotLeftSidebar({ message }),
})

const foldRightSidebar = Update.foldChild({
  update: Sidebar.update,
  read: (model: Model) => Option.some(model.rightSidebar),
  write: (model, nextChild) => ({ ...model, rightSidebar: nextChild }),
  toParentMessage: (message: Sidebar.Message) => Message.GotRightSidebar({ message }),
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GraphArrived: ({ graph }) => {
      const titles = new Map(graph.active.map((panel) => [panel.plugin, panel.title]))
      const panels = syncActivePanels(model.panels, titledPlugins(graph), (id) =>
        PluginPanel.init(panelUiFor(id, titles.get(id) ?? id)),
      )
      if (!inferenceLive(graph)) return { model: { ...model, panels, thread: undefined } }
      if (model.thread !== undefined) return { model: { ...model, panels, thread: model.thread } }
      return {
        model: { ...model, panels, thread: ThreadPanel.init() },
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
    GotLeftSidebar: ({ message: childMessage }) => foldLeftSidebar(model, childMessage),
    GotRightSidebar: ({ message: childMessage }) => foldRightSidebar(model, childMessage),
    SendFinished: () => ({ model }),
  })

const railSubs = Subscription.lift(Sidebar.subscriptions)({
  toChildModel: (model: Model) => model.leftSidebar,
  toParentMessage: (message: Sidebar.Message): Message => Message.GotLeftSidebar({ message }),
})

const infoSubs = Subscription.lift(Sidebar.subscriptions)({
  toChildModel: (model: Model) => model.rightSidebar,
  toParentMessage: (message: Sidebar.Message): Message => Message.GotRightSidebar({ message }),
})

export const subscriptions = Subscription.aggregate<Model, Message, GraphRpc | ThreadClient>()(
  {
    railCookie: railSubs.cookie,
    railKeyboard: railSubs.keyboardShortcut,
    railMedia: railSubs.mediaQuery,
    infoCookie: infoSubs.cookie,
    infoMedia: infoSubs.mediaQuery,
  },
  Subscription.make<Model, Message, GraphRpc | ThreadClient>()((entry) => ({
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
    signals: entry(
      { threadId: Schema.UndefinedOr(ThreadId) },
      {
        modelToDependencies: (model) => ({ threadId: model.thread?.threadId }),
        dependenciesToStream: ({ threadId }) => {
          if (threadId === undefined) return Stream.empty
          return Stream.unwrap(
            ThreadClient.pipe(
              Effect.map((rpc) =>
                rpc.watchSignals(threadId).pipe(
                  Stream.map((signal) =>
                    Message.GotThreadMessage({
                      message: ThreadPanel.Message.SignalArrived({ signal }),
                    }),
                  ),
                ),
              ),
            ),
          )
        },
      },
    ),
  })),
)

export const wiredView = (model: Model, h: HtmlBuilder<Message>) => {
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

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  chatStub(
    model.leftSidebar,
    model.rightSidebar,
    (message) => Message.GotLeftSidebar({ message }),
    (message) => Message.GotRightSidebar({ message }),
    h,
  )
