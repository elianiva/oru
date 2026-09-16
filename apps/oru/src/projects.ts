/**
 * The host's projects, as the app knows them.
 *
 * `ListProjects` is the app's first call and its liveness probe: the state this
 * model is in is the state the app is in. A host that does not answer, or
 * answers that it has no projects, is a fact to render — with a retry — not a
 * defect to die on.
 *
 * This model owns the create and edit drafts too, so the chip's form and the
 * settings page edit one host answer instead of keeping copies of it.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'
import { FolderGit, Plus } from 'lucide'
import { ProjectId } from '@oru/kernel'
import { Project } from '@oru/rpc'
import { button } from '@/components/ui/button.ts'
import { Empty } from '@/components/ui/empty.ts'
import { icon } from '@/lib/icons.ts'
import { card, section, textRow } from '@/settings/controls.ts'
import type { ComposerChip, ComposerChipOption, ComposerChipPanel } from './composer.ts'

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
export const UnknownProject = Schema.TaggedStruct('UnknownProject', { project: ProjectId })
export const Refusal = Schema.Union([RelativeCwd, UnknownProject])
export type RelativeCwd = typeof RelativeCwd.Type
export type UnknownProject = typeof UnknownProject.Type
export type Refusal = typeof Refusal.Type

/**
 * The composer chip's panel. Presence of a draft is what makes the panel a
 * form, so "the form is open" and "a draft exists" cannot disagree.
 */
export const PanelClosed = Schema.TaggedStruct('PanelClosed', {})
export const PanelBrowsing = Schema.TaggedStruct('PanelBrowsing', {})
export const PanelComposing = Schema.TaggedStruct('PanelComposing', {
  name: Schema.String,
  cwd: Schema.String,
  refusal: Schema.UndefinedOr(RelativeCwd),
  isSaving: Schema.Boolean,
})
export const CreatePanel = Schema.Union([PanelClosed, PanelBrowsing, PanelComposing])
export type CreatePanel = typeof CreatePanel.Type

/** One settings row in edit mode, seeded from the host's own row. */
export const Edit = Schema.Struct({
  project: ProjectId,
  name: Schema.String,
  cwd: Schema.String,
  refusal: Schema.UndefinedOr(Refusal),
  isSaving: Schema.Boolean,
})
export type Edit = typeof Edit.Type

export const Model = Schema.Struct({
  host: Host,
  /**
   * The project the composer points at, as an id. A name is read back out of
   * `host` on every render, so a row the host no longer lists stops resolving
   * instead of being rendered from a stale copy.
   */
  selected: Schema.UndefinedOr(ProjectId),
  panel: CreatePanel,
  edit: Schema.UndefinedOr(Edit),
})
export type Model = typeof Model.Type

export const CHIP_ID = 'project'
/** The menu row that opens the compose form. */
export const CREATE_ROW = 'new-project'
export const FIELDS = { name: 'name', cwd: 'cwd' } as const
export type Field = (typeof FIELDS)[keyof typeof FIELDS]

export const isField = (value: string): value is Field =>
  value === FIELDS.name || value === FIELDS.cwd

export const Message = defineMessageUnion({
  // The host's answers.
  ProjectsArrived: { projects: Schema.Array(Project) },
  HostUnreachable: { reason: Schema.String },
  ProjectCreated: { project: Project },
  ProjectUpdated: { project: Project },
  CreateRefused: { refusal: RelativeCwd },
  UpdateRefused: { refusal: Refusal },

  // The composer chip. Root routes these by chip id, so the id stops there.
  ToggledCreatePanel: {},
  ChangedCreateField: { field: Schema.String, value: Schema.String },
  SelectedCreateOption: { option: Schema.String },
  CanceledCreate: {},
  SubmittedCreate: {},

  // Settings → Projects, this same submodel at another slot.
  ClickedEdit: { project: ProjectId },
  ChangedEditField: { field: Schema.String, value: Schema.String },
  ClickedEditSave: {},
  ClickedEditCancel: {},

  ClickedRetry: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedRetry: {},
  RequestedCreate: { name: Schema.NonEmptyString, cwd: Schema.NonEmptyString },
  RequestedUpdate: {
    project: ProjectId,
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
  },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  host: Loading.make({}),
  selected: undefined,
  panel: PanelClosed.make({}),
  edit: undefined,
})

/** Retry puts the host member back to `Loading`; a draft is not the answer that failed. */
export const retrying = (model: Model): Model => evo(model, { host: () => Loading.make({}) })

export const isUnreachable = (model: Model): boolean =>
  Predicate.isTagged(model.host, 'Unreachable')

/** The host's projects, or nothing while it has not answered. */
export const projectsOf = (model: Model): ReadonlyArray<Project> =>
  Predicate.isTagged(model.host, 'Loaded') ? model.host.projects : []

/** The project the user pointed the composer at, if they have picked one yet. */
export const chosenProject = (model: Model): Project | undefined =>
  projectsOf(model).find((project) => project.id === model.selected)

/**
 * The project the chip names and a thread would run in: the one the user picked
 * while the host still lists it, otherwise the host's first, the way the harness
 * registry resolves `preferred()` for a thread that names no harness. Nothing is
 * stored by that fallback, so the menu marks only a pick.
 */
export const selectedProject = (model: Model): Project | undefined =>
  chosenProject(model) ?? projectsOf(model)[0]

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
 * A host that stopped answering is not a write in flight, so neither draft stays
 * pending through the retry that follows.
 */
const settled = (model: Model): Model =>
  evo(model, {
    edit: (edit) => (edit === undefined ? edit : evo(edit, { isSaving: () => false })),
    panel: (panel) =>
      Predicate.isTagged(panel, 'PanelComposing')
        ? PanelComposing.make({ ...panel, isSaving: false })
        : panel,
  })

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/**
 * A draft the host owes an answer for. It cannot be dismissed, replaced, or
 * amended while the write is in flight, so an answer can only reach the draft
 * that made the request: a refusal lands on the form that asked for it and never
 * on one that replaced it.
 */
const isPending = (panel: CreatePanel): boolean =>
  Predicate.isTagged(panel, 'PanelComposing') && panel.isSaving

const editIsPending = (model: Model): boolean => model.edit?.isSaving === true

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ProjectsArrived: ({ projects }) => ({
      model: evo(model, { host: () => Loaded.make({ projects }) }),
    }),
    HostUnreachable: ({ reason }) => ({
      model: settled(evo(model, { host: () => Unreachable.make({ reason }) })),
    }),
    ProjectCreated: ({ project }) => ({
      model: evo(model, {
        host: (host) => upserted(host, project),
        selected: () => project.id,
        panel: () => PanelClosed.make({}),
      }),
    }),
    ProjectUpdated: ({ project }) => ({
      model: evo(model, {
        host: (host) => upserted(host, project),
        edit: () => undefined,
      }),
    }),
    CreateRefused: ({ refusal }) =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          PanelComposing: (composing) => ({
            model: evo(model, {
              panel: () =>
                PanelComposing.make({
                  ...composing,
                  refusal,
                  isSaving: false,
                }),
            }),
          }),
          PanelClosed: () => ({ model }),
          PanelBrowsing: () => ({ model }),
        }),
      ),
    UpdateRefused: ({ refusal }) => {
      const edit = model.edit
      return {
        model:
          edit === undefined
            ? model
            : evo(model, { edit: () => ({ ...edit, refusal, isSaving: false }) }),
      }
    },

    ToggledCreatePanel: () => {
      if (isPending(model.panel)) return { model }
      return {
        model: evo(model, {
          panel: (panel) =>
            Predicate.isTagged(panel, 'PanelClosed')
              ? PanelBrowsing.make({})
              : PanelClosed.make({}),
        }),
      }
    },
    ChangedCreateField: ({ field, value }) => {
      if (!isField(field) || isPending(model.panel)) return { model }
      return Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          // The refusal answered the old text, so editing retires it.
          PanelComposing: (composing) => ({
            model: evo(model, {
              panel: () =>
                PanelComposing.make({
                  ...composing,
                  ...(field === FIELDS.name ? { name: value } : { cwd: value }),
                  refusal: undefined,
                }),
            }),
          }),
          PanelClosed: () => ({ model }),
          PanelBrowsing: () => ({ model }),
        }),
      )
    },
    SelectedCreateOption: ({ option }) => {
      if (isPending(model.panel)) return { model }
      if (option === CREATE_ROW) {
        return {
          model: evo(model, {
            panel: () =>
              PanelComposing.make({ name: '', cwd: '', refusal: undefined, isSaving: false }),
          }),
        }
      }
      // An id no host answer carries is not a selection.
      if (!projectsOf(model).some((project) => project.id === option)) return { model }
      return { model: evo(model, { selected: () => option, panel: () => PanelClosed.make({}) }) }
    },
    CanceledCreate: () => {
      if (isPending(model.panel)) return { model }
      return { model: evo(model, { panel: () => PanelClosed.make({}) }) }
    },
    SubmittedCreate: () =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          PanelComposing: (composing) => {
            const name = composing.name.trim()
            const cwd = composing.cwd.trim()
            // The wire's own precondition, not a second opinion about what a
            // host accepts: which cwd *is* acceptable stays the host's answer.
            if (composing.isSaving || name.length === 0 || cwd.length === 0) return { model }
            return {
              model: evo(model, {
                panel: () =>
                  PanelComposing.make({ ...composing, refusal: undefined, isSaving: true }),
              }),
              outMessage: OutMessage.RequestedCreate({ name, cwd }),
            }
          },
          PanelClosed: () => ({ model }),
          PanelBrowsing: () => ({ model }),
        }),
      ),

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
            ...(field === FIELDS.name ? { name: value } : { cwd: value }),
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
      if (name.length === 0 || cwd.length === 0) return { model }
      return {
        model: evo(model, { edit: () => ({ ...edit, isSaving: true, refusal: undefined }) }),
        outMessage: OutMessage.RequestedUpdate({ project: edit.project, name, cwd }),
      }
    },
    ClickedEditCancel: () => {
      if (editIsPending(model)) return { model }
      return { model: evo(model, { edit: () => undefined }) }
    },

    ClickedRetry: () => ({ model: retrying(model), outMessage: OutMessage.RequestedRetry() }),
  })

/** One menu row: a project the host lists, or the way into a new one. */
type ChipRow = Readonly<{
  id: string
  kind: 'project' | 'create'
  label: string
  description?: string | undefined
  isSelected?: boolean | undefined
}>

const chipRows = (model: Model): ReadonlyArray<ChipRow> => {
  if (!Predicate.isTagged(model.host, 'Loaded')) return []
  const chosen = chosenProject(model)
  return [
    ...model.host.projects.map((project): ChipRow => ({
      id: project.id,
      kind: 'project',
      label: project.name,
      description: project.cwd,
      isSelected: chosen?.id === project.id,
    })),
    { id: CREATE_ROW, kind: 'create', label: 'New project…' },
  ]
}

const chipLabel = (model: Model): string =>
  Predicate.isTagged(model.host, 'Loaded')
    ? (selectedProject(model)?.name ?? 'No project')
    : 'Project'

const hostMenu = (model: Model): ComposerChipPanel => ({
  kind: 'menu',
  options: chipRows(model).map((row): ComposerChipOption => ({
    id: row.id,
    label: row.label,
    description: row.description,
    isSelected: row.isSelected,
    isSeparated: row.kind === 'create',
    icon: row.kind === 'create' ? Plus : undefined,
  })),
  note: Predicate.isTagged(model.host, 'Loading') ? 'Reading the host’s projects…' : undefined,
})

const newProjectForm = (composing: typeof PanelComposing.Type): ComposerChipPanel => ({
  kind: 'form',
  title: 'New project',
  fields: [
    {
      id: FIELDS.name,
      label: 'Name',
      value: composing.name,
      placeholder: 'oru',
      isMonospace: false,
    },
    {
      id: FIELDS.cwd,
      label: 'Cwd',
      value: composing.cwd,
      placeholder: '/Users/you/code/oru',
      isMonospace: true,
    },
  ],
  submitLabel: composing.isSaving ? 'Creating…' : 'Create project',
  cancelLabel: 'Cancel',
  isCancelDisabled: composing.isSaving,
  isSubmitDisabled:
    composing.isSaving || composing.name.trim().length === 0 || composing.cwd.trim().length === 0,
  error: composing.refusal === undefined ? undefined : cwdRefusalText(composing.refusal),
})

/**
 * This submodel's own chip, in the composer's vocabulary. Built here, next to
 * the state it is derived from.
 */
export const chip = (model: Model): ComposerChip => {
  const panel = Match.value(model.panel).pipe(
    Match.tagsExhaustive({
      PanelClosed: (): ComposerChipPanel | undefined => undefined,
      PanelBrowsing: () => hostMenu(model),
      PanelComposing: (composing) => newProjectForm(composing),
    }),
  )
  return {
    id: CHIP_ID,
    label: chipLabel(model),
    icon: FolderGit,
    isOpen: panel !== undefined,
    panel,
  }
}

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

const emptyState = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.DataAttribute('projects-empty', ''), h.Class('flex-none')],
    [
      Empty(
        { className: 'flex-none' },
        [
          Empty.header(
            {},
            [
              Empty.media({ variant: 'icon' }, [icon(h, FolderGit, 'size-4')], h),
              Empty.title({}, ['No projects yet'], h),
              Empty.description({}, ['This host has recorded no projects.'], h),
            ],
            h,
          ),
        ],
        h,
      ),
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
            ? [emptyState(h)]
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
  return edit !== undefined && edit.project === project.id
    ? editRow(project, edit, h)
    : h.div(
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
        ],
      )
}

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
        [section({ title: 'Projects' }, h), projectsCard(model, h)],
      ),
    ],
  ),
)

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
