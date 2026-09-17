import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type { IconNode } from 'lucide'
import { ArrowUp, ChevronDown } from 'lucide'
import { button } from '@/components/ui/button.ts'
import { inputClass } from '@/components/ui/input.ts'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'

export const Model = Schema.Struct({
  draft: Schema.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedDraft: { value: Schema.String },
  ClickedSubmit: {},
  ClickedAction: { id: Schema.String },
  /**
   * A panel's own interactions. `chip` is the panel that owns the control; the
   * composer never reads it, root routes it to whoever contributed that chip.
   */
  ChangedChipField: { chip: Schema.String, field: Schema.String, value: Schema.String },
  ClickedChipOption: { chip: Schema.String, option: Schema.String },
  ClickedChipCancel: { chip: Schema.String },
  ClickedChipSubmit: { chip: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Submitted: { text: Schema.String },
  RequestedAction: { id: Schema.String },
  ChangedChipField: { chip: Schema.String, field: Schema.String, value: Schema.String },
  SelectedChipOption: { chip: Schema.String, option: Schema.String },
  CanceledChip: { chip: Schema.String },
  SubmittedChipForm: { chip: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({ draft: '' })

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    ChangedDraft: ({ value }) => ({ model: { ...model, draft: value } }),
    ClickedSubmit: () => {
      if (model.draft.trim().length === 0) return { model }
      return {
        model: { ...model, draft: '' },
        outMessage: OutMessage.Submitted({ text: model.draft }),
      }
    },
    ClickedAction: ({ id }) => ({ model, outMessage: OutMessage.RequestedAction({ id }) }),
    ChangedChipField: ({ chip, field, value }) => ({
      model,
      outMessage: OutMessage.ChangedChipField({ chip, field, value }),
    }),
    ClickedChipOption: ({ chip, option }) => ({
      model,
      outMessage: OutMessage.SelectedChipOption({ chip, option }),
    }),
    ClickedChipCancel: ({ chip }) => ({ model, outMessage: OutMessage.CanceledChip({ chip }) }),
    ClickedChipSubmit: ({ chip }) => ({
      model,
      outMessage: OutMessage.SubmittedChipForm({ chip }),
    }),
  })

export type ComposerAction = Readonly<{
  id: string
  label?: string
  icon?: IconNode
  chevron?: boolean
  /** Whether the surface this action opens is open right now. */
  isExpanded?: boolean
}>

export type ComposerChipOption = Readonly<{
  id: string
  label: string
  description?: string | undefined
  icon?: IconNode | undefined
  isSelected?: boolean | undefined
  /** A divider above the row: the menu's escape hatch. */
  isSeparated?: boolean | undefined
}>

export type ComposerChipField = Readonly<{
  id: string
  label: string
  value: string
  placeholder?: string | undefined
  isMonospace?: boolean | undefined
}>

export type ComposerChipMenu = Readonly<{
  kind: 'menu'
  options: ReadonlyArray<ComposerChipOption>
  /** What the panel says when it has no rows to show. */
  note?: string | undefined
}>

export type ComposerChipForm = Readonly<{
  kind: 'form'
  title: string
  fields: ReadonlyArray<ComposerChipField>
  submitLabel: string
  cancelLabel: string
  error?: string | undefined
  isSubmitDisabled: boolean
  /** A write in flight owns the form until its answer arrives. */
  isCancelDisabled: boolean
}>

/**
 * What a chip opens. A panel is data, not markup: the composer renders it with
 * its own Messages, so a chip's owner keeps its state and the composer keeps a
 * single Message universe.
 */
export type ComposerChipPanel = ComposerChipMenu | ComposerChipForm

export type ComposerChip = Readonly<{
  id: string
  label: string
  icon?: IconNode | undefined
  align?: 'left' | 'right' | undefined
  /** A chip with a panel is a disclosure; a chip without one is a label. */
  isOpen?: boolean | undefined
  panel?: ComposerChipPanel | undefined
}>

export type ComposerContributions = Readonly<{
  placeholder: string
  headline?: string
  leading: ReadonlyArray<ComposerAction>
  trailing: ReadonlyArray<ComposerAction>
  chips: ReadonlyArray<ComposerChip>
}>

export const emptyContributions = (placeholder: string): ComposerContributions => ({
  placeholder,
  leading: [],
  trailing: [],
  chips: [],
})

export const mergeContributions = (
  ...sources: ReadonlyArray<ComposerContributions>
): ComposerContributions => {
  const headline = sources.find((source) => source.headline !== undefined)?.headline ?? ''
  return {
    placeholder: sources[0]?.placeholder ?? '',
    headline,
    leading: sources.flatMap((source) => source.leading),
    trailing: sources.flatMap((source) => source.trailing),
    chips: sources.flatMap((source) => source.chips),
  }
}

const actionButton = <M>(
  action: ComposerAction,
  h: HtmlBuilder<M>,
  onClick: (id: string) => M,
): Html =>
  button(
    {
      onClick: onClick(action.id),
      variant: 'ghost',
      size: 'sm',
      className: 'gap-1 px-2 font-normal text-muted-foreground',
      attributes: [
        h.Attribute('data-composer-action', action.id),
        ...(action.isExpanded === true ? [h.AriaExpanded(true)] : []),
      ],
    },
    [
      ...(action.icon === undefined ? [] : [icon(h, action.icon, 'size-4')]),
      ...(action.label === undefined ? [] : [action.label]),
      ...(action.chevron === true ? [icon(h, ChevronDown, 'size-3.5')] : []),
    ],
    h,
  )

const chipButton = <M>(chip: ComposerChip, h: HtmlBuilder<M>, onClick: (id: string) => M): Html =>
  button(
    {
      onClick: onClick(chip.id),
      variant: 'ghost',
      size: 'sm',
      className: 'gap-1.5 px-2 font-normal text-muted-foreground',
      attributes: [
        h.Attribute('data-composer-chip', chip.id),
        // Only a chip that can open something advertises a popup.
        ...(chip.panel === undefined
          ? []
          : [h.AriaHasPopup('menu'), h.AriaExpanded(chip.isOpen === true)]),
      ],
    },
    [
      ...(chip.icon === undefined ? [] : [icon(h, chip.icon, 'size-4')]),
      chip.label,
      icon(h, ChevronDown, 'size-3.5'),
    ],
    h,
  )

const menuBody = (
  chip: ComposerChip,
  panel: ComposerChipMenu,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => [
  ...(panel.note === undefined
    ? []
    : [
        h.p(
          [
            h.DataAttribute('composer-chip-note', chip.id),
            h.Class('px-2 py-1.5 text-xs text-muted-foreground'),
          ],
          [panel.note],
        ),
      ]),
  h.ul(
    [h.Class('max-h-64 overflow-y-auto')],
    panel.options.map((option) =>
      h.li(
        [h.Class(option.isSeparated === true ? 'mt-1 border-t border-border/60 pt-1' : '')],
        [
          button(
            {
              onClick: Message.ClickedChipOption({ chip: chip.id, option: option.id }),
              variant: 'ghost',
              size: 'sm',
              className: 'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal',
              attributes: [
                h.DataAttribute('composer-chip-option', option.id),
                h.AriaSelected(option.isSelected === true),
                ...(option.isSelected === true
                  ? [h.DataAttribute('composer-chip-option-selected', '')]
                  : []),
              ],
            },
            [
              ...(option.icon === undefined ? [] : [icon(h, option.icon, 'size-4')]),
              h.span([h.Class('min-w-0 flex-1 truncate text-left')], [option.label]),
              ...(option.description === undefined
                ? []
                : [
                    h.span(
                      [h.Class('min-w-0 truncate font-mono text-xs text-muted-foreground')],
                      [option.description],
                    ),
                  ]),
            ],
            h,
          ),
        ],
      ),
    ),
  ),
]

const formBody = (
  chip: ComposerChip,
  panel: ComposerChipForm,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => [
  h.p([h.Class('px-2 py-1.5 text-xs font-medium text-muted-foreground')], [panel.title]),
  ...panel.fields.map((field) =>
    h.label(
      [h.For(`${chip.id}-${field.id}`), h.Class('flex flex-col gap-1 px-2 py-1')],
      [
        h.span([h.Class('text-xs text-muted-foreground')], [field.label]),
        h.input([
          h.Id(`${chip.id}-${field.id}`),
          h.Type('text'),
          h.Value(field.value),
          ...(field.placeholder === undefined ? [] : [h.Placeholder(field.placeholder)]),
          h.OnInput((value) => Message.ChangedChipField({ chip: chip.id, field: field.id, value })),
          h.DataAttribute('composer-chip-field', field.id),
          h.Class(cn(inputClass, field.isMonospace === true && 'font-mono text-[0.8rem]')),
        ]),
      ],
    ),
  ),
  ...(panel.error === undefined
    ? []
    : [
        h.p(
          [
            h.DataAttribute('composer-chip-error', chip.id),
            h.Class('px-2 py-1 text-xs text-destructive'),
          ],
          [panel.error],
        ),
      ]),
  h.div(
    [h.Class('flex justify-end gap-1 px-2 pt-1 pb-1.5')],
    [
      button(
        {
          onClick: Message.ClickedChipCancel({ chip: chip.id }),
          variant: 'ghost',
          size: 'sm',
          isDisabled: panel.isCancelDisabled,
          attributes: [h.DataAttribute('composer-chip-cancel', chip.id)],
        },
        panel.cancelLabel,
        h,
      ),
      button(
        {
          onClick: Message.ClickedChipSubmit({ chip: chip.id }),
          variant: 'secondary',
          size: 'sm',
          isDisabled: panel.isSubmitDisabled,
          attributes: [h.DataAttribute('composer-chip-submit', chip.id)],
        },
        panel.submitLabel,
        h,
      ),
    ],
  ),
]

const chipPanel = (chip: ComposerChip, panel: ComposerChipPanel, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      // One panel at a time, enforced by geometry rather than by shared state:
      // while a panel is open, every click outside it lands here.
      h.div([
        h.DataAttribute('composer-chip-backdrop', chip.id),
        h.OnClick(Message.ClickedChipCancel({ chip: chip.id })),
        h.Class('fixed inset-0 z-20'),
      ]),
      h.div(
        [
          h.DataAttribute('composer-chip-panel', chip.id),
          h.AriaLabel(chip.label),
          h.Tabindex(-1),
          h.OnKeyDownPreventDefault((key) =>
            key === 'Escape'
              ? Option.some(Message.ClickedChipCancel({ chip: chip.id }))
              : Option.none(),
          ),
          h.Class(
            'absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-border/60 bg-card p-1 shadow-lg',
          ),
        ],
        panel.kind === 'menu' ? menuBody(chip, panel, h) : formBody(chip, panel, h),
      ),
    ],
  )

/** The trigger plus the panel it opens, anchored above it so `relative` is the
 *  trigger's own positioning context. */
const chipRow = (
  chip: ComposerChip,
  h: HtmlBuilder<Message>,
  onClick: (id: string) => Message,
): Html =>
  h.div(
    [h.Class('relative')],
    [
      chipButton(chip, h, onClick),
      ...(chip.isOpen === true && chip.panel !== undefined ? [chipPanel(chip, chip.panel, h)] : []),
    ],
  )

export type ViewInputs = Readonly<{
  contributions: ComposerContributions
}>

export const view = defineView<Model, Message, ViewInputs>((model, inputs, h) => {
  const { contributions } = inputs
  const onAction = (id: string): Message => Message.ClickedAction({ id })
  return h.div(
    [h.Attribute('data-composer', ''), h.Class('w-full max-w-3xl')],
    [
      ...(contributions.headline === undefined
        ? []
        : [
            h.div(
              [
                h.Attribute('data-composer-headline', ''),
                h.Class(
                  'mb-6 text-center text-2xl font-medium tracking-tight text-balance md:text-3xl',
                ),
              ],
              [contributions.headline],
            ),
          ]),
      h.div(
        [h.Attribute('data-composer-card', ''), h.Class('rounded-2xl bg-sidebar')],
        [
          h.textarea([
            h.Attribute('data-composer-input', ''),
            h.Class(
              'min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-base outline-none placeholder:text-muted-foreground',
            ),
            h.Value(model.draft),
            h.Placeholder(contributions.placeholder),
            h.OnInput((value) => Message.ChangedDraft({ value })),
          ]),
          h.div(
            [h.Class('flex items-center gap-0.5 px-3 pt-1 pb-3')],
            [
              ...contributions.leading.map((action) => actionButton(action, h, onAction)),
              h.div([h.Class('flex-1')], []),
              ...contributions.trailing.map((action) => actionButton(action, h, onAction)),
              button(
                {
                  onClick: Message.ClickedSubmit(),
                  variant: 'secondary',
                  size: 'icon',
                  isDisabled: model.draft.trim().length === 0,
                  className: 'ml-1 rounded-full',
                  attributes: [h.Attribute('data-composer-submit', '')],
                },
                [icon(h, ArrowUp, 'size-4')],
                h,
              ),
            ],
          ),
        ],
      ),
      ...(contributions.chips.length === 0
        ? []
        : [
            h.div(
              [
                h.Attribute('data-composer-context', ''),
                h.Class('mt-2 flex flex-wrap items-center gap-0.5'),
              ],
              [
                ...contributions.chips
                  .filter((chip) => chip.align !== 'right')
                  .map((chip) => chipRow(chip, h, onAction)),
                h.div([h.Class('flex-1')], []),
                ...contributions.chips
                  .filter((chip) => chip.align === 'right')
                  .map((chip) => chipRow(chip, h, onAction)),
              ],
            ),
          ]),
    ],
  )
})
