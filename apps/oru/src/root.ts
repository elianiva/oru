import { Option, Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Box, Folder, GitBranch, Lock, MessagesSquare, Mic, Plus, Settings } from 'lucide'
import * as Sidebar from '@/components/ui/sidebar.ts'
import { icon } from '@/lib/icons.ts'
import { chrome, initChromeSidebar } from './chrome.ts'
import * as Composer from './composer.ts'

export const Model = Schema.Struct({
  sidebar: Sidebar.Model,
  composer: Composer.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GotSidebar: { message: Sidebar.Message },
  GotComposer: { message: Composer.Message },
})
export type Message = typeof Message.Type

export const init = () => ({
  model: { sidebar: initChromeSidebar(), composer: Composer.init() },
})

const foldSidebar = Update.foldChild({
  update: Sidebar.update,
  read: (model: Model) => Option.some(model.sidebar),
  write: (model, nextChild) => ({ ...model, sidebar: nextChild }),
  toParentMessage: (message: Sidebar.Message) => Message.GotSidebar({ message }),
})

const foldComposer = Update.foldChild({
  update: Composer.update,
  read: (model: Model) => Option.some(model.composer),
  write: (model, nextChild) => ({ ...model, composer: nextChild }),
  toParentMessage: (message: Composer.Message) => Message.GotComposer({ message }),
  foldOutMessage: (outMessage: Composer.OutMessage): Update.Step<Model, Message> =>
    Composer.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      Submitted: () => (model) => ({ model }),
      RequestedAction: () => (model) => ({ model }),
    }),
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GotSidebar: ({ message: childMessage }) => foldSidebar(model, childMessage),
    GotComposer: ({ message: childMessage }) => foldComposer(model, childMessage),
  })

const sidebarSubs = Subscription.lift(Sidebar.subscriptions)({
  toChildModel: (model: Model) => model.sidebar,
  toParentMessage: (message: Sidebar.Message): Message => Message.GotSidebar({ message }),
})

export const subscriptions = Subscription.aggregate<Model, Message>()({
  cookie: sidebarSubs.cookie,
  keyboard: sidebarSubs.keyboardShortcut,
  media: sidebarSubs.mediaQuery,
})

const nav = <M>(h: HtmlBuilder<M>) => [
  Sidebar.group(
    {},
    [
      Sidebar.groupLabel({}, ['Workspace'], h),
      Sidebar.groupContent(
        {},
        [
          Sidebar.menu(
            {},
            [
              Sidebar.menuItem(
                {},
                [
                  Sidebar.menuButton(
                    { isActive: true, attributes: [h.Attribute('data-nav', 'threads')] },
                    [icon(h, MessagesSquare, 'size-4'), h.span([], ['Threads'])],
                    h,
                  ),
                ],
                h,
              ),
              Sidebar.menuItem(
                {},
                [
                  Sidebar.menuButton(
                    { attributes: [h.Attribute('data-nav', 'projects')] },
                    [icon(h, Folder, 'size-4'), h.span([], ['Projects'])],
                    h,
                  ),
                ],
                h,
              ),
              Sidebar.menuItem(
                {},
                [
                  Sidebar.menuButton(
                    { attributes: [h.Attribute('data-nav', 'settings')] },
                    [icon(h, Settings, 'size-4'), h.span([], ['Settings'])],
                    h,
                  ),
                ],
                h,
              ),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
    h,
  ),
]

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

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  chrome(
    {
      sidebar: model.sidebar,
      toSidebar: (message) => Message.GotSidebar({ message }),
      title: 'oru',
      sidebarContent: nav(h),
      main: main(model, h),
    },
    h,
  )
