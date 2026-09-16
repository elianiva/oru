import { Effect, Option, Schema } from 'effect'
import { Command, Navigation, Url } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Box, Folder, GitBranch, Lock, Mic, Plus } from 'lucide'
import { ProjectClient } from '@oru/rpc'
import * as Composer from './composer.ts'
import * as LeftPanel from './left-panel.ts'
import * as Projects from './projects.ts'
import * as RightPanel from './right-panel.ts'
import * as General from './settings/general.ts'
import * as SettingsLayout from './settings/layout.ts'
import * as SettingsPages from './settings/pages.ts'
import * as Shell from './shell.ts'
import { AppRoute, homeRouter, threadRouter, titleForRoute, urlToAppRoute } from './route.ts'
import { fakeThreadSections, threadById } from './threads.ts'

export const Model = Schema.Struct({
  route: AppRoute,
  shell: Shell.Model,
  threads: LeftPanel.Model,
  projects: Projects.Model,
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
  GotProjects: { message: Projects.Message },
  GotComposer: { message: Composer.Message },
  GotSettings: { message: General.Message },
})
export type Message = typeof Message.Type

/**
 * The selected thread is the route, never a second copy of it: a URL with a
 * thread in it selects that thread, a reload lands on the same one, and going
 * back leaves the conversation.
 */
export const selectedThread = (model: Model): Option.Option<string> =>
  AppRoute.guards.Thread(model.route) ? Option.some(model.route.threadId) : Option.none()

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

/**
 * The app's first call, and the one the host-unreachable state answers to. A
 * transport failure is the state this command reports, so the app renders a
 * host that is down instead of dying on it.
 */
export const ListProjects = Command.define('ListProjects', {
  messages: [Message.GotProjects],
  execute: ProjectClient.pipe(
    Effect.flatMap((client) => client.list()),
    Effect.map((projects) =>
      Message.GotProjects({ message: Projects.Message.ProjectsArrived({ projects }) }),
    ),
    Effect.catch((error) =>
      Effect.succeed(
        Message.GotProjects({
          message: Projects.Message.HostUnreachable({
            reason: `${error.operation}: ${error.reason}`,
          }),
        }),
      ),
    ),
  ),
})

export const init = (url: Url.Url) => ({
  model: {
    route: urlToAppRoute(url),
    shell: Shell.init(),
    threads: LeftPanel.init(),
    projects: Projects.init(),
    composer: Composer.init(),
    settings: General.init(),
  },
  commands: [ListProjects()],
})

type UpdateReturn = Update.Return<Model, Message, ProjectClient>

const foldShell = Update.foldChild({
  update: Shell.update,
  read: (model: Model) => Option.some(model.shell),
  write: (model, nextChild) => evo(model, { shell: () => nextChild }),
  toParentMessage: (message: Shell.Message) => Message.GotShell({ message }),
})

/**
 * Picking a row navigates. The selection lives in the URL, so the left column
 * reports the click and the app moves instead of holding a copy.
 */
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
          model,
          commands: [NavigateInternal({ url: threadRouter({ threadId: id }) })],
        }),
    }),
})

const foldProjects = Update.foldChild({
  update: Projects.update,
  read: (model: Model) => Option.some(model.projects),
  write: (model, nextChild) => evo(model, { projects: () => nextChild }),
  toParentMessage: (message: Projects.Message) => Message.GotProjects({ message }),
  foldOutMessage: (outMessage: Projects.OutMessage): Update.Step<Model, Message, ProjectClient> =>
    Projects.OutMessage.match<Update.Step<Model, Message, ProjectClient>>(outMessage, {
      RequestedRetry: () => (model) => ({
        model: evo(model, { projects: () => Projects.init() }),
        commands: [ListProjects()],
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
    GotProjects: ({ message: childMessage }) => foldProjects(model, childMessage),
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

const heroContributions = (): Composer.ComposerContributions =>
  Composer.mergeContributions(coreContributions(), contextPluginContributions())

/** The conversation's composer keeps the actions and drops the hero's prompt. */
const conversationContributions = (): Composer.ComposerContributions => {
  const { placeholder, leading, trailing, chips } = heroContributions()
  return { placeholder, leading, trailing, chips }
}

const composerSlot = (
  model: Model,
  contributions: Composer.ComposerContributions,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: 'composer',
    model: model.composer,
    view: Composer.view,
    viewInputs: { contributions },
    toParentMessage: (childMessage) => Message.GotComposer({ message: childMessage }),
  })

const projectsSlot = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'projects',
    model: model.projects,
    view: Projects.view,
    toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
  })

const homeMain = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Attribute('data-main', ''),
      h.Class('flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6'),
    ],
    [
      h.div([h.Class('w-full max-w-3xl')], [projectsSlot(model, h)]),
      composerSlot(model, heroContributions(), h),
    ],
  )

/**
 * A thread's conversation. The header names the thread the route selected, and
 * the column between it and the composer holds nothing because nothing about
 * this thread is recorded by the app yet.
 */
const conversationMain = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Attribute('data-conversation', ''), h.Class('flex min-h-0 flex-1 flex-col')],
    [
      h.header(
        [h.Class('flex h-10 shrink-0 items-center px-5')],
        [
          h.span(
            [h.Class('truncate text-sm font-medium')],
            [Option.match(selectedThread(model), { onNone: () => '', onSome: threadName })],
          ),
        ],
      ),
      h.div([h.Class('min-h-0 flex-1')], []),
      h.div(
        [h.Class('flex shrink-0 justify-center px-6 pb-6')],
        [composerSlot(model, conversationContributions(), h)],
      ),
    ],
  )

const threadName = (id: string): string => threadById(fakeThreadSections, id)?.title ?? id

const leftPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'left-panel',
    model: model.threads,
    view: LeftPanel.view,
    viewInputs: { sections: fakeThreadSections, selected: selectedThread(model) },
    toParentMessage: (childMessage) => Message.GotThreads({ message: childMessage }),
  })

const rightPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  RightPanel.view(selectedThread(model), { sections: fakeThreadSections }, h)

const shellView = (model: Model, main: Html, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'shell',
    model: model.shell,
    view: Shell.view,
    viewInputs: {
      toLeftPanel: () => leftPanel(model, h),
      toMain: () => main,
      toRightPanel: () => rightPanel(model, h),
    },
    toParentMessage: (message) => Message.GotShell({ message }),
  })

const homeView = (model: Model, h: HtmlBuilder<Message>): Html =>
  shellView(model, homeMain(model, h), h)

const conversationView = (model: Model, h: HtmlBuilder<Message>): Html =>
  shellView(model, conversationMain(model, h), h)

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
const routeView = (model: Model, h: HtmlBuilder<Message>): Html =>
  AppRoute.match(model.route, {
    Home: () => homeView(model, h),
    Thread: () => conversationView(model, h),
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
  })

/**
 * A host that did not answer replaces the whole shell: no column can show a
 * fact the host never gave, and the retry is the only thing that reaches it.
 */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleForRoute(model.route),
  body: Projects.isUnreachable(model.projects)
    ? h.div(
        [h.Class('flex h-svh items-center justify-center bg-sidebar p-6')],
        [h.div([h.Class('w-full max-w-md')], [projectsSlot(model, h)])],
      )
    : routeView(model, h),
})
