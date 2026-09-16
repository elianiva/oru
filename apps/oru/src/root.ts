import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Box, Folder, GitBranch, Lock, Mic, Plus } from 'lucide'
import * as Composer from './composer.ts'
import * as Shell from './shell.ts'
import * as ThreadList from './thread-list.ts'
import { fakeThreadSections, threadById } from './threads.ts'

export const Model = Schema.Struct({
  shell: Shell.Model,
  threads: ThreadList.Model,
  selectedThread: Schema.Option(Schema.String),
  composer: Composer.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GotShell: { message: Shell.Message },
  GotThreads: { message: ThreadList.Message },
  GotComposer: { message: Composer.Message },
})
export type Message = typeof Message.Type

export const init = () => ({
  model: {
    shell: Shell.init(),
    threads: ThreadList.init(),
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
  update: ThreadList.update,
  read: (model: Model) => Option.some(model.threads),
  write: (model, nextChild) => evo(model, { threads: () => nextChild }),
  toParentMessage: (message: ThreadList.Message) => Message.GotThreads({ message }),
  foldOutMessage: (outMessage: ThreadList.OutMessage): Update.Step<Model, Message> =>
    ThreadList.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
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

const threadSubs = Subscription.lift(ThreadList.subscriptions)({
  toChildModel: (model: Model) => model.threads,
  toParentMessage: (message: ThreadList.Message): Message => Message.GotThreads({ message }),
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

const threadList = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'thread-list',
    model: model.threads,
    view: ThreadList.view,
    viewInputs: { sections: fakeThreadSections, selected: model.selectedThread },
    toParentMessage: (childMessage) => Message.GotThreads({ message: childMessage }),
  })

const fact = (label: string, value: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex items-baseline justify-between gap-2')],
    [
      h.dt([h.Class('text-2xs text-muted-foreground')], [label]),
      h.dd([h.Class('min-w-0 truncate font-mono text-xs')], [value]),
    ],
  )

const detail = (model: Model, h: HtmlBuilder<Message>): Html => {
  const thread = Option.flatMap(model.selectedThread, (id) =>
    Option.fromNullishOr(threadById(fakeThreadSections, id)),
  )
  return h.div(
    [
      h.DataAttribute('detail', ''),
      h.Class('flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground'),
    ],
    [
      h.div(
        [h.Class('flex h-9 shrink-0 items-center border-b border-border-seam px-3')],
        [h.span([h.Class('truncate text-sm font-medium')], ['Details'])],
      ),
      h.div(
        [h.Class('min-h-0 flex-1 overflow-y-auto px-3 py-2')],
        Option.match(thread, {
          onNone: () => [h.p([h.Class('text-xs text-muted-foreground')], ['No thread selected'])],
          onSome: (row) => [
            h.div([h.Class('mb-2 text-sm font-medium')], [row.title]),
            h.dl(
              [h.Class('flex flex-col gap-1.5')],
              [
                fact('Project', row.project.name, h),
                fact('Location', row.location.name, h),
                fact('Status', ThreadList.statusLabel(row.status) ?? 'Idle', h),
                ...(row.pullRequest === undefined
                  ? []
                  : [fact('Pull request', `#${String(row.pullRequest)}`, h)]),
              ],
            ),
          ],
        }),
      ),
    ],
  )
}

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
      toLeftPanel: () => threadList(model, h),
      toMain: () => main(model, h),
      toRightPanel: () => detail(model, h),
    },
    toParentMessage: (message) => Message.GotShell({ message }),
  })
