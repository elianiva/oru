import { Effect, Option, Schema } from 'effect'
import { Command, Navigation, Url } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Box, Folder, GitBranch, Lock, Mic, Plus } from 'lucide'
import * as Composer from './composer.ts'
import * as LeftPanel from './left-panel.ts'
import * as RightPanel from './right-panel.ts'
import * as General from './settings/general.ts'
import * as SettingsLayout from './settings/layout.ts'
import * as SettingsPages from './settings/pages.ts'
import * as Shell from './shell.ts'
import { AppRoute, homeRouter, titleForRoute, urlToAppRoute } from './route.ts'
import { fakeThreadSections } from './threads.ts'

export const Model = Schema.Struct({
  route: AppRoute,
  shell: Shell.Model,
  threads: LeftPanel.Model,
  selectedThread: Schema.Option(Schema.String),
  composer: Composer.Model,
  settings: General.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  ClickedLink: { request: Navigation.UrlRequest },
  ChangedUrl: { url: Url.Url },
  GotShell: { message: Shell.Message },
  GotThreads: { message: LeftPanel.Message },
  GotComposer: { message: Composer.Message },
  GotSettings: { message: General.Message },
})
export type Message = typeof Message.Type

export const init = (url: Url.Url) => ({
  model: {
    route: urlToAppRoute(url),
    shell: Shell.init(),
    threads: LeftPanel.init(),
    selectedThread: Option.none<string>(),
    composer: Composer.init(),
    settings: General.init(),
  },
})

const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    Navigation.pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) => Navigation.load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

type UpdateReturn = Update.Return<Model, Message>

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

const foldSettings = Update.foldChild({
  update: General.update,
  read: (model: Model) => Option.some(model.settings),
  write: (model, nextChild) => evo(model, { settings: () => nextChild }),
  toParentMessage: (message: General.Message) => Message.GotSettings({ message }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    ClickedLink: ({ request }) =>
      Navigation.UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: Url.toString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),
    ChangedUrl: ({ url }) => ({
      model: evo(model, { route: () => urlToAppRoute(url) }),
    }),
    GotShell: ({ message: childMessage }) => foldShell(model, childMessage),
    GotThreads: ({ message: childMessage }) => foldThreads(model, childMessage),
    GotComposer: ({ message: childMessage }) => foldComposer(model, childMessage),
    GotSettings: ({ message: childMessage }) => foldSettings(model, childMessage),
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

const homeMain = (model: Model, h: HtmlBuilder<Message>) =>
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

const homeView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'shell',
    model: model.shell,
    view: Shell.view,
    viewInputs: {
      toLeftPanel: () => leftPanel(model, h),
      toMain: () => homeMain(model, h),
      toRightPanel: () => rightPanel(model, h),
    },
    toParentMessage: (message) => Message.GotShell({ message }),
  })

const settingsView = (
  model: Model,
  toContent: (h: HtmlBuilder<Message>) => Html,
  h: HtmlBuilder<Message>,
): Html => SettingsLayout.view(model.route, toContent(h), h)

const generalView = (model: Model, h: HtmlBuilder<Message>): Html =>
  settingsView(
    model,
    (contentH) =>
      contentH.submodel({
        slotId: 'settings-general',
        model: model.settings,
        view: General.view,
        toParentMessage: (childMessage) => Message.GotSettings({ message: childMessage }),
      }),
    h,
  )

const notFoundView = (path: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6')],
    [
      h.p([h.Class('text-lg font-medium')], ['Nothing here']),
      h.p([h.Class('text-sm text-muted-foreground')], [`No page matches "${path}".`]),
      h.a([h.Href(homeRouter()), h.Class('text-sm text-primary hover:underline')], ['Back to app']),
    ],
  )

/**
 * Every route arm delegates to its own view function, so navigating between
 * pages tears down the old page instead of patching it. Settings arms share
 * the shell but keep per-page content functions.
 */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleForRoute(model.route),
  body: AppRoute.match(model.route, {
    Home: () => homeView(model, h),
    SettingsGeneral: () => generalView(model, h),
    SettingsProviders: () =>
      settingsView(model, (contentH) => SettingsPages.providersView(contentH), h),
    SettingsAppearance: () =>
      settingsView(model, (contentH) => SettingsPages.appearanceView(contentH), h),
    SettingsKeyboard: () =>
      settingsView(model, (contentH) => SettingsPages.keyboardView(contentH), h),
    SettingsBrowser: () =>
      settingsView(model, (contentH) => SettingsPages.browserView(contentH), h),
    SettingsUsageLimits: () =>
      settingsView(model, (contentH) => SettingsPages.usageLimitsView(contentH), h),
    SettingsFiles: () => settingsView(model, (contentH) => SettingsPages.filesView(contentH), h),
    SettingsProjects: () =>
      settingsView(model, (contentH) => SettingsPages.projectsView(contentH), h),
    SettingsMachines: () =>
      settingsView(model, (contentH) => SettingsPages.machinesView(contentH), h),
    SettingsUpdates: () =>
      settingsView(model, (contentH) => SettingsPages.updatesView(contentH), h),
    SettingsInstalledPlugins: () =>
      settingsView(model, (contentH) => SettingsPages.installedPluginsView(contentH), h),
    SettingsPluginMarketplaces: () =>
      settingsView(model, (contentH) => SettingsPages.pluginMarketplacesView(contentH), h),
    SettingsExperiments: () =>
      settingsView(model, (contentH) => SettingsPages.experimentsView(contentH), h),
    SettingsCommunity: () =>
      settingsView(model, (contentH) => SettingsPages.communityView(contentH), h),
    NotFound: ({ path }) => notFoundView(path, h),
  }),
})
