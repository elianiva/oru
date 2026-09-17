/**
 * The composer's access picker.
 *
 * A facade for now: no host surface gates tool access yet, so the rows are
 * static and the selection lives here. Sits at the chips' right end, where
 * the old label sat. Emits no OutMessage until something reads the pick.
 */
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'
import { Lock } from 'lucide'
import { pickerAnchor, pickerMenu, pickerPanel, pickerTrigger } from './picker-panel.ts'

export const FULL = 'full'
export const READ_ONLY = 'read-only'

const OPTIONS = [
  { id: FULL, label: 'Full Access' },
  { id: READ_ONLY, label: 'Read-only' },
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

export const init = (): Model => ({ selected: FULL, isOpen: false })

/** What the trigger names, once a backend names it. */
export const selectionLabel = (model: Model): string =>
  OPTIONS.find((option) => option.id === model.selected)?.label ?? 'Access'

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Toggled: () => ({ model: evo(model, { isOpen: (isOpen) => !isOpen }) }),
    SelectedOption: ({ option }) => ({
      model: OPTIONS.some((entry) => entry.id === option)
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
        icon: Lock,
        isOpen: model.isOpen,
        hook: 'access-picker-trigger',
        message: Message.Toggled(),
      },
      h,
    ),
    model.isOpen
      ? pickerPanel(
          {
            label: 'Access',
            hook: 'access-picker-panel',
            onClose: Message.Canceled(),
            children: [
              pickerMenu(
                {
                  hook: 'access-picker-option',
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
