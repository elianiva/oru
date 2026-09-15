import { Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type { IconNode } from 'lucide'
import { ArrowUp, ChevronDown } from 'lucide'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'

export const Model = Schema.Struct({
  draft: Schema.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedDraft: { value: Schema.String },
  ClickedSubmit: {},
  ClickedAction: { id: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Submitted: { text: Schema.String },
  RequestedAction: { id: Schema.String },
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
  })

export type ComposerAction = Readonly<{
  id: string
  label?: string
  icon?: IconNode
  chevron?: boolean
}>

export type ComposerChip = Readonly<{
  id: string
  label: string
  icon?: IconNode
  align?: 'left' | 'right'
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
      attributes: [h.Attribute('data-composer-action', action.id)],
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
      attributes: [h.Attribute('data-composer-chip', chip.id)],
    },
    [
      ...(chip.icon === undefined ? [] : [icon(h, chip.icon, 'size-4')]),
      chip.label,
      icon(h, ChevronDown, 'size-3.5'),
    ],
    h,
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
        [
          h.Attribute('data-composer-card', ''),
          h.Class('rounded-2xl border border-border bg-card shadow-sm'),
        ],
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
                  .map((chip) => chipButton(chip, h, onAction)),
                h.div([h.Class('flex-1')], []),
                ...contributions.chips
                  .filter((chip) => chip.align === 'right')
                  .map((chip) => chipButton(chip, h, onAction)),
              ],
            ),
          ]),
    ],
  )
})
