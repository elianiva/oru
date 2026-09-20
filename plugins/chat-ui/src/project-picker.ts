/**
 * The composer's project picker: the chip and its menu.
 *
 * This submodel owns the picker's UI and the selection: which project the
 * composer points at and whether the menu is open. The host's project list
 * arrives through `viewInputs` — the `Projects` submodel stays the host
 * truth — and a created project arrives as a message root forwards, which
 * selects it. Creating itself lives in the shared project dialogs, so every
 * entry point opens the same flow.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import type * as Update from 'foldkit/update'
import { FolderGit, Plus } from 'lucide'
import { PERSONAL_PROJECT_ID, ProjectId, isPersonalProjectId } from '@oru/kernel'
import { Project } from '@oru/rpc'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'

/** The menu row that opens the shared create dialog. */
export const NEW_ROW = 'new-project'

/** The menu, open or shut. */
export const Closed = Schema.TaggedStruct('Closed', {})
export const Browsing = Schema.TaggedStruct('Browsing', {})
export const Panel = Schema.Union([Closed, Browsing])
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
  SelectedOption: { option: Schema.String },
  Canceled: {},

  // The host's answers, forwarded by root. A creation selects its project.
  ProjectCreated: { project: Project },
  ProjectUpdated: { project: Project },
  ProjectDeleted: { project: ProjectId },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedCreateDialog: {},
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

    Toggled: () => ({
      model: evo(model, {
        panel: (panel) =>
          Predicate.isTagged(panel, 'Closed') ? Browsing.make({}) : Closed.make({}),
      }),
    }),
    SelectedOption: ({ option }) => {
      if (option === NEW_ROW) {
        return {
          model: evo(model, { panel: () => Closed.make({}) }),
          outMessage: OutMessage.RequestedCreateDialog(),
        }
      }
      return { model: evo(model, { selected: () => option, panel: () => Closed.make({}) }) }
    },
    Canceled: () => ({ model: evo(model, { panel: () => Closed.make({}) }) }),
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
        {
          id: PERSONAL_PROJECT_ID,
          label: "Don't work in a project",
          isSelected: model.selected === PERSONAL_PROJECT_ID,
          toMessage: (id: string) => Message.SelectedOption({ option: id }),
        },
        ...inputs.projects
          .filter((project) => !isPersonalProjectId(project.id))
          .map((project) => ({
            id: project.id,
            label: project.name,
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
