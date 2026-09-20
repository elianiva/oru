/**
 * The composer's workspace picker.
 *
 * Lists the project's real checkouts when the host names them, and falls back
 * to the current checkout when it names none. The selection emits an
 * out-message so the composer carries the checkout's path into the submit
 * intent as the thread's cwd. What created the checkout, a git worktree or a
 * replacement strategy, stays behind the host's workspace API.
 */
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import { Box, Plus } from 'lucide'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'

export const CURRENT = 'current'
export const NEW_ROW = 'new-workspace'

export const WorkspaceRow = Schema.Struct({
  path: Schema.NonEmptyString,
  branch: Schema.UndefinedOr(Schema.String),
  isCurrent: Schema.Boolean,
  provider: Schema.NonEmptyString,
})
export type WorkspaceRow = typeof WorkspaceRow.Type

export const Model = Schema.Struct({
  selected: Schema.String,
  isOpen: Schema.Boolean,
  workspaces: Schema.Array(WorkspaceRow),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Toggled: {},
  SelectedOption: { option: Schema.String },
  Canceled: {},
  WorkspacesArrived: { workspaces: Schema.Array(WorkspaceRow) },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Selected: { path: Schema.UndefinedOr(Schema.String) },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({ selected: CURRENT, isOpen: false, workspaces: [] })

const labelOf = (row: WorkspaceRow): string => {
  const leaf = row.path.split('/').at(-1) ?? row.path
  return row.branch === undefined ? leaf : `${leaf} (${row.branch})`
}

/** What the trigger names: the selected checkout, or the current one. */
export const selectionLabel = (model: Model): string => {
  if (model.selected === CURRENT) return 'Current workspace'
  const found = model.workspaces.find((row) => row.path === model.selected)
  return found === undefined ? 'Current workspace' : labelOf(found)
}

/** The cwd the submit carries: absent means the project checkout. */
export const selectedCwd = (model: Model): string | undefined =>
  model.selected === CURRENT ? undefined : model.selected

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Toggled: () => ({ model: evo(model, { isOpen: (isOpen) => !isOpen }) }),
    SelectedOption: ({ option }) => {
      if (option === NEW_ROW) return { model: evo(model, { isOpen: () => false }) }
      if (option === CURRENT) {
        return {
          model: evo(model, { selected: () => CURRENT, isOpen: () => false }),
          outMessage: OutMessage.Selected({ path: undefined }),
        }
      }
      const known = model.workspaces.some((row) => row.path === option)
      if (!known) return { model: evo(model, { isOpen: () => false }) }
      return {
        model: evo(model, { selected: () => option, isOpen: () => false }),
        outMessage: OutMessage.Selected({ path: option }),
      }
    },
    Canceled: () => ({ model: evo(model, { isOpen: () => false }) }),
    WorkspacesArrived: ({ workspaces }) => {
      const next = evo(model, { workspaces: () => workspaces })
      if (model.selected !== CURRENT && !workspaces.some((row) => row.path === model.selected)) {
        return { model: evo(next, { selected: () => CURRENT }) }
      }
      return { model: next }
    },
  })

export const view = defineView<Model, Message>((model, h: HtmlBuilder<Message>) => {
  const options = [
    { id: CURRENT, label: 'Current workspace', isSelected: model.selected === CURRENT },
    ...model.workspaces.map((row) => ({
      id: row.path,
      label: labelOf(row),
      isSelected: row.path === model.selected,
    })),
    { id: NEW_ROW, label: 'New workspace…', icon: Plus, isSeparated: true },
  ]
  return pickerAnchor(
    pickerTrigger(
      {
        label: selectionLabel(model),
        icon: Box,
        isOpen: model.isOpen,
        hook: 'workspace-picker-trigger',
        message: Message.Toggled(),
      },
      h,
    ),
    model.isOpen
      ? pickerPanel(
          {
            label: 'Workspace',
            hook: 'workspace-picker-panel',
            onClose: Message.Canceled(),
            children: [
              pickerMenu(
                {
                  hook: 'workspace-picker-option',
                  options: options.map((option) => ({
                    ...option,
                    toMessage: (id: string) => Message.SelectedOption({ option: id }),
                  })),
                },
                h,
              ),
            ],
          },
          h,
        )
      : undefined,
    h,
  )
})
