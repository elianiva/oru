/**
 * The composer's worktree picker.
 *
 * A facade for now: no host surface lists worktrees yet, so the rows are
 * static and the selection lives here. The `Model` is shaped the way a real
 * backend drops into — `selected` plus `isOpen` — so wiring the host later
 * replaces the rows without reshaping the state. Emits no OutMessage until
 * something reads the pick.
 */
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import { Box, Plus } from 'lucide'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'

export const CURRENT = 'current'
export const NEW_ROW = 'new-worktree'

const OPTIONS = [
  { id: CURRENT, label: 'Current worktree' },
  { id: NEW_ROW, label: 'New worktree…', icon: Plus, isSeparated: true },
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

export const init = (): Model => ({ selected: CURRENT, isOpen: false })

/** What the trigger names, once a backend names it. */
export const selectionLabel = (model: Model): string =>
  OPTIONS.find((option) => option.id === model.selected)?.label ?? 'Worktree'

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Toggled: () => ({ model: evo(model, { isOpen: (isOpen) => !isOpen }) }),
    SelectedOption: ({ option }) => ({
      // An id the facade never offered is not a selection.
      model:
        OPTIONS.some((entry) => entry.id === option) && option !== NEW_ROW
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
        icon: Box,
        isOpen: model.isOpen,
        hook: 'worktree-picker-trigger',
        message: Message.Toggled(),
      },
      h,
    ),
    model.isOpen
      ? pickerPanel(
          {
            label: 'Worktree',
            hook: 'worktree-picker-panel',
            onClose: Message.Canceled(),
            children: [
              pickerMenu(
                {
                  hook: 'worktree-picker-option',
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
