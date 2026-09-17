/**
 * The composer's box: a draft, a submit, and four empty slots.
 *
 * The composer owns no picker and names none. Each slot is a callback the
 * parent built with its own `h` (a vnode carrying a handler throws across a
 * `viewInputs` boundary, so the parent builds and the composer only places),
 * and every visible control inside a slot is a submodel that owns its own
 * state. What the composer calls the picks it submits is answered by the
 * parent reading those submodels at `Submitted` time, never by a copy here.
 */
import { Schema } from 'effect'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { ArrowUp } from 'lucide'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'

export const Model = Schema.Struct({
  draft: Schema.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedDraft: { value: Schema.String },
  ClickedSubmit: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Submitted: { text: Schema.String },
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
  })

export type ViewInputs = Readonly<{
  placeholder: string
  headline?: string | undefined
  toLeading: () => Html
  /** Reserved for voice input; absent until a submodel claims it. */
  toTrailing?: (() => Html) | undefined
  toChipsLeft: () => Html
  toChipsRight: () => Html
}>

export const view = defineView<Model, Message, ViewInputs>((model, inputs, h) => {
  const { toLeading, toTrailing, toChipsLeft, toChipsRight } = inputs
  return h.div(
    [h.Attribute('data-composer', ''), h.Class('w-full max-w-3xl')],
    [
      ...(inputs.headline === undefined
        ? []
        : [
            h.div(
              [
                h.Attribute('data-composer-headline', ''),
                h.Class(
                  'mb-6 text-center text-2xl font-medium tracking-tight text-balance md:text-3xl',
                ),
              ],
              [inputs.headline],
            ),
          ]),
      h.div(
        [h.Attribute('data-composer-card', ''), h.Class('rounded-2xl bg-sidebar border-[0.5px]')],
        [
          h.textarea([
            h.Attribute('data-composer-input', ''),
            h.Class(
              'min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-base outline-none placeholder:text-muted-foreground',
            ),
            h.Value(model.draft),
            h.Placeholder(inputs.placeholder),
            h.OnInput((value) => Message.ChangedDraft({ value })),
          ]),
          h.div(
            [h.Class('flex items-center gap-0.5 px-3 pt-1 pb-3')],
            [
              toLeading(),
              h.div([h.Class('flex-1')], []),
              ...(toTrailing === undefined ? [] : [toTrailing()]),
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
      h.div(
        [
          h.Attribute('data-composer-context', ''),
          h.Class('mt-2 flex flex-wrap items-center gap-0.5'),
        ],
        [toChipsLeft(), h.div([h.Class('flex-1')], []), toChipsRight()],
      ),
    ],
  )
})
