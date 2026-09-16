import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Box, Folder, GitBranch, Lock, Mic, Plus } from 'lucide'
import * as Composer from './composer.ts'
import * as LeftPanel from './left-panel.ts'
import * as RightPanel from './right-panel.ts'
import * as Shell from './shell.ts'
import { fakeThreadSections } from './threads.ts'

export const Model = Schema.Struct({
  shell: Shell.Model,
  threads: LeftPanel.Model,
  selectedThread: Schema.Option(Schema.String),
  composer: Composer.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GotShell: { message: Shell.Message },
  GotThreads: { message: LeftPanel.Message },
  GotComposer: { message: Composer.Message },
})
export type Message = typeof Message.Type

export const init = () => ({
  model: {
    shell: Shell.init(),
    threads: LeftPanel.init(),
    selectedThread: Option.none<string>(),
    composer: Composer.init(),
  },
})

const foldShell = Update.foldChild({
  update: Shell.update,
  read: (model: Model) => Option.some(model.shell),
  write: (model, nextChild) => evo(model, { shell: () => nextChild }),
  toParentMessage: (message: Shell.Message) => Message.GotShell({ message }),
})

const foldThreads = Update.foldChild({
  update: LeftPanel.update,
  read: (model: Model) => Option.some(model.threads),
  write: (model, nextChild) => evo(model, { threads: () => nextChild }),
  toParentMessage: (message: LeftPanel.Message) => Message.GotThreads({ message }),
  foldOutMessage: (outMessage: LeftPanel.OutMessage): Update.Step<Model, Message> =>
    LeftPanel.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      Selected:
        ({ id }) =>
        (model) => ({
          model: evo(model, { selectedThread: () => Option.some(id) }),
        }),
    }),
})

const foldComposer = Update.foldChild({
  update: Composer.update,
  read: (model: Model) => Option.some(model.composer),
  write: (model, nextChild) => evo(model, { composer: () => nextChild }),
  toParentMessage: (message: Composer.Message) => Message.GotComposer({ message }),
  foldOutMessage: (outMessage: Composer.OutMessage): Update.Step<Model, Message> =>
    Composer.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      Submitted: () => (model) => ({ model }),
      RequestedAction: () => (model) => ({ model }),
    }),
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GotShell: ({ message: childMessage }) => foldShell(model, childMessage),
    GotThreads: ({ message: childMessage }) => foldThreads(model, childMessage),
    GotComposer: ({ message: childMessage }) => foldComposer(model, childMessage),
  })

const shellSubs = Subscription.lift(Shell.subscriptions)({
  toChildModel: (model: Model) => model.shell,
  toParentMessage: (message: Shell.Message): Message => Message.GotShell({ message }),
})

const threadSubs = Subscription.lift(LeftPanel.subscriptions)({
  toChildModel: (model: Model) => model.threads,
  toParentMessage: (message: LeftPanel.Message): Message => Message.GotThreads({ message }),
})

export const subscriptions = Subscription.aggregate<Model, Message>()(shellSubs, threadSubs)

const main = (model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [
      h.Attribute('data-main', ''),
      h.Class('flex min-h-0 flex-1 flex-col items-center justify-center p-6'),
    ],
    [
      h.submodel({
        slotId: 'composer',
        model: model.composer,
        view: Composer.view,
        viewInputs: { contributions: composerContributions() },
        toParentMessage: (childMessage) => Message.GotComposer({ message: childMessage }),
      }),
    ],
  )

const leftPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'left-panel',
    model: model.threads,
    view: LeftPanel.view,
    viewInputs: { sections: fakeThreadSections, selected: model.selectedThread },
    toParentMessage: (childMessage) => Message.GotThreads({ message: childMessage }),
  })

const rightPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  RightPanel.view(model.selectedThread, { sections: fakeThreadSections }, h)

const coreContributions = (): Composer.ComposerContributions => ({
  placeholder: 'Ask anything. @ to mention files, folders, or sections',
  headline: 'What should we build in oru?',
  leading: [
    { id: 'add', icon: Plus },
    { id: 'model', label: 'Medium', chevron: true },
  ],
  trailing: [{ id: 'mic', icon: Mic }],
  chips: [],
})

const contextPluginContributions = (): Composer.ComposerContributions => ({
  ...Composer.emptyContributions(''),
  chips: [
    { id: 'repo', label: 'oru', icon: Folder },
    { id: 'worktree', label: 'Worktree', icon: Box },
    { id: 'branch', label: 'Branch from: origin/master', icon: GitBranch },
    { id: 'access', label: 'Full Access', icon: Lock, align: 'right' },
  ],
})

const composerContributions = (): Composer.ComposerContributions =>
  Composer.mergeContributions(coreContributions(), contextPluginContributions())

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.submodel({
    slotId: 'shell',
    model: model.shell,
    view: Shell.view,
    viewInputs: {
      toLeftPanel: () => leftPanel(model, h),
      toMain: () => main(model, h),
      toRightPanel: () => rightPanel(model, h),
    },
    toParentMessage: (message) => Message.GotShell({ message }),
  })
