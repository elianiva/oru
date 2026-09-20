import { Effect, Match, Option, Predicate, Schema, Stream } from 'effect'
import { Command, Navigation, Url } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import type { View as SubmodelView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { ProjectClient, ThreadClient, UiClient, type HostUnreachable } from '@oru/rpc'
import {
  ComposerOptions,
  ComposerOptionsLoaded,
  ComposerOptionsLoading,
  ComposerOptionsUnreachable,
  ThreadOptions,
  UI_SDK_MAJOR,
  UiSnapshot,
  decodeUiDefRecord,
  decodeUiOutMessage,
  type ComposerProps,
  type ConversationProps,
  type UiSignal,
} from '@oru/ui'
import { PluginId, isPersonalProjectId } from '@oru/kernel'
import * as LeftPanel from './left-panel.ts'
import * as Projects from './projects.ts'
import * as RightPanel from './right-panel.ts'
import { getDef, registerDef } from './ui-defs.ts'
import * as General from './settings/general.ts'
import * as SettingsLayout from './settings/layout.ts'
import * as SettingsPages from './settings/pages.ts'
import * as Shell from './shell.ts'
import {
  AppRoute,
  homeRouter,
  settingsProjectsRouter,
  threadRouter,
  titleForRoute,
  urlToAppRoute,
} from './route.ts'
import { emptyThreadSections } from './threads.ts'

export const Submit = Schema.Struct({
  pending: Schema.Boolean,
  error: Schema.UndefinedOr(Schema.String),
})
export type Submit = typeof Submit.Type

export const OutletEmpty = Schema.TaggedStruct('Empty', {})
export const OutletLoading = Schema.TaggedStruct('Loading', {
  plugin: PluginId,
  defId: Schema.String,
  slot: Schema.String,
  jsUrl: Schema.String,
  address: Schema.String,
})
export const OutletReady = Schema.TaggedStruct('Ready', {
  plugin: PluginId,
  defId: Schema.String,
  slot: Schema.String,
  address: Schema.String,
  childModel: Schema.Any,
})
export const OutletFailed = Schema.TaggedStruct('Failed', {
  plugin: PluginId,
  defId: Schema.String,
  slot: Schema.String,
  reason: Schema.String,
})
export const OutletState = Schema.Union([OutletEmpty, OutletLoading, OutletReady, OutletFailed])
export type OutletState = typeof OutletState.Type

export const Model = Schema.Struct({
  route: AppRoute,
  shell: Shell.Model,
  threads: LeftPanel.Model,
  projects: Projects.Model,
  composerUi: OutletState,
  conversationUi: OutletState,
  options: ComposerOptions,
  settings: General.Model,
  submit: Submit,
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
  GotComposerUi: { message: Schema.Any },
  GotConversationUi: { message: Schema.Any },
  HostOptionsArrived: { options: ThreadOptions },
  HostOptionsFailed: { reason: Schema.String },
  UiSnapshotArrived: { snapshot: UiSnapshot },
  BundleReady: {
    plugin: PluginId,
    defId: Schema.String,
    slot: Schema.String,
    address: Schema.String,
  },
  BundleFailed: {
    plugin: PluginId,
    defId: Schema.String,
    slot: Schema.String,
    reason: Schema.String,
  },
  GotSettings: { message: General.Message },
  CopyCompleted: {},
  PrefsPersisted: {},
  ThreadCreated: { threadId: Schema.String },
  ThreadCreateFailed: { reason: Schema.String, text: Schema.String },
  ThreadMessageSent: {},
  ThreadMessageFailed: { reason: Schema.String, text: Schema.String },
  DismissedSubmitError: {},
})
export type Message = typeof Message.Type

/**
 * The selected thread is the route, never a second copy of it: a URL with a
 * thread in it selects that thread, a reload lands on the same one, and going
 * back leaves the conversation.
 */
export const selectedThread = (model: Model): Option.Option<string> =>
  AppRoute.guards.Thread(model.route) ? Option.some(model.route.threadId) : Option.none()

export const NavigateInternal = Command.define('NavigateInternal', {
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
 * The host's own words for "I did not answer", formatted in one place.
 */
const didNotAnswer = (error: HostUnreachable) =>
  Message.GotProjects({
    message: Projects.Message.HostUnreachable({
      reason: `${error.operation}: ${error.reason}`,
    }),
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
    Effect.catch((error) => Effect.succeed(didNotAnswer(error))),
  ),
})

export const GetProjectDetail = Command.define('GetProjectDetail', {
  args: { project: Schema.NonEmptyString },
  messages: [Message.GotProjects],
  execute: ({ project }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) => client.detail(project)),
      Effect.map((detail) =>
        Message.GotProjects({ message: Projects.Message.DetailArrived({ detail }) }),
      ),
      Effect.catchTags({
        UnknownProject: () =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.DetailFailed({
                project,
                reason: `This host has no project "${project}".`,
              }),
            }),
          ),
        HostUnreachable: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.DetailFailed({
                project,
                reason: `${error.operation}: ${error.reason}`,
              }),
            }),
          ),
      }),
    ),
})

/**
 * A hover preload warms the dialog cache. Success joins the cache silently;
 * failure stays silent too, and the click that follows fetches loudly.
 */
export const PreloadDirectory = Command.define('PreloadDirectory', {
  args: { path: Schema.NonEmptyString },
  messages: [Message.GotProjects],
  execute: ({ path }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) => client.listDirectory(path)),
      Effect.map((listing) =>
        Message.GotProjects({ message: Projects.Message.DirectoryCached({ listing }) }),
      ),
      Effect.catch(() =>
        Effect.succeed(
          Message.GotProjects({
            message: Projects.Message.DirectoryCacheFailed({ path }),
          }),
        ),
      ),
    ),
})

/**
 * Creating a project is the host recording a fact, so the created row is what
 * reaches the screen — never the draft that asked for it.
 */
export const CreateProject = Command.define('CreateProject', {
  args: {
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    icon: Schema.optional(Schema.String),
  },
  messages: [Message.GotProjects],
  execute: ({ name, cwd, icon }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) =>
        icon === undefined ? client.create(name, cwd) : client.create(name, cwd, icon),
      ),
      Effect.map((created) =>
        Message.GotProjects({ message: Projects.Message.ProjectCreated({ project: created }) }),
      ),
      Effect.catchTags({
        // The shared dialog hears the refusal: the host's words render
        // where the write was attempted.
        RelativeCwd: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.CreateRefused({
                refusal: Projects.RelativeCwd.make({ cwd: error.cwd }),
              }),
            }),
          ),
        HostUnreachable: (error) => Effect.succeed(didNotAnswer(error)),
      }),
    ),
})

export const UpdateProject = Command.define('UpdateProject', {
  args: {
    project: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    icon: Schema.optional(Schema.String),
  },
  messages: [Message.GotProjects],
  execute: ({ project, name, cwd, icon }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) =>
        icon === undefined
          ? client.update(project, { name, cwd })
          : client.update(project, { name, cwd, icon }),
      ),
      Effect.map((updated) =>
        Message.GotProjects({ message: Projects.Message.ProjectUpdated({ project: updated }) }),
      ),
      Effect.catchTags({
        RelativeCwd: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.UpdateRefused({
                refusal: Projects.RelativeCwd.make({ cwd: error.cwd }),
              }),
            }),
          ),
        UnknownProject: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.UpdateRefused({
                refusal: Projects.UnknownProject.make({ project: error.project }),
              }),
            }),
          ),
        HostUnreachable: (error) => Effect.succeed(didNotAnswer(error)),
      }),
    ),
})

export const DeleteProject = Command.define('DeleteProject', {
  args: { project: Schema.NonEmptyString },
  messages: [Message.GotProjects],
  execute: ({ project }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) => client.remove(project)),
      Effect.map((removed) =>
        Message.GotProjects({
          message: Projects.Message.ProjectDeleted({ project: removed.project }),
        }),
      ),
      Effect.catchTags({
        UnknownProject: () =>
          Effect.succeed(Message.GotProjects({ message: Projects.Message.DeleteRefused() })),
        HostUnreachable: (error) => Effect.succeed(didNotAnswer(error)),
      }),
    ),
})

/**
 * A directory listing for whoever is browsing: the composer's picker or the
 * settings create form. The answer fans out to both, and each keeps it only
 * while its own browser is open.
 */
export const ListDirectory = Command.define('ListDirectory', {
  args: { path: Schema.optional(Schema.String) },
  messages: [Message.GotProjects],
  execute: ({ path }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) =>
        path === undefined ? client.listDirectory() : client.listDirectory(path),
      ),
      Effect.map((listing) =>
        Message.GotProjects({ message: Projects.Message.DirectoryArrived({ listing }) }),
      ),
      Effect.catchTags({
        DirectoryMissing: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.DirectoryFailed({
                error: Projects.DirectoryMissing.make({ path: error.path }),
              }),
            }),
          ),
        NotDirectory: (error) =>
          Effect.succeed(
            Message.GotProjects({
              message: Projects.Message.DirectoryFailed({
                error: Projects.NotDirectory.make({ path: error.path }),
              }),
            }),
          ),
        HostUnreachable: (error) => Effect.succeed(didNotAnswer(error)),
      }),
    ),
})

/**
 * A thread's options are the picker's to hold: it is the only model that
 * renders them, so it is the only one that asks for them.
 */
export const LoadThreadOptions = Command.define('LoadThreadOptions', {
  args: { threadId: Schema.UndefinedOr(Schema.String), refresh: Schema.Boolean },
  messages: [Message.HostOptionsArrived, Message.HostOptionsFailed],
  execute: ({ threadId, refresh }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.options(threadId, refresh ? { refresh: true } : undefined)),
      Effect.map((options) => Message.HostOptionsArrived({ options })),
      Effect.catch((error) =>
        Effect.succeed(
          Message.HostOptionsFailed({
            reason: `${error.operation}: ${error.reason}`,
          }),
        ),
      ),
    ),
})

export const ConfigureThread = Command.define('ConfigureThread', {
  args: {
    threadId: Schema.NonEmptyString,
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  },
  messages: [Message.HostOptionsArrived, Message.HostOptionsFailed],
  execute: ({ threadId, harness, model, reasoning }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.configure(threadId, { harness, model, reasoning })),
      Effect.map((options) => Message.HostOptionsArrived({ options })),
      Effect.catch((error) =>
        Effect.succeed(
          Message.HostOptionsFailed({
            reason: `${error.operation}: ${error.reason}`,
          }),
        ),
      ),
    ),
})

/**
 * The picker's stored preferences, written the way the picker wrote them
 * before extraction: one versioned JSON document, decoded through a
 * schema, never overwriting a newer writer, never breaking on denied
 * storage. Duplicated from chat-ui's reader side; a future ui-kit
 * extraction unifies them.
 */
const PICKER_STORAGE_KEY = 'oru.model-picker'
const PICKER_STORAGE_VERSION = 1

/** A newer writer's document reads only as a version, never as preferences. */
const StorageProbe = Schema.Struct({ version: Schema.Number })
const decodeStorageProbe = Schema.decodeUnknownOption(Schema.fromJsonString(StorageProbe))

export const PersistPrefs = Command.define('PersistPrefs', {
  args: {
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  },
  messages: [Message.PrefsPersisted],
  execute: ({ model, reasoning }) =>
    Effect.sync(() => {
      if (typeof localStorage === 'undefined') return Message.PrefsPersisted()
      const raw = localStorage.getItem(PICKER_STORAGE_KEY)
      const probed = raw === null ? Option.none() : decodeStorageProbe(raw)
      // A document from a newer writer keeps its shape; overwriting it
      // would drop preferences this version does not know. An unparseable
      // document is replaced with a fresh one, the way the picker always did.
      if (Option.isSome(probed) && probed.value.version > PICKER_STORAGE_VERSION) {
        return Message.PrefsPersisted()
      }
      localStorage.setItem(
        PICKER_STORAGE_KEY,
        JSON.stringify({ version: PICKER_STORAGE_VERSION, model, reasoning }),
      )
      return Message.PrefsPersisted()
    }).pipe(Effect.catchDefect(() => Effect.succeed(Message.PrefsPersisted()))),
})

const BundleModuleSchema = Schema.Struct({ defs: Schema.optional(Schema.Unknown) })
const decodeBundleModule = Schema.decodeUnknownOption(BundleModuleSchema)

/**
 * Import one assigned bundle and register its defs. The snapshot names
 * the plugin, definition, and slot; the module's record is decoded by
 * schema, so a mismatch is a failed outlet, never a broken app.
 */
export const LoadBundle = Command.define('LoadBundle', {
  args: {
    plugin: PluginId,
    defId: Schema.String,
    slot: Schema.String,
    jsUrl: Schema.String,
    address: Schema.String,
    sdkMajor: Schema.Number,
  },
  messages: [Message.BundleReady, Message.BundleFailed],
  execute: ({ plugin, defId, slot, jsUrl, address, sdkMajor }) =>
    Effect.gen(function* () {
      const fail = (reason: string) => Message.BundleFailed({ plugin, defId, slot, reason })
      if (sdkMajor !== UI_SDK_MAJOR) {
        return fail(
          `bundle for ${plugin}/${defId} targets UI SDK ${sdkMajor}, this app speaks ${UI_SDK_MAJOR}`,
        )
      }
      const loaded: unknown = yield* Effect.promise(() => import(/* @vite-ignore */ jsUrl)).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const decodedModule = decodeBundleModule(loaded)
      const defs = Option.isSome(decodedModule) ? decodedModule.value.defs : undefined
      if (defs === undefined || !Array.isArray(defs)) {
        return fail(`bundle for ${plugin}/${defId} exports no defs array`)
      }
      const records = defs.flatMap((def) => {
        const decoded = decodeUiDefRecord(def)
        return Option.isSome(decoded) ? [decoded.value] : []
      })
      const match = records.find((record) => record.slot === slot && record.defId === defId)
      if (match === undefined) {
        return fail(`bundle for ${plugin}/${defId} carries no usable ${slot} definition`)
      }
      const record = match
      registerDef(plugin, defId, address, {
        init: record.init,
        update: record.update,
        view: record.view,
        absorb: record.absorb,
        signal: record.signal,
      })
      return Message.BundleReady({ plugin, defId, slot, address })
    }),
})

/**
 * ThreadCreated means the draft is sent: the update handler navigates on it
 * with no second command. Provisioning stays on the host, which opens the
 * thread on creation.
 */
export const CreateThreadAndSend = Command.define('CreateThreadAndSend', {
  args: {
    project: Schema.NonEmptyString,
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
    text: Schema.NonEmptyString,
  },
  messages: [Message.ThreadCreated, Message.ThreadCreateFailed],
  execute: ({ project, harness, model, reasoning, text }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) =>
        Effect.gen(function* () {
          const created = yield* client.create(project, { harness, model, reasoning })
          yield* client.send(created.threadId, text)
          return Message.ThreadCreated({ threadId: created.threadId })
        }),
      ),
      Effect.catchTags({
        UnknownProject: (error) =>
          Effect.succeed(
            Message.ThreadCreateFailed({
              reason: `This host has no project "${error.project}".`,
              text,
            }),
          ),
        HostUnreachable: (error) =>
          Effect.succeed(
            Message.ThreadCreateFailed({
              reason: `${error.operation}: ${error.reason}`,
              text,
            }),
          ),
      }),
    ),
})

export const SendThreadMessage = Command.define('SendThreadMessage', {
  args: { threadId: Schema.NonEmptyString, text: Schema.NonEmptyString },
  messages: [Message.ThreadMessageSent, Message.ThreadMessageFailed],
  execute: ({ threadId, text }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.send(threadId, text)),
      Effect.map(() => Message.ThreadMessageSent()),
      Effect.catch((error) =>
        Effect.succeed(
          Message.ThreadMessageFailed({
            reason: `${error.operation}: ${error.reason}`,
            text,
          }),
        ),
      ),
    ),
})

export const CopyText = Command.define('CopyText', {
  args: { text: Schema.String },
  messages: [Message.CopyCompleted],
  execute: ({ text }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => undefined,
    }).pipe(
      Effect.as(Message.CopyCompleted()),
      Effect.catch(() => Effect.succeed(Message.CopyCompleted())),
    ),
})

/**
 * Threads in the URL ask the host about themselves; home asks about a thread
 * that does not exist yet, which is the host's defaults. A settings page asks
 * nothing, because no picker is rendered there.
 */
const pickerLoad = (route: AppRoute): Update.Commands<Message, ThreadClient> =>
  Match.value(route).pipe(
    Match.when(AppRoute.guards.Home, () => [
      LoadThreadOptions({ threadId: undefined, refresh: false }),
    ]),
    Match.when(AppRoute.guards.Thread, ({ threadId }) => [
      LoadThreadOptions({ threadId, refresh: false }),
    ]),
    Match.orElse((): Update.Commands<Message, ThreadClient> => []),
  )

/**
 * A project detail page asks the host about that project. The route owns the
 * selection, so a cold load and a back/forward navigation both fetch it.
 */
const detailLoad = (route: AppRoute): Update.Commands<Message, ProjectClient> =>
  AppRoute.match(route, {
    Home: () => [],
    Thread: () => [],
    SettingsGeneral: () => [],
    SettingsProviders: () => [],
    SettingsAppearance: () => [],
    SettingsKeyboard: () => [],
    SettingsBrowser: () => [],
    SettingsUsageLimits: () => [],
    SettingsFiles: () => [],
    SettingsProjects: () => [],
    SettingsProjectDetail: ({ projectId }) => [GetProjectDetail({ project: projectId })],
    SettingsMachines: () => [],
    SettingsUpdates: () => [],
    SettingsInstalledPlugins: () => [],
    SettingsPluginMarketplaces: () => [],
    SettingsExperiments: () => [],
    SettingsCommunity: () => [],
    NotFound: () => [],
  })

export const init = (url: Url.Url) => {
  const route = urlToAppRoute(url)
  const projects = AppRoute.guards.SettingsProjectDetail(route)
    ? Projects.update(Projects.init(), Projects.Message.OpenedDetail({ project: route.projectId }))
        .model
    : Projects.init()
  return {
    model: {
      route,
      shell: Shell.init(),
      threads: LeftPanel.init(),
      projects,
      composerUi: OutletEmpty.make({}),
      conversationUi: OutletEmpty.make({}),
      options: ComposerOptionsLoading.make({}),
      settings: General.init(),
      submit: Submit.make({ pending: false, error: undefined }),
    },
    commands: [ListProjects(), ...pickerLoad(route), ...detailLoad(route)],
  }
}

type UpdateReturn = Update.Return<Model, Message, ProjectClient | ThreadClient>

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
  foldOutMessage: (outMessage: LeftPanel.OutMessage): Update.Step<Model, Message, ProjectClient> =>
    LeftPanel.OutMessage.match<Update.Step<Model, Message, ProjectClient>>(outMessage, {
      Selected:
        ({ id }) =>
        (model) => ({
          model,
          commands: [NavigateInternal({ url: threadRouter({ threadId: id }) })],
        }),
      // The filter opens the same create dialog as every other entry point;
      // nothing redirects to the projects page.
      RequestedNewProject: () => (model) =>
        Update.combine(model, [(next) => foldProjects(next, Projects.Message.ClickedCreate())]),
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
        // Only the host member goes back to `Loading`. A draft the user typed is
        // not the answer that failed, so it survives the retry.
        model: evo(model, { projects: (projects) => Projects.retrying(projects) }),
        commands: [ListProjects()],
      }),
      RequestedUpdate:
        ({ project, name, cwd, icon }) =>
        (model) => {
          const args = icon === undefined ? { project, name, cwd } : { project, name, cwd, icon }
          return { model, commands: [UpdateProject(args)] }
        },
      RequestedCreate:
        ({ name, cwd, icon }) =>
        (model) => {
          const args = icon === undefined ? { name, cwd } : { name, cwd, icon }
          return { model, commands: [CreateProject(args)] }
        },
      RequestedDelete:
        ({ project }) =>
        (model) => ({ model, commands: [DeleteProject({ project })] }),
      RequestedDirectory:
        ({ path }) =>
        (model) => ({ model, commands: [ListDirectory({ path })] }),
      RequestedPreload:
        ({ path }) =>
        (model) => ({ model, commands: [PreloadDirectory({ path })] }),
      RequestedDetail:
        ({ project }) =>
        (model) => ({ model, commands: [GetProjectDetail({ project })] }),
    }),
})

/**
 * The composer's project picker. Its New row opens the shared create dialog;
 * the created project arrives through `GotProjects` and selects itself.
 */
/** The composer's props, derived from root state on every absorb. */
const composerPropsOf = (model: Model): ComposerProps => {
  const placeholder = 'Ask anything. @ to mention files, folders, or sections'
  const projects = [...Projects.projectsOf(model.projects)]
  const projectsLoading = Projects.isLoading(model.projects)
  const options = model.options
  const threadId = Option.getOrUndefined(selectedThread(model))
  if (threadId === undefined) {
    return {
      placeholder,
      projects,
      projectsLoading,
      options,
      headline: 'What should we build in oru?',
    }
  }
  return { placeholder, projects, projectsLoading, options, threadId }
}

const readyComposer = (
  model: Model,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: the child model is the def's own state, stored and forwarded without parsing; absorb and update consume only what they built
  childModel: unknown,
): Model => {
  const outlet = model.composerUi
  if (!Predicate.isTagged(outlet, 'Ready')) return model
  return evo(model, {
    composerUi: () =>
      OutletReady.make({
        plugin: outlet.plugin,
        defId: outlet.defId,
        slot: outlet.slot,
        address: outlet.address,
        childModel,
      }),
  })
}

/** Fold absorbed props into the composer def, if it absorbs them. */
const syncComposer = (model: Model): Model => {
  const outlet = model.composerUi
  if (!Predicate.isTagged(outlet, 'Ready')) return model
  const absorb = getDef(outlet.plugin, outlet.defId, outlet.address)?.absorb
  if (absorb === undefined) return model
  const childModel = absorb(outlet.childModel, composerPropsOf(model))
  if (childModel === outlet.childModel) return model
  return readyComposer(model, childModel)
}

/** Deliver a one-shot signal into the composer def, if it takes signals. */
const signalComposer = (model: Model, signal: UiSignal): Model => {
  const outlet = model.composerUi
  if (!Predicate.isTagged(outlet, 'Ready')) return model
  const send = getDef(outlet.plugin, outlet.defId, outlet.address)?.signal
  if (send === undefined) return model
  return readyComposer(model, send(outlet.childModel, signal))
}

const submitting = (model: Model): Model =>
  evo(model, { submit: () => ({ pending: true, error: undefined }) })

const submitFailed = (model: Model, reason: string, text: string): Model =>
  evo(signalComposer(submitting(model), { type: 'restore-draft', text }), {
    submit: () => ({ pending: false, error: reason }),
  })

/**
 * The intent chat-ui owns, executed here. The picks travel with the text;
 * the project id resolves against the host list the way the picker's
 * fallback did (picked-while-listed, otherwise the host's first). A pick of
 * Personal resolves even when the list has not arrived yet: the host seeds
 * it, so the submit trusts the id instead of failing on no project.
 */
const submitIntent = (
  model: Model,
  intent: {
    readonly project?: string | undefined
    readonly harness?: string | undefined
    readonly model?: string | undefined
    readonly reasoning?: string | undefined
    readonly text: string
  },
): UpdateReturn => {
  if (model.submit.pending) {
    return { model: signalComposer(model, { type: 'restore-draft', text: intent.text }) }
  }
  const threadId = Option.getOrUndefined(selectedThread(model))
  if (threadId !== undefined) {
    return {
      model: submitting(model),
      commands: [SendThreadMessage({ threadId, text: intent.text })],
    }
  }
  const projects = Projects.projectsOf(model.projects)
  const picked =
    (intent.project !== undefined
      ? projects.find((entry) => entry.id === intent.project)
      : undefined) ?? projects[0]
  const projectId =
    picked?.id ??
    (intent.project !== undefined && isPersonalProjectId(intent.project)
      ? intent.project
      : undefined)
  if (projectId === undefined) {
    return { model: submitFailed(model, 'Select a project first.', intent.text) }
  }
  return {
    model: submitting(model),
    commands: [
      CreateThreadAndSend({
        project: projectId,
        harness: intent.harness,
        model: intent.model,
        reasoning: intent.reasoning,
        text: intent.text,
      }),
    ],
  }
}

/**
 * Route a def's out-message to the command it announces. The message is
 * decoded, never cast: an unknown tag fails closed to an ignored no-op,
 * so a def newer than the app cannot crash the outlet.
 */
const foldAreaOutMessage = (
  model: Model,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: decoded by UiOutMessage below; the annotation names the untrusted input, the schema names the contract
  outMessage: unknown,
): UpdateReturn => {
  const decoded = decodeUiOutMessage(outMessage)
  if (Option.isNone(decoded)) return { model }
  switch (decoded.value._tag) {
    case 'Submitted': {
      const submitted = decoded.value
      return submitIntent(model, {
        project: submitted.project,
        harness: submitted.harness,
        model: submitted.model,
        reasoning: submitted.reasoning,
        text: submitted.text,
      })
    }
    case 'OptionsRequested': {
      return {
        model,
        commands: [
          LoadThreadOptions({
            threadId: Option.getOrUndefined(selectedThread(model)),
            refresh: decoded.value.refresh,
          }),
        ],
      }
    }
    case 'ConfigureRequested': {
      const configured = decoded.value
      // The pick persists whatever the thread does: a picker on home has
      // no thread to configure yet, and its choice still survives reload.
      const persist = PersistPrefs({ model: configured.model, reasoning: configured.reasoning })
      return Option.match(selectedThread(model), {
        onNone: () => ({ model, commands: [persist] }),
        onSome: (threadId) => ({
          model,
          commands: [
            persist,
            ConfigureThread({
              threadId,
              harness: configured.harness,
              model: configured.model,
              reasoning: configured.reasoning,
            }),
          ],
        }),
      })
    }
    case 'CopyRequested': {
      return { model, commands: [CopyText({ text: decoded.value.command })] }
    }
    case 'RequestedCreateDialog':
      return Update.combine(model, [(next) => foldProjects(next, Projects.Message.ClickedCreate())])
  }
}

const foldComposerUi = (
  model: Model,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: child messages are the def's own dispatches, forwarded into its update untouched
  childMessage: unknown,
): UpdateReturn => {
  const outlet = model.composerUi
  if (!Predicate.isTagged(outlet, 'Ready')) return { model }
  const def = getDef(outlet.plugin, outlet.defId, outlet.address)
  if (def === undefined) return { model }
  const result = def.update(outlet.childModel, childMessage)
  const advanced = readyComposer(model, result.model)
  if (result.outMessage === undefined) return { model: advanced }
  return foldAreaOutMessage(advanced, result.outMessage)
}

const foldConversationUi = (
  model: Model,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: see foldComposerUi
  childMessage: unknown,
): UpdateReturn => {
  const outlet = model.conversationUi
  if (!Predicate.isTagged(outlet, 'Ready')) return { model }
  const def = getDef(outlet.plugin, outlet.defId, outlet.address)
  if (def === undefined) return { model }
  const result = def.update(outlet.childModel, childMessage)
  if (result.model === outlet.childModel) return { model }
  return {
    model: evo(model, {
      conversationUi: () =>
        OutletReady.make({
          plugin: outlet.plugin,
          defId: outlet.defId,
          slot: outlet.slot,
          address: outlet.address,
          childModel: result.model,
        }),
    }),
  }
}

type UiSlot = 'composer' | 'conversation'

interface UiAssignmentLike {
  readonly plugin: string
  readonly defId: string
}

interface UiBundleLike {
  readonly jsUrl: string
  readonly address: string
  readonly sdkMajor: number
}

const setOutlet = (model: Model, slot: UiSlot, outlet: OutletState): Model =>
  slot === 'composer'
    ? evo(model, { composerUi: () => outlet })
    : evo(model, { conversationUi: () => outlet })

/**
 * Reconcile one slot against the snapshot: an assignment without code, or
 * no assignment at all, empties the outlet; a generation this app already
 * holds mounts without fetching; anything else loads its bundle. Every
 * branch is idempotent, so a repeated snapshot is a no-op.
 */
/** One slot's reconcile verdict: the model plus the bundle fetch it needs, if any. */
interface ReconciledSlot {
  readonly model: Model
  readonly commands: Update.Commands<Message, ProjectClient | ThreadClient>
}

const reconcileSlot = (
  model: Model,
  slot: UiSlot,
  assignment: UiAssignmentLike | undefined,
  bundle: UiBundleLike | undefined,
): ReconciledSlot => {
  const outlet = slot === 'composer' ? model.composerUi : model.conversationUi
  if (assignment === undefined || bundle === undefined) {
    if (Predicate.isTagged(outlet, 'Empty')) return { model, commands: [] }
    return { model: setOutlet(model, slot, OutletEmpty.make({})), commands: [] }
  }
  if (
    (Predicate.isTagged(outlet, 'Ready') || Predicate.isTagged(outlet, 'Loading')) &&
    outlet.plugin === assignment.plugin &&
    outlet.defId === assignment.defId &&
    outlet.address === bundle.address
  ) {
    return { model, commands: [] }
  }
  const def = getDef(assignment.plugin, assignment.defId, bundle.address)
  if (def !== undefined) {
    const mounted = setOutlet(
      model,
      slot,
      OutletReady.make({
        plugin: assignment.plugin,
        defId: assignment.defId,
        slot,
        address: bundle.address,
        childModel: def.init(),
      }),
    )
    return { model: slot === 'composer' ? syncComposer(mounted) : mounted, commands: [] }
  }
  return {
    model: setOutlet(
      model,
      slot,
      OutletLoading.make({
        plugin: assignment.plugin,
        defId: assignment.defId,
        slot,
        jsUrl: bundle.jsUrl,
        address: bundle.address,
      }),
    ),
    commands: [
      LoadBundle({
        plugin: assignment.plugin,
        defId: assignment.defId,
        slot,
        jsUrl: bundle.jsUrl,
        address: bundle.address,
        sdkMajor: bundle.sdkMajor,
      }),
    ],
  }
}

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
    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const projects = AppRoute.guards.SettingsProjectDetail(route)
        ? Projects.update(
            model.projects,
            Projects.Message.OpenedDetail({ project: route.projectId }),
          ).model
        : model.projects
      return {
        model: syncComposer(
          evo(model, {
            route: () => route,
            options: () => ComposerOptionsLoading.make({}),
            projects: () => projects,
          }),
        ),
        commands: [...pickerLoad(route), ...detailLoad(route)],
      }
    },
    GotShell: ({ message: childMessage }) => foldShell(model, childMessage),
    GotThreads: ({ message: childMessage }) => foldThreads(model, childMessage),
    GotProjects: ({ message: childMessage }) => {
      // Host facts the composer absorbs through its props: the project list
      // moves the picker by diff, so root folds Projects alone and syncs.
      if (Predicate.isTagged(childMessage, 'ProjectDeleted')) {
        const combined = foldProjects(model, childMessage)
        if (
          AppRoute.guards.SettingsProjectDetail(model.route) &&
          model.route.projectId === childMessage.project
        ) {
          const pending = 'commands' in combined ? combined.commands : undefined
          return {
            model: syncComposer(combined.model),
            commands: [...(pending ?? []), NavigateInternal({ url: settingsProjectsRouter() })],
          }
        }
        return { ...combined, model: syncComposer(combined.model) }
      }
      const combined = foldProjects(model, childMessage)
      return { ...combined, model: syncComposer(combined.model) }
    },
    GotComposerUi: ({ message: childMessage }) => foldComposerUi(model, childMessage),
    GotConversationUi: ({ message: childMessage }) => foldConversationUi(model, childMessage),
    HostOptionsArrived: ({ options }) => ({
      model: syncComposer(evo(model, { options: () => ComposerOptionsLoaded.make({ options }) })),
    }),
    HostOptionsFailed: ({ reason }) => ({
      model: syncComposer(
        evo(model, { options: () => ComposerOptionsUnreachable.make({ reason }) }),
      ),
    }),
    GotSettings: ({ message: childMessage }) => foldSettings(model, childMessage),
    CopyCompleted: () => ({ model }),
    PrefsPersisted: () => ({ model }),
    UiSnapshotArrived: ({ snapshot }) => {
      const composer = snapshot.assignments.find((entry) => entry.slot === 'composer')
      const composerBundle =
        composer === undefined
          ? undefined
          : snapshot.bundles.find(
              (entry) => entry.plugin === composer.plugin && entry.defId === composer.defId,
            )
      const first = reconcileSlot(model, 'composer', composer, composerBundle)
      const conversation = snapshot.assignments.find((entry) => entry.slot === 'conversation')
      const conversationBundle =
        conversation === undefined
          ? undefined
          : snapshot.bundles.find(
              (entry) => entry.plugin === conversation.plugin && entry.defId === conversation.defId,
            )
      const second = reconcileSlot(first.model, 'conversation', conversation, conversationBundle)
      const commands: Update.Commands<Message, ProjectClient | ThreadClient> = [
        ...first.commands,
        ...second.commands,
      ]
      return commands.length === 0 ? { model: second.model } : { model: second.model, commands }
    },
    BundleReady: ({ plugin, defId, slot, address }) => {
      if (slot !== 'composer' && slot !== 'conversation') return { model }
      const outlet = slot === 'composer' ? model.composerUi : model.conversationUi
      if (
        !Predicate.isTagged(outlet, 'Loading') ||
        outlet.plugin !== plugin ||
        outlet.defId !== defId ||
        outlet.address !== address
      ) {
        return { model }
      }
      const def = getDef(plugin, defId, address)
      if (def === undefined) return { model }
      const mounted = setOutlet(
        model,
        slot,
        OutletReady.make({ plugin, defId, slot, address, childModel: def.init() }),
      )
      return { model: slot === 'composer' ? syncComposer(mounted) : mounted }
    },
    BundleFailed: ({ plugin, defId, slot, reason }) => {
      if (slot !== 'composer' && slot !== 'conversation') return { model }
      const outlet = slot === 'composer' ? model.composerUi : model.conversationUi
      if (
        !Predicate.isTagged(outlet, 'Loading') ||
        outlet.plugin !== plugin ||
        outlet.defId !== defId
      ) {
        return { model }
      }
      return { model: setOutlet(model, slot, OutletFailed.make({ plugin, defId, slot, reason })) }
    },
    ThreadCreated: ({ threadId }) => ({
      model: evo(model, { submit: () => ({ pending: false, error: undefined }) }),
      commands:
        model.settings.navigateToThreads === false
          ? []
          : [NavigateInternal({ url: threadRouter({ threadId }) })],
    }),
    ThreadCreateFailed: ({ reason, text }) => ({
      model: submitFailed(model, reason, text),
    }),
    ThreadMessageSent: () => ({
      model: evo(model, { submit: () => ({ pending: false, error: undefined }) }),
    }),
    ThreadMessageFailed: ({ reason, text }) => ({
      model: submitFailed(model, reason, text),
    }),
    DismissedSubmitError: () => ({
      model: evo(model, { submit: () => ({ pending: model.submit.pending, error: undefined }) }),
    }),
  })

const shellSubs = Subscription.lift(Shell.subscriptions)({
  toChildModel: (model: Model) => model.shell,
  toParentMessage: (message: Shell.Message): Message => Message.GotShell({ message }),
})

const threadSubs = Subscription.lift(LeftPanel.subscriptions)({
  toChildModel: (model: Model) => model.threads,
  toParentMessage: (message: LeftPanel.Message): Message => Message.GotThreads({ message }),
})

/**
 * The UI snapshot stream: the host's bundles and assignments, watched live
 * so deactivating the plugin behind a slot empties it. Resources flow from
 * the runtime's layer, the way commands receive their clients.
 */
const uiSubs = Subscription.make<Model, Message, UiClient>()((entry) => ({
  watch: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: (): Stream.Stream<Message, never, UiClient> =>
        Stream.unwrap(
          Effect.map(Effect.serviceOption(UiClient), (option) =>
            Option.match(option, {
              onNone: (): Stream.Stream<Message, never, UiClient> => Stream.empty,
              onSome: (client) =>
                Stream.map(client.watch, (snapshot): Message =>
                  Message.UiSnapshotArrived({ snapshot }),
                ).pipe(Stream.catch(() => Stream.empty)),
            }),
          ),
        ),
    },
  ),
}))

export const subscriptions = Subscription.aggregate(shellSubs, threadSubs, uiSubs)

/**
 * One outlet: the assigned def rendering through the app's boundary, or
 * nothing when the slot is empty, loading, or failed. An empty outlet is
 * the replaceability proof made visible: no def, no UI, no fallback.
 */
const composerOutlet = (model: Model, h: HtmlBuilder<Message>): Html | undefined => {
  const outlet = model.composerUi
  if (!Predicate.isTagged(outlet, 'Ready')) return undefined
  const def = getDef(outlet.plugin, outlet.defId, outlet.address)
  if (def === undefined) return undefined
  // SAFETY: the brand is type-level-only per foldkit's docs, so a def view built by another foldkit copy stays structurally compatible.
  return h.submodel({
    slotId: 'composer-outlet',
    model: outlet.childModel,
    view: def.view as SubmodelView<unknown, unknown, ComposerProps>,
    viewInputs: composerPropsOf(model),
    toParentMessage: (childMessage) => Message.GotComposerUi({ message: childMessage }),
  })
}

const conversationOutlet = (model: Model, h: HtmlBuilder<Message>): Html | undefined => {
  const outlet = model.conversationUi
  if (!Predicate.isTagged(outlet, 'Ready')) return undefined
  const def = getDef(outlet.plugin, outlet.defId, outlet.address)
  if (def === undefined) return undefined
  const threadId = Option.getOrUndefined(selectedThread(model))
  const props: ConversationProps = threadId === undefined ? {} : { threadId }
  // SAFETY: see composer-outlet above.
  return h.submodel({
    slotId: 'conversation-outlet',
    model: outlet.childModel,
    view: def.view as SubmodelView<unknown, unknown, ConversationProps>,
    viewInputs: props,
    toParentMessage: (childMessage) => Message.GotConversationUi({ message: childMessage }),
  })
}

const projectsSlot = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'projects',
    model: model.projects,
    view: Projects.view,
    toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
  })

const homeMain = (model: Model, h: HtmlBuilder<Message>): Html => {
  const error = submitErrorSlot(model, h)
  const composer = composerOutlet(model, h)
  return h.div(
    [
      h.Attribute('data-main', ''),
      h.Class('flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6'),
    ],
    [...(error === undefined ? [] : [error]), ...(composer === undefined ? [] : [composer])],
  )
}

/**
 * A thread's conversation: the viewer outlet on top, the composer outlet
 * below. Both are plugin defs now; root only stacks them.
 */
const conversationMain = (model: Model, h: HtmlBuilder<Message>): Html => {
  const error = submitErrorSlot(model, h)
  const conversation = conversationOutlet(model, h)
  const composer = composerOutlet(model, h)
  return h.div(
    [h.Attribute('data-conversation', ''), h.Class('flex min-h-0 flex-1 flex-col')],
    [
      ...(conversation === undefined ? [h.div([h.Class('min-h-0 flex-1')], [])] : [conversation]),
      h.div(
        [h.Class('flex shrink-0 flex-col items-center gap-2 px-6 pb-6')],
        [...(error === undefined ? [] : [error]), ...(composer === undefined ? [] : [composer])],
      ),
    ],
  )
}

const submitErrorSlot = (model: Model, h: HtmlBuilder<Message>): Html | undefined => {
  const error = model.submit.error
  if (error === undefined) return undefined
  return h.div(
    [
      h.DataAttribute('submit-error', ''),
      h.Class(
        'w-full max-w-3xl rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm',
      ),
    ],
    [
      h.span([h.DataAttribute('submit-error-text', '')], [error]),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.DismissedSubmitError()),
          h.DataAttribute('submit-error-dismiss', ''),
          h.Class('ml-2 underline'),
        ],
        ['Dismiss'],
      ),
    ],
  )
}

const leftPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'left-panel',
    model: model.threads,
    view: LeftPanel.view,
    viewInputs: {
      sections: emptyThreadSections,
      selected: selectedThread(model),
      projects: Projects.projectsOf(model.projects).map((project) => ({
        id: project.id,
        name: project.name,
      })),
    },
    toParentMessage: (childMessage) => Message.GotThreads({ message: childMessage }),
  })

const rightPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  RightPanel.view(selectedThread(model), { sections: emptyThreadSections }, h)

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

const settingsProjectsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  settingsView(
    model,
    (contentH) =>
      contentH.submodel({
        slotId: 'settings-projects',
        model: model.projects,
        view: Projects.settingsView,
        toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
      }),
    h,
  )

const settingsProjectDetailView = (model: Model, h: HtmlBuilder<Message>): Html =>
  settingsView(
    model,
    (contentH) =>
      contentH.submodel({
        slotId: 'settings-project-detail',
        model: model.projects,
        view: Projects.detailView,
        toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
      }),
    h,
  )

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
    SettingsProjects: () => settingsProjectsView(model, h),
    SettingsProjectDetail: () => settingsProjectDetailView(model, h),
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

/** The shared create dialogs, mounted once above every page. */
const projectsDialogs = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'settings-project-dialogs',
    model: model.projects,
    view: Projects.dialogsView,
    toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
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
    : h.div([h.Class('contents')], [routeView(model, h), projectsDialogs(model, h)]),
})
