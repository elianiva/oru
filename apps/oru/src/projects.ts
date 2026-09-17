/**
 * The host's projects, as the app knows them.
 *
 * `ListProjects` is the app's first call and its liveness probe: the state this
 * model is in is the state the app is in. A host that does not answer, or
 * answers that it has no projects, is a fact to render — with a retry — not a
 * defect to die on.
 *
 * This model owns the host answer and the settings edit draft. The composer's
 * project picker owns its own selection and create draft next to the state
 * they derive from, and reads the list this model holds.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'
import { FolderGit } from 'lucide'
import { ProjectId } from '@oru/kernel'
import { DirectoryListing, Project } from '@oru/rpc'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'
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

/** The directory browser inside the create form, when it is open. */
export const Browse = Schema.Struct({
  path: Schema.UndefinedOr(Schema.String),
  listing: Schema.UndefinedOr(DirectoryListing),
  isLoading: Schema.Boolean,
  error: Schema.UndefinedOr(DirectoryError),
})
export type Browse = typeof Browse.Type

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

export const Model = Schema.Struct({
  host: Host,
  edit: Schema.UndefinedOr(Edit),
  create: Schema.UndefinedOr(Create),
  deleting: Schema.UndefinedOr(ProjectId),
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

  // The create form's directory browser.
  OpenedDirectory: { path: Schema.String },
  OpenedParent: {},
  ClickedUseDirectory: {},
  DirectoryArrived: { listing: DirectoryListing },
  DirectoryFailed: { error: DirectoryError },

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
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  host: Loading.make({}),
  edit: undefined,
  create: undefined,
  deleting: undefined,
})

/** Retry puts the host member back to `Loading`; a draft is not the answer that failed. */
export const retrying = (model: Model): Model => evo(model, { host: () => Loading.make({}) })

export const isUnreachable = (model: Model): boolean =>
  Predicate.isTagged(model.host, 'Unreachable')

/** The host's projects, or nothing while it has not answered. */
export const projectsOf = (model: Model): ReadonlyArray<Project> =>
  Predicate.isTagged(model.host, 'Loaded') ? model.host.projects : []

export const isLoading = (model: Model): boolean => Predicate.isTagged(model.host, 'Loading')

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

/**
 * A host that stopped answering is not a write in flight, so the edit does
 * not stay pending through the retry that follows.
 */
const settled = (model: Model): Model =>
  evo(model, {
    edit: (edit) => (edit === undefined ? edit : evo(edit, { isSaving: () => false })),
    create: (create) => (create === undefined ? create : evo(create, { isSaving: () => false })),
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
      model: evo(model, { host: (host) => upserted(host, project), create: () => undefined }),
    }),
    ProjectUpdated: ({ project }) => ({
      model: evo(model, {
        host: (host) => upserted(host, project),
        edit: () => undefined,
      }),
    }),
    ProjectDeleted: ({ project }) => ({
      model: evo(model, {
        host: (host) =>
          Predicate.isTagged(host, 'Loaded')
            ? Loaded.make({ projects: host.projects.filter((entry) => entry.id !== project) })
            : host,
        deleting: (deleting) => (deleting === project ? undefined : deleting),
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
            browse: undefined,
          }),
        }),
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
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path,
              listing: undefined,
              isLoading: true,
              error: undefined,
            }),
          }),
        }),
        outMessage: OutMessage.RequestedDirectory({ path }),
      }
    },
    OpenedParent: () => {
      const create = model.create
      const parent = create?.browse?.listing?.parent
      if (create === undefined || create.isSaving || parent === undefined) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: parent,
              listing: undefined,
              isLoading: true,
              error: undefined,
            }),
          }),
        }),
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
    DirectoryArrived: ({ listing }) => {
      const create = model.create
      const browse = create?.browse
      if (create === undefined || browse === undefined) return { model }
      return {
        model: evo(model, {
          create: () => ({
            ...create,
            browse: Browse.make({
              path: listing.path,
              listing,
              isLoading: false,
              error: undefined,
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
            }),
          }),
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

/** The hero's project list: the host's answer, or the state that replaces the shell. */
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
      h.Class('flex items-center justify-between gap-4 py-2.5'),
    ],
    [
      h.div(
        [h.Class('flex min-w-0 flex-col gap-0.5')],
        [
          h.span(
            [h.DataAttribute('projects-row-name', project.id), h.Class('truncate text-sm')],
            [project.name],
          ),
          h.span([h.Class('truncate font-mono text-xs text-muted-foreground')], [project.cwd]),
        ],
      ),
      h.div(
        [h.Class('flex shrink-0 gap-1')],
        [
          button(
            {
              onClick: Message.ClickedEdit({ project: project.id }),
              variant: 'outline',
              size: 'sm',
              attributes: [h.DataAttribute('projects-edit', project.id)],
            },
            'Edit',
            h,
          ),
          button(
            {
              onClick: Message.ClickedDelete({ project: project.id }),
              variant: 'ghost',
              size: 'sm',
              attributes: [h.DataAttribute('projects-delete', project.id)],
            },
            'Delete',
            h,
          ),
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
                'New project',
                h,
              ),
            },
            h,
          ),
          ...(model.create === undefined ? [] : [createCard(model.create, h)]),
          projectsCard(model, h),
        ],
      ),
    ],
  ),
)

/** The settings page's own create form, with a Browse button for the cwd. */
const createCard = (create: Create, h: HtmlBuilder<Message>): Html =>
  card(
    [
      h.div(
        [h.DataAttribute('projects-create', ''), h.Class('flex flex-col gap-1 px-4 py-2')],
        [
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
          ...(create.browse === undefined ? [] : [browseView(create.browse, h)]),
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
    h,
  )

const browseView = (browse: Browse, h: HtmlBuilder<Message>): Html => {
  const directories = (browse.listing?.entries ?? []).filter((entry) => entry.isDirectory)
  return h.div(
    [h.DataAttribute('projects-dirs', ''), h.Class('flex flex-col gap-px py-1')],
    [
      h.p(
        [h.Class('truncate font-mono text-xs text-muted-foreground')],
        [browse.listing?.path ?? browse.path ?? 'Reading…'],
      ),
      ...(browse.isLoading
        ? [
            h.p(
              [
                h.DataAttribute('projects-dirs-loading', ''),
                h.Class('py-2 text-xs text-muted-foreground'),
              ],
              ['Reading directories…'],
            ),
          ]
        : []),
      ...(browse.error === undefined
        ? []
        : [
            h.p(
              [
                h.DataAttribute('projects-dirs-error', ''),
                h.Class('py-1 text-xs text-destructive'),
              ],
              [directoryErrorText(browse.error)],
            ),
          ]),
      ...(!browse.isLoading && browse.listing !== undefined
        ? [
            ...(browse.listing.parent === undefined
              ? []
              : [
                  h.button(
                    [
                      h.Type('button'),
                      h.DataAttribute('projects-parent', ''),
                      h.OnClick(Message.OpenedParent()),
                      h.Class(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent',
                      ),
                    ],
                    ['../'],
                  ),
                ]),
            ...directories.map((entry) =>
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('projects-dir', entry.path),
                  h.OnClick(Message.OpenedDirectory({ path: entry.path })),
                  h.Class(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                  ),
                ],
                [entry.name],
              ),
            ),
            h.div(
              [h.Class('flex justify-end py-1')],
              [
                button(
                  {
                    onClick: Message.ClickedUseDirectory(),
                    variant: 'secondary',
                    size: 'sm',
                    isDisabled:
                      browse.isLoading || (browse.listing?.path ?? browse.path) === undefined,
                    attributes: [h.DataAttribute('projects-use-dir', '')],
                  },
                  'Use this directory',
                  h,
                ),
              ],
            ),
          ]
        : []),
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
            : projects.map((project) => settingsRow(model, project, h)),
      }),
    ),
    h,
    [h.Class('divide-y divide-border/60 px-4')],
  )
