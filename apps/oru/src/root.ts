import { Effect, Match, Option, Predicate, Schema } from 'effect'
import { Command, Navigation, Url } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { ProjectClient, ThreadClient, type HostUnreachable } from '@oru/rpc'
import * as AccessPicker from './access-picker.ts'
import * as BranchPicker from './branch-picker.ts'
import * as Composer from './composer.ts'
import * as LeftPanel from './left-panel.ts'
import * as ModelPicker from './model-picker.ts'
import * as ProjectPicker from './project-picker.ts'
import * as Projects from './projects.ts'
import * as RightPanel from './right-panel.ts'
import * as WorktreePicker from './worktree-picker.ts'
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

export const Model = Schema.Struct({
  route: AppRoute,
  shell: Shell.Model,
  threads: LeftPanel.Model,
  projects: Projects.Model,
  picker: ModelPicker.Model,
  projectPicker: ProjectPicker.Model,
  worktree: WorktreePicker.Model,
  branch: BranchPicker.Model,
  access: AccessPicker.Model,
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
  GotPicker: { message: ModelPicker.Message },
  GotProjectPicker: { message: ProjectPicker.Message },
  GotWorktree: { message: WorktreePicker.Message },
  GotBranch: { message: BranchPicker.Message },
  GotAccess: { message: AccessPicker.Message },
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
  messages: [Message.GotProjects, Message.GotProjectPicker],
  execute: ({ name, cwd, icon }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) => client.create(name, cwd, icon)),
      Effect.map((created) =>
        Message.GotProjects({ message: Projects.Message.ProjectCreated({ project: created }) }),
      ),
      Effect.catchTags({
        // The picker's own form hears the refusal: the host's words render
        // where the write was attempted.
        RelativeCwd: (error) =>
          Effect.succeed(
            Message.GotProjectPicker({
              message: ProjectPicker.Message.CreateRefused({
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
      Effect.flatMap((client) => client.update(project, { name, cwd, icon })),
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
  args: { path: Schema.UndefinedOr(Schema.String) },
  messages: [Message.GotProjects],
  execute: ({ path }) =>
    ProjectClient.pipe(
      Effect.flatMap((client) => client.listDirectory(path)),
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
  messages: [Message.GotPicker],
  execute: ({ threadId, refresh }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.options(threadId, refresh ? { refresh: true } : undefined)),
      Effect.map((options) =>
        Message.GotPicker({ message: ModelPicker.Message.OptionsArrived({ options }) }),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          Message.GotPicker({
            message: ModelPicker.Message.OptionsFailed({
              reason: `${error.operation}: ${error.reason}`,
            }),
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
  messages: [Message.GotPicker],
  execute: ({ threadId, harness, model, reasoning }) =>
    ThreadClient.pipe(
      Effect.flatMap((client) => client.configure(threadId, { harness, model, reasoning })),
      Effect.map((options) =>
        Message.GotPicker({ message: ModelPicker.Message.OptionsArrived({ options }) }),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          Message.GotPicker({
            message: ModelPicker.Message.OptionsFailed({
              reason: `${error.operation}: ${error.reason}`,
            }),
          }),
        ),
      ),
    ),
})

export const CopyText = Command.define('CopyText', {
  args: { text: Schema.String },
  messages: [Message.GotPicker],
  execute: ({ text }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => undefined,
    }).pipe(
      Effect.as(Message.GotPicker({ message: ModelPicker.Message.CopiedCommand() })),
      Effect.catch(() =>
        Effect.succeed(Message.GotPicker({ message: ModelPicker.Message.CopyFailed() })),
      ),
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

export const init = (url: Url.Url) => {
  const route = urlToAppRoute(url)
  return {
    model: {
      route,
      shell: Shell.init(),
      threads: LeftPanel.init(),
      projects: Projects.init(),
      picker: ModelPicker.init(),
      projectPicker: ProjectPicker.init(),
      worktree: WorktreePicker.init(),
      branch: BranchPicker.init(),
      access: AccessPicker.init(),
      composer: Composer.init(),
      settings: General.init(),
    },
    commands: [ListProjects(), ...pickerLoad(route)],
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
  foldOutMessage: (outMessage: LeftPanel.OutMessage): Update.Step<Model, Message> =>
    LeftPanel.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      Selected:
        ({ id }) =>
        (model) => ({
          model,
          commands: [NavigateInternal({ url: threadRouter({ threadId: id }) })],
        }),
      RequestedNewProject: () => (model) => ({
        model,
        commands: [NavigateInternal({ url: settingsProjectsRouter() })],
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
    }),
})

/**
 * The composer's project picker. Its create asks the host, so the request
 * leaves here as a Command and the host's answer comes back through
 * `GotProjects` and is forwarded below.
 */
const foldProjectPicker = Update.foldChild({
  update: ProjectPicker.update,
  read: (model: Model) => Option.some(model.projectPicker),
  write: (model, nextChild) => evo(model, { projectPicker: () => nextChild }),
  toParentMessage: (message: ProjectPicker.Message) => Message.GotProjectPicker({ message }),
  foldOutMessage: (
    outMessage: ProjectPicker.OutMessage,
  ): Update.Step<Model, Message, ProjectClient> =>
    ProjectPicker.OutMessage.match<Update.Step<Model, Message, ProjectClient>>(outMessage, {
      RequestedCreate:
        ({ name, cwd, icon }) =>
        (model) => {
          const args = icon === undefined ? { name, cwd } : { name, cwd, icon }
          return { model, commands: [CreateProject(args)] }
        },
      RequestedDirectory:
        ({ path }) =>
        (model) => ({ model, commands: [ListDirectory({ path })] }),
    }),
})

const foldWorktree = Update.foldChild({
  update: WorktreePicker.update,
  read: (model: Model) => Option.some(model.worktree),
  write: (model, nextChild) => evo(model, { worktree: () => nextChild }),
  toParentMessage: (message: WorktreePicker.Message) => Message.GotWorktree({ message }),
})

const foldBranch = Update.foldChild({
  update: BranchPicker.update,
  read: (model: Model) => Option.some(model.branch),
  write: (model, nextChild) => evo(model, { branch: () => nextChild }),
  toParentMessage: (message: BranchPicker.Message) => Message.GotBranch({ message }),
})

const foldAccess = Update.foldChild({
  update: AccessPicker.update,
  read: (model: Model) => Option.some(model.access),
  write: (model, nextChild) => evo(model, { access: () => nextChild }),
  toParentMessage: (message: AccessPicker.Message) => Message.GotAccess({ message }),
})

const foldPicker = Update.foldChild({
  update: ModelPicker.update,
  read: (model: Model) => Option.some(model.picker),
  write: (model, nextChild) => evo(model, { picker: () => nextChild }),
  toParentMessage: (message: ModelPicker.Message) => Message.GotPicker({ message }),
  foldOutMessage: (outMessage: ModelPicker.OutMessage): Update.Step<Model, Message, ThreadClient> =>
    ModelPicker.OutMessage.match<Update.Step<Model, Message, ThreadClient>>(outMessage, {
      OptionsRequested:
        ({ refresh }) =>
        (model) => ({
          model,
          commands: [
            LoadThreadOptions({ threadId: Option.getOrUndefined(selectedThread(model)), refresh }),
          ],
        }),
      // A picker on home has no thread to configure yet: the selection it
      // stored is the choice that thread is created with.
      ConfigureRequested:
        ({ harness, model: chosen, reasoning }) =>
        (model) =>
          Option.match(selectedThread(model), {
            onNone: () => ({ model }),
            onSome: (threadId) => ({
              model,
              commands: [ConfigureThread({ threadId, harness, model: chosen, reasoning })],
            }),
          }),
      CopyRequested:
        ({ command }) =>
        (model) => ({
          model,
          commands: [CopyText({ text: command })],
        }),
    }),
})

const foldComposer = Update.foldChild({
  update: Composer.update,
  read: (model: Model) => Option.some(model.composer),
  write: (model, nextChild) => evo(model, { composer: () => nextChild }),
  toParentMessage: (message: Composer.Message) => Message.GotComposer({ message }),
  foldOutMessage: (
    outMessage: Composer.OutMessage,
  ): Update.Step<Model, Message, ProjectClient | ThreadClient> =>
    Composer.OutMessage.match<Update.Step<Model, Message, ProjectClient | ThreadClient>>(
      outMessage,
      {
        // The draft is the composer's; everything it points at lives in the
        // picker submodels, which the thread's creation reads when it needs
        // them. Nothing is copied here.
        Submitted: () => (model) => ({ model }),
      },
    ),
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
    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      return {
        model: evo(model, { route: () => route, picker: () => ModelPicker.init() }),
        commands: pickerLoad(route),
      }
    },
    GotPicker: ({ message: childMessage }) => foldPicker(model, childMessage),
    GotShell: ({ message: childMessage }) => foldShell(model, childMessage),
    GotThreads: ({ message: childMessage }) => foldThreads(model, childMessage),
    GotProjects: ({ message: childMessage }) => {
      // The picker's UI answers host facts the `Projects` submodel holds, so
      // the answers that move it arrive here and are folded into both.
      if (Predicate.isTagged(childMessage, 'ProjectCreated')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) =>
            foldProjectPicker(
              next,
              ProjectPicker.Message.ProjectCreated({ project: childMessage.project }),
            ),
        ])
      }
      if (Predicate.isTagged(childMessage, 'ProjectUpdated')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) =>
            foldProjectPicker(
              next,
              ProjectPicker.Message.ProjectUpdated({ project: childMessage.project }),
            ),
        ])
      }
      if (Predicate.isTagged(childMessage, 'ProjectDeleted')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) =>
            foldProjectPicker(
              next,
              ProjectPicker.Message.ProjectDeleted({ project: childMessage.project }),
            ),
        ])
      }
      if (Predicate.isTagged(childMessage, 'DirectoryArrived')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) =>
            foldProjectPicker(
              next,
              ProjectPicker.Message.DirectoryArrived({ listing: childMessage.listing }),
            ),
        ])
      }
      if (Predicate.isTagged(childMessage, 'DirectoryFailed')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) =>
            foldProjectPicker(
              next,
              ProjectPicker.Message.DirectoryFailed({ error: childMessage.error }),
            ),
        ])
      }
      if (Predicate.isTagged(childMessage, 'HostUnreachable')) {
        return Update.combine(model, [
          (next) => foldProjects(next, childMessage),
          (next) => foldProjectPicker(next, ProjectPicker.Message.HostUnreachable()),
        ])
      }
      return foldProjects(model, childMessage)
    },
    GotProjectPicker: ({ message: childMessage }) => {
      // A create refusal answers whichever form asked: the picker or the
      // settings page. Each keeps it only while its own draft is pending.
      if (Predicate.isTagged(childMessage, 'CreateRefused')) {
        return Update.combine(model, [
          (next) => foldProjectPicker(next, childMessage),
          (next) =>
            foldProjects(next, Projects.Message.CreateRefused({ refusal: childMessage.refusal })),
        ])
      }
      return foldProjectPicker(model, childMessage)
    },
    GotWorktree: ({ message: childMessage }) => foldWorktree(model, childMessage),
    GotBranch: ({ message: childMessage }) => foldBranch(model, childMessage),
    GotAccess: ({ message: childMessage }) => foldAccess(model, childMessage),
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

const pickerSubs = Subscription.lift(ModelPicker.subscriptions)({
  toChildModel: (model: Model) => model.picker,
  toParentMessage: (message: ModelPicker.Message): Message => Message.GotPicker({ message }),
})

export const subscriptions = Subscription.aggregate<Model, Message>()(
  shellSubs,
  threadSubs,
  pickerSubs,
)

/**
 * What each composer slot holds. Every slot is a submodel that owns its own
 * state; adding a picker is one `h.submodel` line here, never a change to
 * the composer. The project list is plain data, so it crosses the
 * `viewInputs` boundary while the picker's selection stays inside it.
 */
const composerInputs = (
  model: Model,
  headline: string | undefined,
  h: HtmlBuilder<Message>,
): Composer.ViewInputs => {
  const inputs: Composer.ViewInputs = {
    placeholder: 'Ask anything. @ to mention files, folders, or sections',
    toLeading: () =>
      h.submodel({
        slotId: 'model-picker-trigger',
        model: model.picker,
        view: ModelPicker.triggerView,
        toParentMessage: (childMessage) => Message.GotPicker({ message: childMessage }),
      }),
    toChipsLeft: () =>
      h.div(
        [h.Class('flex items-center gap-0.5')],
        [
          h.submodel({
            slotId: 'project-picker',
            model: model.projectPicker,
            view: ProjectPicker.view,
            viewInputs: {
              projects: Projects.projectsOf(model.projects),
              isLoading: Projects.isLoading(model.projects),
            },
            toParentMessage: (childMessage) => Message.GotProjectPicker({ message: childMessage }),
          }),
          h.submodel({
            slotId: 'worktree-picker',
            model: model.worktree,
            view: WorktreePicker.view,
            toParentMessage: (childMessage) => Message.GotWorktree({ message: childMessage }),
          }),
          h.submodel({
            slotId: 'branch-picker',
            model: model.branch,
            view: BranchPicker.view,
            toParentMessage: (childMessage) => Message.GotBranch({ message: childMessage }),
          }),
        ],
      ),
    toChipsRight: () =>
      h.submodel({
        slotId: 'access-picker',
        model: model.access,
        view: AccessPicker.view,
        toParentMessage: (childMessage) => Message.GotAccess({ message: childMessage }),
      }),
  }
  if (headline === undefined) return inputs
  return { ...inputs, headline }
}

const composerSlot = (model: Model, headline: string | undefined, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'composer',
    model: model.composer,
    view: Composer.view,
    viewInputs: composerInputs(model, headline, h),
    toParentMessage: (childMessage) => Message.GotComposer({ message: childMessage }),
  })

const projectsSlot = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'projects',
    model: model.projects,
    view: Projects.view,
    toParentMessage: (childMessage) => Message.GotProjects({ message: childMessage }),
  })

/**
 * The harness's health, above the composer. The picker's catalogue lives in
 * the composer's `leading` slot; a harness that is not ready still renders
 * here without opening anything.
 */
const pickerStatusSlot = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'model-picker-status',
    model: model.picker,
    view: ModelPicker.view,
    toParentMessage: (childMessage) => Message.GotPicker({ message: childMessage }),
  })

const homeMain = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Attribute('data-main', ''),
      h.Class('flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6'),
    ],
    [
      h.div([h.Class('w-full max-w-3xl')], [projectsSlot(model, h)]),
      pickerStatusSlot(model, h),
      composerSlot(model, 'What should we build in oru?', h),
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
        [h.Class('flex shrink-0 flex-col items-center gap-2 px-6 pb-6')],
        [pickerStatusSlot(model, h), composerSlot(model, undefined, h)],
      ),
    ],
  )

const threadName = (id: string): string => id

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
