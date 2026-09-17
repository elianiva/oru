/**
 * The composer's project picker: the chip, its menu, and its create form.
 *
 * This submodel owns the picker's UI and the selection: which project the
 * composer points at, whether the panel is open, and the create draft. The
 * host's project list arrives through `viewInputs` — the `Projects` submodel
 * stays the host truth — and the host's answers to a create arrive as
 * messages root forwards. A name is read back out of the list on every
 * render, so a row the host no longer lists stops resolving instead of being
 * rendered from a stale copy.
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
import { inputClass } from '@/components/ui/input.ts'
import { cn } from '@/lib/utils.ts'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'
import { RelativeCwd, cwdRefusalText } from './projects.ts'

/** The menu row that opens the create form. */
export const NEW_ROW = 'new-project'
export const FIELDS = { name: 'name', cwd: 'cwd' } as const
export type Field = (typeof FIELDS)[keyof typeof FIELDS]

export const isField = (value: string): value is Field =>
  value === FIELDS.name || value === FIELDS.cwd

/**
 * The panel. Presence of a draft is what makes the panel a form, so "the form
 * is open" and "a draft exists" cannot disagree.
 */
export const Closed = Schema.TaggedStruct('Closed', {})
export const Browsing = Schema.TaggedStruct('Browsing', {})
export const Composing = Schema.TaggedStruct('Composing', {
  name: Schema.String,
  cwd: Schema.String,
  refusal: Schema.UndefinedOr(RelativeCwd),
  isSaving: Schema.Boolean,
})
export const Panel = Schema.Union([Closed, Browsing, Composing])
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

  // The host's answers to the create this picker asked for, forwarded by root.
  ProjectCreated: { project: Project },
  CreateRefused: { refusal: RelativeCwd },
  HostUnreachable: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedCreate: { name: Schema.NonEmptyString, cwd: Schema.NonEmptyString },
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

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ProjectCreated: ({ project }) => ({
      model: evo(model, {
        selected: () => project.id,
        panel: () => Closed.make({}),
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
        }),
      ),
    // A host that stopped answering is not a write in flight.
    HostUnreachable: () => ({
      model: evo(model, {
        panel: (panel) =>
          Predicate.isTagged(panel, 'Composing')
            ? Composing.make({ ...panel, isSaving: false })
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
                  ...(field === FIELDS.name ? { name: value } : { cwd: value }),
                  refusal: undefined,
                }),
            }),
          }),
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
        }),
      )
    },
    SelectedOption: ({ option }) => {
      if (isPending(model.panel)) return { model }
      if (option === NEW_ROW) {
        return {
          model: evo(model, {
            panel: () => Composing.make({ name: '', cwd: '', refusal: undefined, isSaving: false }),
          }),
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
            // The wire's own precondition, not a second opinion about what a
            // host accepts: which cwd *is* acceptable stays the host's answer.
            if (composing.isSaving || name.length === 0 || cwd.length === 0) return { model }
            return {
              model: evo(model, {
                panel: () => Composing.make({ ...composing, refusal: undefined, isSaving: true }),
              }),
              outMessage: OutMessage.RequestedCreate({ name, cwd }),
            }
          },
          Closed: () => ({ model }),
          Browsing: () => ({ model }),
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

const formView = (
  composing: typeof Composing.Type,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => [
  h.p([h.Class('px-2 py-1.5 text-xs font-medium text-muted-foreground')], ['New project']),
  ...(
    [
      { id: FIELDS.name, label: 'Name', placeholder: 'oru', isMonospace: false },
      { id: FIELDS.cwd, label: 'Cwd', placeholder: '/Users/you/code/oru', isMonospace: true },
    ] as const
  ).map((field) => {
    const value = field.id === FIELDS.name ? composing.name : composing.cwd
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
