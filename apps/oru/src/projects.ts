/**
 * The host's projects, as the app knows them.
 *
 * `ListProjects` is the app's first call and its liveness probe: the state this
 * model is in is the state the app is in. A host that does not answer, or
 * answers that it has no projects, is a fact to render — with a retry — not a
 * defect to die on.
 *
 * This model owns the host answer, the settings edit draft, and one project
 * detail. The composer's project picker owns its own selection and create
 * draft next to the state they derive from, and reads the list this model holds.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'
import { ArrowUp, ChevronRight, Folder, FolderGit, GripVertical, Pencil, X } from 'lucide'
import { ProjectId } from '@oru/kernel'
import { DirectoryListing, Project, ProjectDetail } from '@oru/rpc'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'
import { settingsProjectDetailRouter, settingsProjectsRouter } from '@/route.ts'
import { card, section, textRow } from '@/settings/controls.ts'

export const Loading = Schema.TaggedStruct('Loading', {})
export const Loaded = Schema.TaggedStruct('Loaded', { projects: Schema.Array(Project) })
export const Unreachable = Schema.TaggedStruct('Unreachable', { reason: Schema.String })

/** The host's answer, which is also the app's liveness state. */
export const Host = Schema.Union([Loading, Loaded, Unreachable])
export type Host = typeof Host.Type

/**
 * The host's refusals as data a Message can carry. Only a create can hear
 * `RelativeCwd` and only an edit can hear `UnknownProject`, so each draft
 * declares just the refusals its own call can produce. A host that did not
 * answer is not a field error; it is the app-level state (ADR-0013).
 */
export const RelativeCwd = Schema.TaggedStruct('RelativeCwd', { cwd: Schema.String })

/** The host's directory refusals as data a Message can carry. */
export const DirectoryMissing = Schema.TaggedStruct('DirectoryMissing', {
  path: Schema.String,
})
export const NotDirectory = Schema.TaggedStruct('NotDirectory', { path: Schema.String })
export const DirectoryError = Schema.Union([DirectoryMissing, NotDirectory])
export type DirectoryError = typeof DirectoryError.Type

export const directoryErrorText = (error: DirectoryError): string =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      DirectoryMissing: ({ path }) => `Nothing at "${path}" answers.`,
      NotDirectory: ({ path }) => `"${path}" is not a directory.`,
    }),
  )
export const UnknownProject = Schema.TaggedStruct('UnknownProject', { project: ProjectId })
export const Refusal = Schema.Union([RelativeCwd, UnknownProject])
export type RelativeCwd = typeof RelativeCwd.Type
export type UnknownProject = typeof UnknownProject.Type
export type Refusal = typeof Refusal.Type

/**
 * A directory name suggested by the checkout: the checked-out folder's own
 * name, so accepting the suggestion labels the project after its directory.
 */
export const deriveProjectName = (cwd: string): string => {
  const stripped = cwd.replace(/\/+$/, '')
  const base = stripped.slice(stripped.lastIndexOf('/') + 1)
  return base.length === 0 ? 'project' : base
}

/** One settings row in edit mode, seeded from the host's own row. */
export const Edit = Schema.Struct({
  project: ProjectId,
  name: Schema.String,
  cwd: Schema.String,
  icon: Schema.String,
  refusal: Schema.UndefinedOr(Refusal),
  isSaving: Schema.Boolean,
})
export type Edit = typeof Edit.Type

/**
 * The directory browser, rendered as a dialog over the settings page.
 * `direction` is where the next listing slides in from: deeper is forward.
 * `cache` keeps every listing visited this visit, so going back is instant
 * and hovered rows can preload before they are opened. `prefetching` names
 * the preloads still in flight, so one hover issues one fetch.
 */
export const Direction = Schema.Literals(['forward', 'back'])
export type Direction = typeof Direction.Type

export const CachedDirectory = Schema.Struct({
  path: Schema.String,
  listing: DirectoryListing,
})
export type CachedDirectory = typeof CachedDirectory.Type

export const Browse = Schema.Struct({
  path: Schema.UndefinedOr(Schema.String),
  listing: Schema.UndefinedOr(DirectoryListing),
  isLoading: Schema.Boolean,
  error: Schema.UndefinedOr(DirectoryError),
  direction: Direction,
  cache: Schema.Array(CachedDirectory),
  prefetching: Schema.Array(Schema.String),
})
export type Browse = typeof Browse.Type

/** Session fields that survive across listings within one dialog visit. */
const carryBrowse = (browse: Browse | undefined) => ({
  cache: browse?.cache ?? [],
  prefetching: browse?.prefetching ?? [],
})

const cachedListing = (browse: Browse, path: string): DirectoryListing | undefined =>
  browse.cache.find((entry) => entry.path === path)?.listing

/** Newest last, capped so a long browse never grows the model. */
const storeListing = (
  cache: ReadonlyArray<CachedDirectory>,
  listing: DirectoryListing,
): ReadonlyArray<CachedDirectory> =>
  [
    ...cache.filter((entry) => entry.path !== listing.path),
    CachedDirectory.make({ path: listing.path, listing }),
  ].slice(-20)

/** Folders only; dotfolders never name a project, so they never list. */
const visibleDirectories = (
  browse: Browse,
): ReadonlyArray<{ readonly name: string; readonly path: string }> =>
  (browse.listing?.entries ?? []).filter(
    (entry) => entry.isDirectory && !entry.name.startsWith('.'),
  )

/**
 * A navigation that renders from cache when it can. A hit answers instantly
 * with no fetch; a miss keeps the stale listing on screen while it loads.
 */
const navigateBrowse = (browse: Browse | undefined, path: string, direction: Direction) => {
  const hit = browse === undefined ? undefined : cachedListing(browse, path)
  if (hit !== undefined) {
    return {
      browse: Browse.make({
        path,
        listing: hit,
        isLoading: false,
        error: undefined,
        direction,
        ...carryBrowse(browse),
      }),
      fetch: false,
    }
  }
  return {
    browse: Browse.make({
      path,
      listing: browse?.listing,
      isLoading: true,
      error: undefined,
      direction,
      ...carryBrowse(browse),
    }),
    fetch: true,
  }
}

/** The settings page's own create draft. */
export const Create = Schema.Struct({
  name: Schema.String,
  cwd: Schema.String,
  icon: Schema.String,
  refusal: Schema.UndefinedOr(RelativeCwd),
  isSaving: Schema.Boolean,
  browse: Schema.UndefinedOr(Browse),
})
export type Create = typeof Create.Type

/** One project detail, keyed by the route that selected it. */
export const Detail = Schema.Struct({
  project: ProjectId,
  detail: Schema.UndefinedOr(ProjectDetail),
  isLoading: Schema.Boolean,
  reason: Schema.UndefinedOr(Schema.String),
})
export type Detail = typeof Detail.Type

export const Model = Schema.Struct({
  host: Host,
  edit: Schema.UndefinedOr(Edit),
  create: Schema.UndefinedOr(Create),
  deleting: Schema.UndefinedOr(ProjectId),
  detail: Schema.UndefinedOr(Detail),
})
export type Model = typeof Model.Type

export const FIELDS = { name: 'name', cwd: 'cwd', icon: 'icon' } as const
export type Field = (typeof FIELDS)[keyof typeof FIELDS]

export const isField = (value: string): value is Field =>
  value === FIELDS.name || value === FIELDS.cwd || value === FIELDS.icon

export const Message = defineMessageUnion({
  // The host's answers.
  ProjectsArrived: { projects: Schema.Array(Project) },
  HostUnreachable: { reason: Schema.String },
  ProjectCreated: { project: Project },
  ProjectUpdated: { project: Project },
  ProjectDeleted: { project: ProjectId },
  UpdateRefused: { refusal: Refusal },
  CreateRefused: { refusal: RelativeCwd },
  DeleteRefused: {},

  // Settings → Projects.
  ClickedEdit: { project: ProjectId },
  ChangedEditField: { field: Schema.String, value: Schema.String },
  ClickedEditSave: {},
  ClickedEditCancel: {},

  ClickedCreate: {},
  ChangedCreateField: { field: Schema.String, value: Schema.String },
  ClickedCreateBrowse: {},
  ClickedCreateSave: {},
  ClickedCreateCancel: {},

  // The directory browser dialog.
  OpenedDirectory: { path: Schema.String },
  OpenedParent: {},
  ClickedUseDirectory: {},
  ClickedBrowseClose: {},
  ClickedBrowseEditPath: {},
  HoveredDirectory: { path: Schema.String },
  DirectoryArrived: { listing: DirectoryListing },
  DirectoryFailed: { error: DirectoryError },
  DirectoryCached: { listing: DirectoryListing },
  DirectoryCacheFailed: { path: Schema.String },

  // One project detail.
  OpenedDetail: { project: ProjectId },
  DetailArrived: { detail: ProjectDetail },
  DetailFailed: { project: ProjectId, reason: Schema.String },

  ClickedDelete: { project: ProjectId },
  ClickedDeleteConfirm: {},
  ClickedDeleteCancel: {},

  ClickedRetry: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedRetry: {},
  RequestedUpdate: {
    project: ProjectId,
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    icon: Schema.UndefinedOr(Schema.String),
  },
  RequestedCreate: {
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    icon: Schema.UndefinedOr(Schema.String),
  },
  RequestedDelete: { project: ProjectId },
  RequestedDirectory: { path: Schema.UndefinedOr(Schema.String) },
  RequestedPreload: { path: Schema.NonEmptyString },
  RequestedDetail: { project: ProjectId },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  host: Loading.make({}),
  edit: undefined,
  create: undefined,
  deleting: undefined,
  detail: undefined,
})

/** Retry puts the host member back to `Loading`; a draft is not the answer that failed. */
export const retrying = (model: Model): Model => evo(model, { host: () => Loading.make({}) })

export const isUnreachable = (model: Model): boolean =>
  Predicate.isTagged(model.host, 'Unreachable')

/** The host's projects, or nothing while it has not answered. */
export const projectsOf = (model: Model): ReadonlyArray<Project> =>
  Predicate.isTagged(model.host, 'Loaded') ? model.host.projects : []

export const isLoading = (model: Model): boolean => Predicate.isTagged(model.host, 'Loading')

export const projectOf = (model: Model, project: ProjectId): Project | undefined =>
  projectsOf(model).find((entry) => entry.id === project)

/** Replaces a listed project, or states a newly answered one. */
const upsert = (projects: ReadonlyArray<Project>, project: Project): ReadonlyArray<Project> =>
  projects.some((entry) => entry.id === project.id)
    ? projects.map((entry) => (entry.id === project.id ? project : entry))
    : [...projects, project]

const upserted = (host: Host, project: Project): Host =>
  Predicate.isTagged(host, 'Loaded')
    ? Loaded.make({ projects: upsert(host.projects, project) })
    : host

/**
 * The host's own words for a cwd it will not accept. Which cwd is acceptable
 * stays the host's answer; this only renders it.
 */
export const cwdRefusalText = (refusal: RelativeCwd): string =>
  `The host needs an absolute cwd, and "${refusal.cwd}" is not one.`

export const refusalText = (refusal: Refusal): string =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      RelativeCwd: (refusal) => cwdRefusalText(refusal),
      UnknownProject: ({ project }) => `This host has no project "${project}".`,
    }),
  )

export const relativeTime = (timestamp: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${String(days)}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${String(weeks)}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${String(months)}mo ago`
  return `${String(Math.floor(days / 365))}y ago`
}

export const breadcrumbSegments = (path: string): ReadonlyArray<string> =>
  path.split('/').filter((segment) => segment.length > 0)

/**
 * A host that stopped answering is not a write in flight, so the edit does
 * not stay pending through the retry that follows.
 */
const settled = (model: Model): Model =>
  evo(model, {
    edit: (edit) => (edit === undefined ? edit : evo(edit, { isSaving: () => false })),
    create: (create) => (create === undefined ? create : evo(create, { isSaving: () => false })),
    detail: (detail) => (detail === undefined ? detail : evo(detail, { isLoading: () => false })),
  })

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const editIsPending = (model: Model): boolean => model.edit?.isSaving === true

const createIsPending = (model: Model): boolean => model.create?.isSaving === true

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ProjectsArrived: ({ projects }) => ({
      model: evo(model, { host: () => Loaded.make({ projects }) }),
    }),
    HostUnreachable: ({ reason }) => ({
      model: settled(evo(model, { host: () => Unreachable.make({ reason }) })),
    }),
    ProjectCreated: ({ project }) => ({
      // Creating a project is the host recording a fact, so the created row
      // is what reaches the screen. The picker's own selection follows
      // through the message root forwards to it.
      model: evo(model, {
        host: (host) => upserted(host, project),
        create: () => undefined,
        detail: (detail) =>
          detail?.project === project.id
            ? evo(detail, { isLoading: () => true, detail: () => undefined })
            : detail,
      }),
    }),
    ProjectUpdated: ({ project }) => {
      const next = evo(model, {
        host: (host) => upserted(host, project),
        edit: () => undefined,
        detail: (detail) =>
          detail?.project === project.id
            ? evo(detail, { isLoading: () => true, detail: () => undefined })
            : detail,
      })
      if (model.detail?.project === project.id) {
        return {
          model: next,
          outMessage: OutMessage.RequestedDetail({ project: project.id }),
        }
      }
      return { model: next }
    },
    ProjectDeleted: ({ project }) => ({
      model: evo(model, {
        host: (host) =>
          Predicate.isTagged(host, 'Loaded')
            ? Loaded.make({ projects: host.projects.filter((entry) => entry.id !== project) })
            : host,
        deleting: (deleting) => (deleting === project ? undefined : deleting),
        detail: (detail) => (detail?.project === project ? undefined : detail),
      }),
    }),
    CreateRefused: ({ refusal }) => {
      const create = model.create
      return {
        model:
          create === undefined
            ? model
            : evo(model, { create: () => ({ ...create, refusal, isSaving: false }) }),
      }
    },
    DeleteRefused: () => ({ model: evo(model, { deleting: () => undefined }) }),
    UpdateRefused: ({ refusal }) => {
      const edit = model.edit
      return {
        model:
          edit === undefined
            ? model
            : evo(model, { edit: () => ({ ...edit, refusal, isSaving: false }) }),
      }
    },

    ClickedEdit: ({ project }) => {
      if (editIsPending(model)) return { model }
      const row = projectsOf(model).find((candidate) => candidate.id === project)
      // The editor opens on the host's row, so it cannot drift from it before
      // the first keystroke.
      return row === undefined
        ? { model }
        : {
            model: evo(model, {
              edit: () => ({
                project,
                name: row.name,
                cwd: row.cwd,
                icon: row.icon ?? '',
                refusal: undefined,
                isSaving: false,
              }),
            }),
          }
    },
    ChangedEditField: ({ field, value }) => {
      const edit = model.edit
      if (edit === undefined || edit.isSaving || !isField(field)) return { model }
      return {
        model: evo(model, {
          edit: () => ({
            ...edit,
            ...(field === FIELDS.name
              ? { name: value }
              : field === FIELDS.cwd
                ? { cwd: value }
                : { icon: value }),
            refusal: undefined,
          }),
        }),
      }
    },
    ClickedEditSave: () => {
      const edit = model.edit
      if (edit === undefined || edit.isSaving) return { model }
      const name = edit.name.trim()
      const cwd = edit.cwd.trim()
      const icon = edit.icon.trim()
      if (name.length === 0 || cwd.length === 0) return { model }
      return {
        model: evo(model, { edit: () => ({ ...edit, isSaving: true, refusal: undefined }) }),
        outMessage: OutMessage.RequestedUpdate({
          project: edit.project,
          name,
          cwd,
          icon: icon.length === 0 ? undefined : icon,
        }),
      }
    },
    ClickedEditCancel: () => {
      if (editIsPending(model)) return { model }
      return { model: evo(model, { edit: () => undefined }) }
    },

    // Creating starts in the directory picker: the details dialog only opens
    // once a folder is confirmed.
    ClickedCreate: () => {
      if (model.create !== undefined || createIsPending(model)) return { model }
      return {
        model: evo(model, {
          create: () => ({
            name: '',
            cwd: '',
            icon: '',
            refusal: undefined,
            isSaving: false,
            browse: Browse.make({
              path: undefined,
              listing: undefined,
              isLoading: true,
              error: undefined,
              direction: 'forward',
              cache: [],
              prefetching: [],
            }),
          }),
        }),
        outMessage: OutMessage.RequestedDirectory({ path: undefined }),
      }
    },
    ChangedCreateField: ({ field, value }) => {
      const create = model.create
      if (create === undefined || create.isSaving || !isField(field)) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            ...(field === FIELDS.name
              ? { name: value }
              : field === FIELDS.cwd
                ? { cwd: value }
                : { icon: value }),
            refusal: undefined,
          }),
        }),
      }
    },
    ClickedCreateBrowse: () => {
      const create = model.create
      if (create === undefined || create.isSaving) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: undefined,
              listing: undefined,
              isLoading: true,
              error: undefined,
              direction: 'forward',
              cache: [],
              prefetching: [],
            }),
          }),
        }),
        outMessage: OutMessage.RequestedDirectory({ path: undefined }),
      }
    },
    ClickedCreateSave: () => {
      const create = model.create
      if (create === undefined || create.isSaving) return { model }
      const name = create.name.trim()
      const cwd = create.cwd.trim()
      const icon = create.icon.trim()
      if (name.length === 0 || cwd.length === 0) return { model }
      return {
        model: evo(model, { create: () => ({ ...create, isSaving: true, refusal: undefined }) }),
        outMessage: OutMessage.RequestedCreate({
          name,
          cwd,
          icon: icon.length === 0 ? undefined : icon,
        }),
      }
    },
    ClickedCreateCancel: () => {
      if (createIsPending(model)) return { model }
      return { model: evo(model, { create: () => undefined }) }
    },

    OpenedDirectory: ({ path }) => {
      const create = model.create
      if (create === undefined || create.isSaving) return { model }
      // A path that contains the current listing is a step back up; anything
      // else drills deeper, so the next listing knows which way to slide.
      const current = create.browse?.listing?.path
      const direction: Direction =
        current !== undefined && current !== path && current.startsWith(`${path}/`)
          ? 'back'
          : 'forward'
      const next = navigateBrowse(create.browse, path, direction)
      if (!next.fetch)
        return { model: evo(model, { create: () => ({ ...create, browse: next.browse }) }) }
      return {
        model: evo(model, { create: () => ({ ...create, browse: next.browse }) }),
        outMessage: OutMessage.RequestedDirectory({ path }),
      }
    },
    OpenedParent: () => {
      const create = model.create
      const parent = create?.browse?.listing?.parent
      if (create === undefined || create.isSaving || parent === undefined) return { model }
      const next = navigateBrowse(create.browse, parent, 'back')
      if (!next.fetch)
        return { model: evo(model, { create: () => ({ ...create, browse: next.browse }) }) }
      return {
        model: evo(model, { create: () => ({ ...create, browse: next.browse }) }),
        outMessage: OutMessage.RequestedDirectory({ path: parent }),
      }
    },
    ClickedUseDirectory: () => {
      const create = model.create
      const cwd = create?.browse?.listing?.path ?? create?.browse?.path
      if (create === undefined || create.isSaving || cwd === undefined) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            cwd,
            // A name the checkout suggests, kept only while the field is
            // still empty so a typed name is never overwritten.
            name: create.name.trim().length === 0 ? deriveProjectName(cwd) : create.name,
            browse: undefined,
          }),
        }),
      }
    },
    ClickedBrowseClose: () => {
      const create = model.create
      if (create === undefined || create.isSaving || create.browse === undefined) return { model }
      // Canceling before any folder was confirmed closes everything, so the
      // details form only appears after a confirm. Once there is a draft to
      // keep, cancel steps back to the form instead.
      const hasDraft =
        create.cwd.trim().length > 0 ||
        create.name.trim().length > 0 ||
        create.icon.trim().length > 0
      if (!hasDraft) return { model: evo(model, { create: () => undefined }) }
      return { model: evo(model, { create: () => ({ ...create, browse: undefined }) }) }
    },
    ClickedBrowseEditPath: () => {
      const create = model.create
      if (create === undefined || create.isSaving || create.browse === undefined) return { model }
      return { model: evo(model, { create: () => ({ ...create, browse: undefined }) }) }
    },
    HoveredDirectory: ({ path }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || create.isSaving || browse === undefined) return { model }
      if (browse.listing?.path === path) return { model }
      if (cachedListing(browse, path) !== undefined) return { model }
      if (browse.prefetching.includes(path)) return { model }
      if (browse.isLoading && browse.path === path) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({ ...browse, prefetching: [...browse.prefetching, path] }),
          }),
        }),
        outMessage: OutMessage.RequestedPreload({ path }),
      }
    },
    DirectoryArrived: ({ listing }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || browse === undefined) return { model }
      const cache = storeListing(browse.cache, listing)
      // A late answer for a path left behind only joins the cache; the
      // pending path keeps its stale listing until its own answer lands.
      const pending = browse.path === undefined || browse.path === listing.path
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: pending ? listing.path : browse.path,
              listing: pending ? listing : browse.listing,
              isLoading: pending ? false : browse.isLoading,
              error: undefined,
              direction: browse.direction,
              cache,
              prefetching: browse.prefetching.filter((entry) => entry !== listing.path),
            }),
          }),
        }),
      }
    },
    DirectoryFailed: ({ error }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || browse === undefined) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: browse.path,
              listing: browse.listing,
              isLoading: false,
              error,
              direction: browse.direction,
              cache: browse.cache,
              prefetching: browse.prefetching.filter((entry) => entry !== error.path),
            }),
          }),
        }),
      }
    },
    DirectoryCached: ({ listing }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || browse === undefined) return { model }
      // The user may have clicked in before the preload returned; then the
      // cached listing is the pending answer, not just a warmer cache.
      const pending = browse.isLoading && browse.path === listing.path
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: browse.path,
              listing: pending ? listing : browse.listing,
              isLoading: pending ? false : browse.isLoading,
              error: browse.error,
              direction: browse.direction,
              cache: storeListing(browse.cache, listing),
              prefetching: browse.prefetching.filter((entry) => entry !== listing.path),
            }),
          }),
        }),
      }
    },
    DirectoryCacheFailed: ({ path }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || browse === undefined) return { model }
      // A preload miss stays silent; the click that follows fetches loudly.
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              ...browse,
              prefetching: browse.prefetching.filter((entry) => entry !== path),
            }),
          }),
        }),
      }
    },

    OpenedDetail: ({ project }) => {
      const current = model.detail
      if (current?.project === project && (current.isLoading || current.detail !== undefined)) {
        return { model }
      }
      return {
        model: evo(model, {
          detail: () =>
            Detail.make({ project, detail: undefined, isLoading: true, reason: undefined }),
        }),
        outMessage: OutMessage.RequestedDetail({ project }),
      }
    },
    DetailArrived: ({ detail }) => {
      const current = model.detail
      if (current?.project !== detail.project.id) return { model }
      return {
        model: evo(model, {
          host: (host) => upserted(host, detail.project),
          detail: () =>
            Detail.make({
              project: detail.project.id,
              detail,
              isLoading: false,
              reason: undefined,
            }),
        }),
      }
    },
    DetailFailed: ({ project, reason }) => {
      const current = model.detail
      if (current?.project !== project) return { model }
      return {
        model: evo(model, {
          detail: () => Detail.make({ project, detail: undefined, isLoading: false, reason }),
        }),
      }
    },

    ClickedDelete: ({ project }) => {
      if (createIsPending(model) || editIsPending(model)) return { model }
      return { model: evo(model, { deleting: () => project }) }
    },
    ClickedDeleteConfirm: () => {
      const deleting = model.deleting
      if (deleting === undefined) return { model }
      return { model, outMessage: OutMessage.RequestedDelete({ project: deleting }) }
    },
    ClickedDeleteCancel: () => ({ model: evo(model, { deleting: () => undefined }) }),

    ClickedRetry: () => ({ model: retrying(model), outMessage: OutMessage.RequestedRetry() }),
  })

const projectRow = (project: Project, h: HtmlBuilder<Message>): Html =>
  h.li(
    [
      h.DataAttribute('project', project.id),
      h.Class(
        'flex items-baseline gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-sm',
      ),
    ],
    [
      icon(h, FolderGit, 'size-4 shrink-0 self-center text-muted-foreground'),
      h.span([h.Class('truncate text-sm font-medium')], [project.name]),
      h.span([h.Class('min-w-0 truncate font-mono text-xs text-muted-foreground')], [project.cwd]),
    ],
  )

const unreachableState = (reason: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('host-unreachable', ''),
      h.Class(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
      ),
    ],
    [
      h.p([h.Class('text-lg font-medium')], ['Host unreachable']),
      h.p(
        [h.Class('text-sm text-muted-foreground')],
        ['The app is a client of a running host, and this host did not answer.'],
      ),
      h.code(
        [h.DataAttribute('host-unreachable-reason', ''), h.Class('font-mono text-xs')],
        [reason],
      ),
      button(
        {
          onClick: Message.ClickedRetry(),
          variant: 'outline',
          className: 'mt-1',
          attributes: [h.DataAttribute('host-retry', '')],
        },
        'Retry',
        h,
      ),
    ],
  )

/** The host-unreachable fallback: the state that replaces the shell when the host does not answer. */
export const view = defineView<Model, Message>((model, h) =>
  h.div(
    [h.DataAttribute('projects', ''), h.Class('w-full')],
    Match.value(model.host).pipe(
      Match.tagsExhaustive({
        Loading: (): ReadonlyArray<Html> => [],
        Loaded: ({ projects }): ReadonlyArray<Html> =>
          projects.length === 0
            ? []
            : [
                h.ul(
                  [
                    h.DataAttribute('projects-list', ''),
                    h.AriaLabel('Projects on this host'),
                    h.Class('flex flex-col gap-1.5'),
                  ],
                  projects.map((project) => projectRow(project, h)),
                ),
              ],
        Unreachable: ({ reason }): ReadonlyArray<Html> => [unreachableState(reason, h)],
      }),
    ),
  ),
)

const settingsRow = (model: Model, project: Project, h: HtmlBuilder<Message>): Html => {
  const edit = model.edit
  if (edit !== undefined && edit.project === project.id) return editRow(project, edit, h)
  if (model.deleting === project.id) return deleteRow(project, h)
  return h.div(
    [
      h.DataAttribute('projects-row', project.id),
      h.Class('flex items-center gap-2 rounded-xl py-1'),
    ],
    [
      h.span(
        [
          h.Class('cursor-grab text-muted-foreground/60'),
          h.DataAttribute('projects-drag', project.id),
        ],
        [icon(h, GripVertical, 'size-4')],
      ),
      h.a(
        [
          h.Href(settingsProjectDetailRouter({ projectId: project.id })),
          h.DataAttribute('projects-open', project.id),
          h.Class(
            'flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-accent/40',
          ),
        ],
        [
          icon(h, FolderGit, 'size-4 shrink-0 text-muted-foreground'),
          h.span(
            [h.Class('flex min-w-0 flex-1 flex-col gap-0.5')],
            [
              h.span(
                [
                  h.DataAttribute('projects-row-name', project.id),
                  h.Class('truncate text-sm font-medium'),
                ],
                [project.name],
              ),
              h.span([h.Class('truncate font-mono text-xs text-muted-foreground')], [project.cwd]),
            ],
          ),
          icon(h, ChevronRight, 'size-4 shrink-0 text-muted-foreground/60'),
        ],
      ),
    ],
  )
}

/** The delete confirm replaces the row, so Delete cannot be clicked twice. */
const deleteRow = (project: Project, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('projects-delete-confirm', project.id),
      h.Class('flex items-center justify-between gap-4 py-2.5'),
    ],
    [
      h.p(
        [h.Class('min-w-0 flex-1 truncate text-sm')],
        [`Delete "${project.name}"? Threads keep their history.`],
      ),
      h.div(
        [h.Class('flex shrink-0 gap-1')],
        [
          button(
            {
              onClick: Message.ClickedDeleteCancel(),
              variant: 'ghost',
              size: 'sm',
              attributes: [h.DataAttribute('projects-delete-cancel', project.id)],
            },
            'Keep',
            h,
          ),
          button(
            {
              onClick: Message.ClickedDeleteConfirm(),
              variant: 'destructive',
              size: 'sm',
              attributes: [h.DataAttribute('projects-delete-confirm-button', project.id)],
            },
            'Delete',
            h,
          ),
        ],
      ),
    ],
  )

/** One editor at a time, so the field ids can be fixed. */
const editRow = (project: Project, edit: Edit, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.DataAttribute('projects-edit-form', project.id), h.Class('flex flex-col gap-1 py-2.5')],
    [
      textRow(
        {
          id: 'settings-project-name',
          title: 'Name',
          value: edit.name,
          onInput: (value) => Message.ChangedEditField({ field: FIELDS.name, value }),
        },
        h,
      ),
      textRow(
        {
          id: 'settings-project-cwd',
          title: 'Cwd',
          description: 'The absolute directory every thread in this project runs in.',
          value: edit.cwd,
          onInput: (value) => Message.ChangedEditField({ field: FIELDS.cwd, value }),
          isMonospace: true,
        },
        h,
      ),
      h.div(
        [h.DataAttribute('projects-icon', '')],
        [
          textRow(
            {
              id: 'settings-project-icon',
              title: 'Logo',
              description: 'An icon URL or path for this project.',
              value: edit.icon,
              onInput: (value) => Message.ChangedEditField({ field: FIELDS.icon, value }),
              isMonospace: true,
            },
            h,
          ),
        ],
      ),
      ...(edit.refusal === undefined
        ? []
        : [
            h.p(
              [
                h.DataAttribute('projects-edit-error', project.id),
                h.Class('py-1 text-xs text-destructive'),
              ],
              [refusalText(edit.refusal)],
            ),
          ]),
      h.div(
        [h.Class('flex justify-end gap-1 py-1')],
        [
          button(
            {
              onClick: Message.ClickedEditCancel(),
              variant: 'ghost',
              size: 'sm',
              attributes: [h.DataAttribute('projects-cancel', project.id)],
            },
            'Cancel',
            h,
          ),
          button(
            {
              onClick: Message.ClickedEditSave(),
              variant: 'secondary',
              size: 'sm',
              isDisabled:
                edit.isSaving || edit.name.trim().length === 0 || edit.cwd.trim().length === 0,
              attributes: [h.DataAttribute('projects-save', project.id)],
            },
            edit.isSaving ? 'Saving…' : 'Save',
            h,
          ),
        ],
      ),
    ],
  )

/**
 * Settings → Projects. The same submodel at a second slot, so the page and the
 * chip read one host answer.
 */
export const settingsView = defineView<Model, Message>((model, h) =>
  h.div(
    [h.DataAttribute('settings-page', 'projects'), h.Class('flex flex-col gap-6')],
    [
      h.section(
        [h.AriaLabel('Projects')],
        [
          section(
            {
              title: 'Projects',
              action: button(
                {
                  onClick: Message.ClickedCreate(),
                  variant: 'outline',
                  size: 'sm',
                  attributes: [h.DataAttribute('projects-create-open', '')],
                },
                'Add a project',
                h,
              ),
            },
            h,
          ),
          projectsCard(model, h),
        ],
      ),
    ],
  ),
)

/**
 * The create dialogs, rendered once globally so every entry point — settings,
 * the composer chip, the project filter — opens the same flow. The browser
 * shows while a folder is being picked; the details dialog follows confirmation.
 */
export const dialogsView = defineView<Model, Message>((model, h) =>
  h.div(
    [h.DataAttribute('projects-dialogs', ''), h.Class('contents')],
    model.create === undefined
      ? []
      : model.create.browse === undefined
        ? [createDetailsDialog(model.create, h)]
        : [browseDialog(model.create, h)],
  ),
)

/** The details dialog, opened once a folder is confirmed in the picker. */
const createDetailsDialog = (create: Create, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('projects-create-dialog', ''),
      h.Class('fixed inset-0 z-50 flex items-center justify-center p-4'),
    ],
    [
      h.div([
        h.DataAttribute('projects-create-backdrop', ''),
        h.OnClick(Message.ClickedCreateCancel()),
        h.Class(
          'absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-100',
        ),
      ]),
      h.div(
        [
          h.DataAttribute('projects-create', ''),
          h.Attribute('role', 'dialog'),
          h.AriaLabel('New project'),
          h.Class(
            'relative flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-card p-5 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-100 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]',
          ),
        ],
        [
          h.div(
            [h.Class('flex items-start justify-between gap-4')],
            [
              h.div(
                [h.Class('flex min-w-0 flex-col gap-0.5')],
                [
                  h.h2([h.Class('text-base font-semibold')], ['New project']),
                  h.p(
                    [h.Class('truncate font-mono text-xs text-muted-foreground')],
                    [create.cwd === '' ? 'Choose a folder first.' : create.cwd],
                  ),
                ],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('projects-create-close', ''),
                  h.OnClick(Message.ClickedCreateCancel()),
                  h.AriaLabel('Close new project dialog'),
                  h.Class('shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent'),
                ],
                [icon(h, X, 'size-4')],
              ),
            ],
          ),
          textRow(
            {
              id: 'settings-project-create-name',
              title: 'Name',
              value: create.name,
              onInput: (value) => Message.ChangedCreateField({ field: FIELDS.name, value }),
            },
            h,
          ),
          textRow(
            {
              id: 'settings-project-create-cwd',
              title: 'Cwd',
              description: 'The absolute directory every thread in this project runs in.',
              value: create.cwd,
              onInput: (value) => Message.ChangedCreateField({ field: FIELDS.cwd, value }),
              isMonospace: true,
            },
            h,
          ),
          h.div(
            [h.DataAttribute('projects-icon', '')],
            [
              textRow(
                {
                  id: 'settings-project-create-icon',
                  title: 'Logo',
                  description: 'An icon URL or path for this project.',
                  value: create.icon,
                  onInput: (value) => Message.ChangedCreateField({ field: FIELDS.icon, value }),
                  isMonospace: true,
                },
                h,
              ),
            ],
          ),
          h.div(
            [h.Class('flex justify-start py-1')],
            [
              button(
                {
                  onClick: Message.ClickedCreateBrowse(),
                  variant: 'outline',
                  size: 'sm',
                  attributes: [h.DataAttribute('projects-browse', '')],
                },
                'Browse…',
                h,
              ),
            ],
          ),
          ...(create.refusal === undefined
            ? []
            : [
                h.p(
                  [
                    h.DataAttribute('projects-create-error', ''),
                    h.Class('py-1 text-xs text-destructive'),
                  ],
                  [cwdRefusalText(create.refusal)],
                ),
              ]),
          h.div(
            [h.Class('flex justify-end gap-1 py-1')],
            [
              button(
                {
                  onClick: Message.ClickedCreateCancel(),
                  variant: 'ghost',
                  size: 'sm',
                  attributes: [h.DataAttribute('projects-create-cancel', '')],
                },
                'Cancel',
                h,
              ),
              button(
                {
                  onClick: Message.ClickedCreateSave(),
                  variant: 'secondary',
                  size: 'sm',
                  isDisabled:
                    create.isSaving ||
                    create.name.trim().length === 0 ||
                    create.cwd.trim().length === 0,
                  attributes: [h.DataAttribute('projects-create-save', '')],
                },
                create.isSaving ? 'Creating…' : 'Create project',
                h,
              ),
            ],
          ),
        ],
      ),
    ],
  )

const browseBreadcrumb = (browse: Browse, h: HtmlBuilder<Message>): Html => {
  const path = browse.listing?.path ?? browse.path
  if (path === undefined) {
    return h.div(
      [h.DataAttribute('projects-breadcrumb', ''), h.Class('flex items-center gap-1 text-sm')],
      [h.span([h.Class('text-muted-foreground')], ['Reading…'])],
    )
  }
  const segments = breadcrumbSegments(path)
  return h.div(
    [
      h.DataAttribute('projects-breadcrumb', ''),
      h.Class('flex min-w-0 flex-1 items-center gap-1 truncate text-sm'),
    ],
    [
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('projects-parent-top', ''),
          h.OnClick(Message.OpenedParent()),
          h.AriaLabel('Go to parent directory'),
          h.Class('shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent'),
        ],
        [icon(h, ArrowUp, 'size-4')],
      ),
      h.span([h.Class('shrink-0 text-muted-foreground')], ['/']),
      ...segments.flatMap((segment, index) => {
        const last = index === segments.length - 1
        const node: Html =
          last || browse.listing === undefined
            ? h.span(
                [h.Class(last ? 'truncate font-medium' : 'shrink-0 text-muted-foreground')],
                [segment],
              )
            : h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('projects-breadcrumb-dir', segment),
                  h.OnClick(
                    Message.OpenedDirectory({
                      path: `/${segments.slice(0, index + 1).join('/')}`,
                    }),
                  ),
                  h.Class('shrink-0 text-muted-foreground hover:text-foreground hover:underline'),
                ],
                [segment],
              )
        return index === 0
          ? [node]
          : [h.span([h.Class('shrink-0 text-muted-foreground/60')], ['›']), node]
      }),
    ],
  )
}

/**
 * The directory list inside a fixed-height viewport, so arriving entries never
 * move the dialog. The list is keyed by its path, so each navigation mounts a
 * fresh element and its slide-and-fade runs once per listing.
 */
const browseListViewport = (browse: Browse, h: HtmlBuilder<Message>): Html => {
  const listing = browse.listing
  const directories = visibleDirectories(browse)
  if (browse.isLoading && listing === undefined) {
    return h.div(
      [h.Class('flex h-full items-center justify-center')],
      [
        h.p(
          [
            h.DataAttribute('projects-dirs-loading', ''),
            h.Class('text-sm text-muted-foreground motion-safe:animate-pulse'),
          ],
          ['Reading directories…'],
        ),
      ],
    )
  }
  if (listing === undefined) {
    return h.div(
      [h.Class('flex h-full items-center justify-center px-3')],
      [
        h.p(
          [h.DataAttribute('projects-dirs-error', ''), h.Class('text-xs text-destructive')],
          [browse.error === undefined ? 'Nothing here.' : directoryErrorText(browse.error)],
        ),
      ],
    )
  }
  const slide =
    browse.direction === 'back'
      ? 'motion-safe:slide-in-from-left-4'
      : 'motion-safe:slide-in-from-right-4'
  return h.div(
    [h.Class('relative flex h-full flex-col')],
    [
      // The stale listing stays mounted while the next one loads, so the
      // viewport never collapses; a floating pill names the wait instead.
      ...(browse.isLoading && listing !== undefined
        ? [
            h.p(
              [
                h.DataAttribute('projects-dirs-loading', ''),
                h.Class(
                  'absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground shadow-sm motion-safe:animate-pulse',
                ),
              ],
              ['Loading…'],
            ),
          ]
        : []),
      ...(browse.error === undefined
        ? []
        : [
            h.p(
              [
                h.DataAttribute('projects-dirs-error', ''),
                h.Class('shrink-0 px-3 py-2 text-xs text-destructive'),
              ],
              [directoryErrorText(browse.error)],
            ),
          ]),
      h.keyed('div')(
        listing.path,
        [
          h.DataAttribute('projects-dirs-list', listing.path),
          h.Class(
            `min-h-0 flex-1 overflow-y-auto motion-safe:animate-in motion-safe:fade-in-0 ${slide} motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]`,
          ),
        ],
        [
          ...(listing.parent === undefined
            ? []
            : [
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('projects-parent', ''),
                    h.OnClick(Message.OpenedParent()),
                    h.Class(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent',
                    ),
                  ],
                  ['../'],
                ),
              ]),
          ...(directories.length === 0
            ? [
                h.p(
                  [
                    h.DataAttribute('projects-dirs-empty', ''),
                    h.Class('px-3 py-6 text-center text-sm text-muted-foreground'),
                  ],
                  ['No folders here.'],
                ),
              ]
            : []),
          ...directories.map((entry) =>
            h.button(
              [
                h.Type('button'),
                h.DataAttribute('projects-dir', entry.path),
                h.OnClick(Message.OpenedDirectory({ path: entry.path })),
                h.OnMouseEnter(Message.HoveredDirectory({ path: entry.path })),
                h.Class(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                ),
              ],
              [
                icon(h, Folder, 'size-4 shrink-0 text-muted-foreground'),
                h.span([h.Class('min-w-0 flex-1 truncate')], [entry.name]),
                icon(h, ChevronRight, 'size-4 shrink-0 text-muted-foreground/50'),
              ],
            ),
          ),
        ],
      ),
    ],
  )
}

/** The directory browser as a modal dialog over the settings page. */
const browseDialog = (create: Create, h: HtmlBuilder<Message>): Html => {
  const browse = create.browse
  if (browse === undefined) {
    return h.div([], [])
  }
  const cwd = browse.listing?.path ?? browse.path
  const suggested = cwd === undefined ? '' : deriveProjectName(cwd)
  return h.div(
    [
      h.DataAttribute('projects-dialog', ''),
      h.Class('fixed inset-0 z-50 flex items-center justify-center p-4'),
    ],
    [
      h.div([
        h.DataAttribute('projects-dialog-backdrop', ''),
        h.OnClick(Message.ClickedBrowseClose()),
        h.Class(
          'absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-100',
        ),
      ]),
      h.div(
        [
          h.DataAttribute('projects-dirs', ''),
          h.Attribute('role', 'dialog'),
          h.AriaLabel('Add project'),
          h.Class(
            'relative flex max-h-[80vh] w-full max-w-lg flex-col gap-3 rounded-xl bg-card p-5 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-100 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]',
          ),
        ],
        [
          h.div(
            [h.Class('flex items-start justify-between gap-4')],
            [
              h.div(
                [h.Class('flex min-w-0 flex-col gap-0.5')],
                [
                  h.h2([h.Class('text-base font-semibold')], ['Add project']),
                  h.p(
                    [h.Class('text-sm text-muted-foreground')],
                    ['Browse to the project folder, or edit the path directly.'],
                  ),
                ],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('projects-dialog-close', ''),
                  h.OnClick(Message.ClickedBrowseClose()),
                  h.AriaLabel('Close directory browser'),
                  h.Class('shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent'),
                ],
                [icon(h, X, 'size-4')],
              ),
            ],
          ),
          h.div(
            [h.Class('flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5')],
            [
              browseBreadcrumb(browse, h),
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('projects-browse-edit-path', ''),
                  h.OnClick(Message.ClickedBrowseEditPath()),
                  h.AriaLabel('Edit the path directly'),
                  h.Class('shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent'),
                ],
                [icon(h, Pencil, 'size-4')],
              ),
            ],
          ),
          h.div(
            [h.Class('h-64 shrink-0 overflow-hidden rounded-lg border border-border/60')],
            [browseListViewport(browse, h)],
          ),
          ...(suggested.length === 0
            ? []
            : [
                h.p(
                  [h.Class('text-sm text-muted-foreground')],
                  [
                    'Project name: ',
                    h.span(
                      [
                        h.DataAttribute('projects-suggested-name', ''),
                        h.Class('font-medium text-foreground'),
                      ],
                      [create.name.trim().length === 0 ? suggested : create.name],
                    ),
                  ],
                ),
              ]),
          h.div(
            [h.Class('flex justify-end gap-1')],
            [
              button(
                {
                  onClick: Message.ClickedBrowseClose(),
                  variant: 'ghost',
                  size: 'sm',
                  attributes: [h.DataAttribute('projects-dialog-cancel', '')],
                },
                'Cancel',
                h,
              ),
              button(
                {
                  onClick: Message.ClickedUseDirectory(),
                  variant: 'secondary',
                  size: 'sm',
                  isDisabled: browse.isLoading || cwd === undefined,
                  attributes: [h.DataAttribute('projects-use-dir', '')],
                },
                'Add project',
                h,
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const projectsCard = (model: Model, h: HtmlBuilder<Message>): Html =>
  card(
    Match.value(model.host).pipe(
      Match.tagsExhaustive({
        Loading: (): ReadonlyArray<Html> => [
          h.p(
            [
              h.DataAttribute('projects-loading', ''),
              h.Class('px-4 py-6 text-sm text-muted-foreground'),
            ],
            ['Reading this host’s projects…'],
          ),
        ],
        // A host that did not answer replaces the shell, so this arm never
        // renders; it stays explicit rather than throwing.
        Unreachable: (): ReadonlyArray<Html> => [
          h.p(
            [
              h.DataAttribute('projects-settings-silent', ''),
              h.Class('px-4 py-6 text-sm text-muted-foreground'),
            ],
            ['This host did not answer.'],
          ),
        ],
        Loaded: ({ projects }): ReadonlyArray<Html> =>
          projects.length === 0
            ? [
                h.p(
                  [
                    h.DataAttribute('projects-settings-empty', ''),
                    h.Class('px-4 py-6 text-sm text-muted-foreground'),
                  ],
                  [
                    'This host has recorded no projects. Create one from the composer’s project chip.',
                  ],
                ),
              ]
            : [
                h.div(
                  [h.DataAttribute('projects-list', ''), h.Class('flex flex-col gap-1 px-4 py-2')],
                  projects.map((project) => settingsRow(model, project, h)),
                ),
              ],
      }),
    ),
    h,
    [h.Class('divide-y divide-border/60')],
  )

const infoRow = (label: string, value: string, h: HtmlBuilder<Message>, isMono = false): Html =>
  h.div(
    [h.Class('flex items-center justify-between gap-4 py-2.5')],
    [
      h.span([h.Class('shrink-0 text-sm')], [label]),
      h.span(
        [
          h.Class(
            `min-w-0 truncate text-sm text-muted-foreground${isMono ? ' font-mono text-xs' : ''}`,
          ),
        ],
        [value],
      ),
    ],
  )

/**
 * One project, when the route names it. The header answers what the list
 * promised, and the cards below answer what the host knows: where the project
 * lives, what new threads start with, and the facts that identify it.
 */
export const detailView = defineView<Model, Message>((model, h) => {
  const selected = model.detail
  const listed = selected === undefined ? undefined : projectOf(model, selected.project)
  const detail = selected?.detail
  const name = detail?.project.name ?? listed?.name ?? 'Project'
  const subtitle =
    detail === undefined
      ? (listed?.cwd ?? '')
      : `${detail.project.cwd} · 1 machine · ${String(detail.threadCount)} ${detail.threadCount === 1 ? 'thread' : 'threads'}`
  return h.div(
    [h.DataAttribute('settings-page', 'project-detail'), h.Class('flex flex-col gap-6')],
    [
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          h.a(
            [
              h.Href(settingsProjectsRouter()),
              h.DataAttribute('project-detail-back', ''),
              h.Class('w-fit text-sm text-muted-foreground hover:text-foreground hover:underline'),
            ],
            ['‹ Projects'],
          ),
          h.div(
            [h.Class('flex items-center justify-between gap-4')],
            [
              h.div(
                [h.Class('flex min-w-0 items-center gap-2')],
                [
                  icon(h, FolderGit, 'size-4 shrink-0 text-muted-foreground'),
                  h.h2(
                    [
                      h.DataAttribute('project-detail-name', ''),
                      h.Class('truncate text-base font-semibold'),
                    ],
                    [name],
                  ),
                ],
              ),
              ...(selected === undefined || listed === undefined
                ? []
                : [
                    button(
                      {
                        onClick: Message.ClickedDelete({ project: listed.id }),
                        variant: 'ghost',
                        size: 'sm',
                        attributes: [h.DataAttribute('project-detail-menu', listed.id)],
                      },
                      '···',
                      h,
                    ),
                  ]),
            ],
          ),
          h.p(
            [
              h.DataAttribute('project-detail-subtitle', ''),
              h.Class('truncate text-xs text-muted-foreground'),
            ],
            [subtitle],
          ),
        ],
      ),
      ...(selected === undefined
        ? [
            h.p(
              [
                h.DataAttribute('project-detail-missing', ''),
                h.Class('text-sm text-muted-foreground'),
              ],
              ['Select a project from the list.'],
            ),
          ]
        : selected.isLoading || detail === undefined
          ? [
              h.p(
                [
                  h.DataAttribute('project-detail-loading', ''),
                  h.Class('text-sm text-muted-foreground'),
                ],
                [selected.reason === undefined ? 'Reading this project…' : selected.reason],
              ),
            ]
          : [
              h.section(
                [h.AriaLabel('Checkouts')],
                [
                  section({ title: 'Checkouts' }, h),
                  h.p(
                    [h.Class('mb-2 text-xs text-muted-foreground')],
                    ['Where this project lives on each machine.'],
                  ),
                  card(
                    [
                      h.div(
                        [h.Class('flex items-center justify-between gap-4 px-4 py-2.5')],
                        [
                          h.div(
                            [h.Class('flex min-w-0 flex-col gap-0.5')],
                            [
                              h.span([h.Class('text-sm')], [`● ${detail.checkout.machine}`]),
                              h.span(
                                [h.Class('truncate font-mono text-xs text-muted-foreground')],
                                [detail.checkout.path],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                    h,
                  ),
                ],
              ),
              h.section(
                [h.AriaLabel('Thread defaults')],
                [
                  section({ title: 'Thread defaults' }, h),
                  h.p(
                    [h.Class('mb-2 text-xs text-muted-foreground')],
                    ['What new threads in this project start with.'],
                  ),
                  card(
                    [
                      h.div(
                        [h.Class('divide-y divide-border/60 px-4')],
                        detail.threadDefaults === undefined
                          ? [
                              h.p(
                                [h.Class('py-4 text-sm text-muted-foreground')],
                                ['No threads yet. Defaults appear after the first thread.'],
                              ),
                            ]
                          : [
                              infoRow('Provider', detail.threadDefaults.harness ?? 'Default', h),
                              infoRow('Model', detail.threadDefaults.model ?? 'Default', h),
                              infoRow('Reasoning', detail.threadDefaults.reasoning ?? 'Default', h),
                            ],
                      ),
                    ],
                    h,
                  ),
                ],
              ),
              h.section(
                [h.AriaLabel('Project information')],
                [
                  section({ title: 'Project information' }, h),
                  card(
                    [
                      h.div(
                        [h.Class('divide-y divide-border/60 px-4')],
                        [
                          infoRow('Git remote', detail.gitRemote ?? 'Not a git checkout', h, true),
                          infoRow('Project ID', detail.project.id, h, true),
                          infoRow('Created', relativeTime(detail.createdAt), h),
                        ],
                      ),
                    ],
                    h,
                  ),
                ],
              ),
              ...(model.edit !== undefined && model.edit.project === detail.project.id
                ? [editRow(detail.project, model.edit, h)]
                : [
                    h.div(
                      [h.Class('flex justify-start gap-1')],
                      [
                        button(
                          {
                            onClick: Message.ClickedEdit({ project: detail.project.id }),
                            variant: 'outline',
                            size: 'sm',
                            attributes: [h.DataAttribute('projects-edit', detail.project.id)],
                          },
                          'Edit',
                          h,
                        ),
                      ],
                    ),
                  ]),
              h.section(
                [h.AriaLabel('Danger zone')],
                [
                  section({ title: 'Danger zone' }, h),
                  h.p(
                    [h.Class('mb-2 text-xs text-muted-foreground')],
                    [
                      `Deleting ${detail.project.name} removes the project and every thread in it. Checkouts stay on disk.`,
                    ],
                  ),
                  card(
                    [
                      h.div(
                        [h.Class('px-4 py-3')],
                        model.deleting === detail.project.id
                          ? [
                              h.div(
                                [
                                  h.DataAttribute('projects-delete-confirm', detail.project.id),
                                  h.Class('flex items-center justify-between gap-4'),
                                ],
                                [
                                  h.p([h.Class('text-sm')], [`Delete "${detail.project.name}"?`]),
                                  h.div(
                                    [h.Class('flex shrink-0 gap-1')],
                                    [
                                      button(
                                        {
                                          onClick: Message.ClickedDeleteCancel(),
                                          variant: 'ghost',
                                          size: 'sm',
                                          attributes: [
                                            h.DataAttribute(
                                              'projects-delete-cancel',
                                              detail.project.id,
                                            ),
                                          ],
                                        },
                                        'Keep',
                                        h,
                                      ),
                                      button(
                                        {
                                          onClick: Message.ClickedDeleteConfirm(),
                                          variant: 'destructive',
                                          size: 'sm',
                                          attributes: [
                                            h.DataAttribute(
                                              'projects-delete-confirm-button',
                                              detail.project.id,
                                            ),
                                          ],
                                        },
                                        'Delete project',
                                        h,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ]
                          : [
                              button(
                                {
                                  onClick: Message.ClickedDelete({
                                    project: detail.project.id,
                                  }),
                                  variant: 'destructive',
                                  size: 'sm',
                                  attributes: [
                                    h.DataAttribute('projects-delete', detail.project.id),
                                  ],
                                },
                                'Delete project',
                                h,
                              ),
                            ],
                      ),
                    ],
                    h,
                  ),
                ],
              ),
            ]),
    ],
  )
})
