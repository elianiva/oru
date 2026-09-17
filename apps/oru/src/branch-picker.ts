/**
 * The composer's branch picker.
 *
 * A facade for now: no host surface lists branches yet, so the rows are
 * static and the selection lives here. Shaped like the worktree picker so a
 * real backend drops in the same way. Emits no OutMessage until something
 * reads the pick.
 */
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import { GitBranch } from 'lucide'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'

export const DEFAULT_BRANCH = 'origin/master'
export const CHANGE_ROW = 'change-branch'

const OPTIONS = [
  { id: DEFAULT_BRANCH, label: 'Branch from: origin/master' },
  { id: CHANGE_ROW, label: 'Change branch…', isSeparated: true },
] as const

export const Model = Schema.Struct({
  selected: Schema.String,
  isOpen: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Toggled: {},
  SelectedOption: { option: Schema.String },
  Canceled: {},
})
export type Message = typeof Message.Type

export const init = (): Model => ({ selected: DEFAULT_BRANCH, isOpen: false })

/** What the trigger names, once a backend names it. */
export const selectionLabel = (model: Model): string =>
  OPTIONS.find((option) => option.id === model.selected)?.label ?? 'Branch'

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Toggled: () => ({ model: evo(model, { isOpen: (isOpen) => !isOpen }) }),
    SelectedOption: ({ option }) => ({
      model:
        OPTIONS.some((entry) => entry.id === option) && option !== CHANGE_ROW
          ? evo(model, { selected: () => option, isOpen: () => false })
          : evo(model, { isOpen: () => false }),
    }),
    Canceled: () => ({ model: evo(model, { isOpen: () => false }) }),
  })

export const view = defineView<Model, Message>((model, h: HtmlBuilder<Message>) =>
  pickerAnchor(
    pickerTrigger(
      {
        label: selectionLabel(model),
        icon: GitBranch,
        isOpen: model.isOpen,
        hook: 'branch-picker-trigger',
        message: Message.Toggled(),
      },
      h,
    ),
    model.isOpen
      ? pickerPanel(
          {
            label: 'Branch',
            hook: 'branch-picker-panel',
            onClose: Message.Canceled(),
            children: [
              pickerMenu(
                {
                  hook: 'branch-picker-option',
                  options: OPTIONS.map((option) => ({
                    ...option,
                    isSelected: option.id === model.selected,
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
  ),
)
