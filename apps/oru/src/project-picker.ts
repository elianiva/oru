/**
 * The composer's project picker: the chip, its menu, its directory browser,
 * and its create form.
 *
 * This submodel owns the picker's UI and the selection: which project the
 * composer points at, whether the panel is open, and the create draft. The
 * host's project list arrives through `viewInputs` — the `Projects` submodel
 * stays the host truth — and the host's answers to a create arrive as
 * messages root forwards. A name is read back out of the list on every
 * render, so a row the host no longer lists stops resolving instead of being
 * rendered from a stale copy.
 *
 * Creating is two steps, like a checkout line: first the directory browser
 * names the cwd, then the details form names the project. The browser is a
 * panel state, not a flag next to one, so the menu, the browser, and the form
 * cannot be open at once.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'
import { FolderGit, Plus } from 'lucide'
import { ProjectId } from '@oru/kernel'
import { DirectoryListing, Project } from '@oru/rpc'
import { button } from '@/components/ui/button.ts'
import { inputClass } from '@/components/ui/input.ts'
import { cn } from '@/lib/utils.ts'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'
import {
  DirectoryError,
  RelativeCwd,
  cwdRefusalText,
  deriveProjectName,
  directoryErrorText,
} from './projects.ts'

/** The menu row that opens the directory browser. */
export const NEW_ROW = 'new-project'
export const FIELDS = { name: 'name', cwd: 'cwd', icon: 'icon' } as const
export type Field = (typeof FIELDS)[keyof typeof FIELDS]

export const isField = (value: string): value is Field =>
  value === FIELDS.name || value === FIELDS.cwd || value === FIELDS.icon

/**
 * The panel. One member is open at a time, so "the form is open" and "a draft
 * exists" cannot disagree, and the browser and the form cannot overlap.
 */
export const Closed = Schema.TaggedStruct('Closed', {})
export const Browsing = Schema.TaggedStruct('Browsing', {})
export const BrowsingDirs = Schema.TaggedStruct('BrowsingDirs', {
  path: Schema.UndefinedOr(Schema.String),
  listing: Schema.UndefinedOr(DirectoryListing),
  isLoading: Schema.Boolean,
  error: Schema.UndefinedOr(DirectoryError),
})
export const Composing = Schema.TaggedStruct('Composing', {
  name: Schema.String,
  cwd: Schema.String,
  icon: Schema.String,
  refusal: Schema.UndefinedOr(RelativeCwd),
  isSaving: Schema.Boolean,
})
export const Panel = Schema.Union([Closed, Browsing, BrowsingDirs, Composing])
export type Panel = typeof Panel.Type

export const Model = Schema.Struct({
  /**
   * The project the composer points at, as an id. A name is read back out of
   * the list on every render, so a pick the host no longer lists falls back
   * to the host's first instead of rendering a stale copy.
   */
  selected: Schema.UndefinedOr(ProjectId),
  panel: Panel,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Toggled: {},
  ChangedField: { field: Schema.String, value: Schema.String },
  SelectedOption: { option: Schema.String },
  Canceled: {},
  SubmittedForm: {},

  // The directory browser.
  OpenedDirectory: { path: Schema.String },
  OpenedParent: {},
  ClickedBrowseBack: {},
  ClickedUseDirectory: {},
  DirectoryArrived: { listing: DirectoryListing },
  DirectoryFailed: { error: DirectoryError },

  // The host's answers to the create this picker asked for, forwarded by root.
  ProjectCreated: { project: Project },
  ProjectUpdated: { project: Project },
  ProjectDeleted: { project: ProjectId },
  CreateRefused: { refusal: RelativeCwd },
  HostUnreachable: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedCreate: {
    name: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    icon: Schema.UndefinedOr(Schema.String),
  },
  RequestedDirectory: { path: Schema.UndefinedOr(Schema.String) },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({ selected: undefined, panel: Closed.make({}) })

/**
 * The project the chip names: the one the user picked while the list still
 * carries it, otherwise the list's first. Nothing is stored by that fallback,
 * so the menu marks only a pick.
 */
export const selectedProject = (
  model: Model,
  projects: ReadonlyArray<Project>,
): Project | undefined => projects.find((project) => project.id === model.selected) ?? projects[0]

/**
 * A draft the host owes an answer for. It cannot be dismissed, replaced, or
 * amended while the write is in flight, so an answer can only reach the draft
 * that made the request.
 */
const isPending = (panel: Panel): boolean =>
  Predicate.isTagged(panel, 'Composing') && panel.isSaving

const browsingDirs = (path: string | undefined): typeof BrowsingDirs.Type =>
  BrowsingDirs.make({ path, listing: undefined, isLoading: true, error: undefined })

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ProjectCreated: ({ project }) => ({
      model: evo(model, {
        selected: () => project.id,
        panel: () => Closed.make({}),
      }),
    }),
    // The name resolves out of the list on every render, so an update moves
    // nothing here. A deletion clears a selection that no longer resolves.
    ProjectUpdated: () => ({ model }),
    ProjectDeleted: ({ project }) => ({
      model: evo(model, {
        selected: (selected) => (selected === project ? undefined : selected),
      }),
    }),
    CreateRefused: ({ refusal }) =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          Composing: (composing) => ({
            model: evo(model, {
              panel: () => Composing.make({ ...composing, refusal, isSaving: false }),
            }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          BrowsingDirs: () => ({ model }),
        }),
      ),
    // A host that stopped answering is not a write in flight.
    HostUnreachable: () => ({
      model: evo(model, {
        panel: (panel) =>
          Predicate.isTagged(panel, 'Composing')
            ? Composing.make({ ...panel, isSaving: false })
            : Predicate.isTagged(panel, 'BrowsingDirs')
              ? BrowsingDirs.make({ ...panel, isLoading: false })
              : panel,
      }),
    }),

    Toggled: () => {
      if (isPending(model.panel)) return { model }
      return {
        model: evo(model, {
          panel: (panel) =>
            Predicate.isTagged(panel, 'Closed') ? Browsing.make({}) : Closed.make({}),
        }),
      }
    },
    ChangedField: ({ field, value }) => {
      if (!isField(field) || isPending(model.panel)) return { model }
      return Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          // The refusal answered the old text, so editing retires it.
          Composing: (composing) => ({
            model: evo(model, {
              panel: () =>
                Composing.make({
                  ...composing,
                  ...(field === FIELDS.name
                    ? { name: value }
                    : field === FIELDS.cwd
                      ? { cwd: value }
                      : { icon: value }),
                  refusal: undefined,
                }),
            }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          BrowsingDirs: () => ({ model }),
        }),
      )
    },
    SelectedOption: ({ option }) => {
      if (isPending(model.panel)) return { model }
      if (option === NEW_ROW) {
        return {
          model: evo(model, { panel: () => browsingDirs(undefined) }),
          outMessage: OutMessage.RequestedDirectory({ path: undefined }),
        }
      }
      return { model: evo(model, { selected: () => option, panel: () => Closed.make({}) }) }
    },
    Canceled: () => {
      if (isPending(model.panel)) return { model }
      return { model: evo(model, { panel: () => Closed.make({}) }) }
    },
    SubmittedForm: () =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          Composing: (composing) => {
            const name = composing.name.trim()
            const cwd = composing.cwd.trim()
            const icon = composing.icon.trim()
            // The wire's own precondition, not a second opinion about what a
            // host accepts: which cwd *is* acceptable stays the host's answer.
            if (composing.isSaving || name.length === 0 || cwd.length === 0) return { model }
            return {
              model: evo(model, {
                panel: () => Composing.make({ ...composing, refusal: undefined, isSaving: true }),
              }),
              outMessage: OutMessage.RequestedCreate({
                name,
                cwd,
                icon: icon.length === 0 ? undefined : icon,
              }),
            }
          },
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          BrowsingDirs: () => ({ model }),
        }),
      ),

    OpenedDirectory: ({ path }) =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: () => ({
            model: evo(model, { panel: () => browsingDirs(path) }),
            outMessage: OutMessage.RequestedDirectory({ path }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
    OpenedParent: () =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: (browsing) => {
            const parent = browsing.listing?.parent
            if (parent === undefined) return { model }
            return {
              model: evo(model, { panel: () => browsingDirs(parent) }),
              outMessage: OutMessage.RequestedDirectory({ path: parent }),
            }
          },
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
    ClickedBrowseBack: () =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: () => ({ model: evo(model, { panel: () => Browsing.make({}) }) }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
    ClickedUseDirectory: () =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: (browsing) => {
            const cwd = browsing.listing?.path ?? browsing.path
            if (cwd === undefined) return { model }
            return {
              model: evo(model, {
                panel: () =>
                  Composing.make({
                    name: deriveProjectName(cwd),
                    cwd,
                    icon: '',
                    refusal: undefined,
                    isSaving: false,
                  }),
              }),
            }
          },
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
    DirectoryArrived: ({ listing }) =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: (browsing) => ({
            model: evo(model, {
              panel: () =>
                BrowsingDirs.make({
                  ...browsing,
                  path: listing.path,
                  listing,
                  isLoading: false,
                  error: undefined,
                }),
            }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
    DirectoryFailed: ({ error }) =>
      Match.value(model.panel).pipe(
        Match.tagsExhaustive({
          BrowsingDirs: (browsing) => ({
            model: evo(model, {
              panel: () => BrowsingDirs.make({ ...browsing, isLoading: false, error }),
            }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
          Composing: () => ({ model }),
        }),
      ),
  })

export type ViewInputs = Readonly<{
  projects: ReadonlyArray<Project>
  isLoading: boolean
}>

const triggerLabel = (model: Model, inputs: ViewInputs): string =>
  inputs.isLoading ? 'Project' : (selectedProject(model, inputs.projects)?.name ?? 'No project')

const menuView = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  pickerMenu(
    {
      hook: 'project-picker-option',
      note: inputs.isLoading ? 'Reading the host’s projects…' : undefined,
      options: [
        ...inputs.projects.map((project) => ({
          id: project.id,
          label: project.name,
          description: project.cwd,
          isSelected:
            model.selected !== undefined &&
            inputs.projects.some((entry) => entry.id === model.selected) &&
            project.id === model.selected,
          toMessage: (id: string) => Message.SelectedOption({ option: id }),
        })),
        {
          id: NEW_ROW,
          label: 'New project…',
          icon: Plus,
          isSeparated: true,
          toMessage: (id: string) => Message.SelectedOption({ option: id }),
        },
      ],
    },
    h,
  )

const dirsView = (
  browsing: typeof BrowsingDirs.Type,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => {
  const directories = (browsing.listing?.entries ?? []).filter((entry) => entry.isDirectory)
  return [
    h.p([h.Class('px-2 py-1.5 text-xs font-medium text-muted-foreground')], ['New project']),
    h.p(
      [
        h.DataAttribute('project-picker-dirs-path', ''),
        h.Class('truncate px-2 pb-1 font-mono text-xs text-muted-foreground'),
      ],
      [browsing.listing?.path ?? browsing.path ?? 'Reading…'],
    ),
    ...(browsing.isLoading
      ? [
          h.p(
            [
              h.DataAttribute('project-picker-dirs-loading', ''),
              h.Class('px-2 py-3 text-xs text-muted-foreground'),
            ],
            ['Reading directories…'],
          ),
        ]
      : []),
    ...(browsing.error === undefined
      ? []
      : [
          h.p(
            [
              h.DataAttribute('project-picker-error', ''),
              h.Class('px-2 py-1 text-xs text-destructive'),
            ],
            [directoryErrorText(browsing.error)],
          ),
        ]),
    ...(!browsing.isLoading && browsing.listing !== undefined
      ? [
          ...(browsing.listing.parent === undefined
            ? []
            : [
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('project-picker-parent', ''),
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
                h.DataAttribute('project-picker-dir', entry.path),
                h.OnClick(Message.OpenedDirectory({ path: entry.path })),
                h.Class(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                ),
              ],
              [entry.name],
            ),
          ),
        ]
      : []),
    h.div(
      [h.Class('flex justify-between gap-1 px-2 pt-1 pb-1.5')],
      [
        button(
          {
            onClick: Message.ClickedBrowseBack(),
            variant: 'ghost',
            size: 'sm',
            attributes: [h.DataAttribute('project-picker-back', '')],
          },
          'Back',
          h,
        ),
        button(
          {
            onClick: Message.ClickedUseDirectory(),
            variant: 'secondary',
            size: 'sm',
            isDisabled:
              browsing.isLoading || (browsing.listing?.path ?? browsing.path) === undefined,
            attributes: [h.DataAttribute('project-picker-use-dir', '')],
          },
          'Use this directory',
          h,
        ),
      ],
    ),
  ]
}

const formView = (
  composing: typeof Composing.Type,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => [
  h.p([h.Class('px-2 py-1.5 text-xs font-medium text-muted-foreground')], ['New project']),
  ...(
    [
      { id: FIELDS.name, label: 'Name', placeholder: 'oru', isMonospace: false },
      { id: FIELDS.cwd, label: 'Cwd', placeholder: '/Users/you/code/oru', isMonospace: true },
      {
        id: FIELDS.icon,
        label: 'Logo',
        placeholder: '/Users/you/code/oru/logo.svg',
        isMonospace: true,
      },
    ] as const
  ).map((field) => {
    const value =
      field.id === FIELDS.name
        ? composing.name
        : field.id === FIELDS.cwd
          ? composing.cwd
          : composing.icon
    return h.label(
      [h.For(`project-picker-${field.id}`), h.Class('flex flex-col gap-1 px-2 py-1')],
      [
        h.span([h.Class('text-xs text-muted-foreground')], [field.label]),
        h.input([
          h.Id(`project-picker-${field.id}`),
          h.Type('text'),
          h.Value(value),
          h.Placeholder(field.placeholder),
          h.OnInput((next) => Message.ChangedField({ field: field.id, value: next })),
          h.DataAttribute('project-picker-field', field.id),
          h.Class(cn(inputClass, field.isMonospace && 'font-mono text-[0.8rem]')),
        ]),
      ],
    )
  }),
  ...(composing.refusal === undefined
    ? []
    : [
        h.p(
          [
            h.DataAttribute('project-picker-error', ''),
            h.Class('px-2 py-1 text-xs text-destructive'),
          ],
          [cwdRefusalText(composing.refusal)],
        ),
      ]),
  h.div(
    [h.Class('flex justify-end gap-1 px-2 pt-1 pb-1.5')],
    [
      button(
        {
          onClick: Message.Canceled(),
          variant: 'ghost',
          size: 'sm',
          isDisabled: composing.isSaving,
          attributes: [h.DataAttribute('project-picker-cancel', '')],
        },
        'Cancel',
        h,
      ),
      button(
        {
          onClick: Message.SubmittedForm(),
          variant: 'secondary',
          size: 'sm',
          isDisabled:
            composing.isSaving ||
            composing.name.trim().length === 0 ||
            composing.cwd.trim().length === 0,
          attributes: [h.DataAttribute('project-picker-submit', '')],
        },
        composing.isSaving ? 'Creating…' : 'Create project',
        h,
      ),
    ],
  ),
]

export const view = defineView<Model, Message, ViewInputs>((model, inputs, h) => {
  const isOpen = !Predicate.isTagged(model.panel, 'Closed')
  const panel = Match.value(model.panel).pipe(
    Match.tagsExhaustive({
      Closed: (): Html | undefined => undefined,
      Browsing: () =>
        pickerPanel(
          {
            label: 'Projects',
            hook: 'project-picker-panel',
            onClose: Message.Canceled(),
            children: [menuView(model, inputs, h)],
          },
          h,
        ),
      BrowsingDirs: (browsing) =>
        pickerPanel(
          {
            label: 'Choose a directory',
            hook: 'project-picker-panel',
            onClose: Message.Canceled(),
            children: dirsView(browsing, h),
          },
          h,
        ),
      Composing: (composing) =>
        pickerPanel(
          {
            label: 'New project',
            hook: 'project-picker-panel',
            onClose: Message.Canceled(),
            children: formView(composing, h),
          },
          h,
        ),
    }),
  )
  return pickerAnchor(
    pickerTrigger(
      {
        label: triggerLabel(model, inputs),
        icon: FolderGit,
        isOpen,
        hook: 'project-picker-trigger',
        message: Message.Toggled(),
      },
      h,
    ),
    panel,
    h,
  )
})
