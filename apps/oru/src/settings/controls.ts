import { Switch } from '@foldkit/ui'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { ChevronDown } from 'lucide'
import { inputClass } from '@/components/ui/input.ts'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The shared settings primitives: a card, a section heading, and the three
 * row shapes (toggle, select, text). Pages compose these; none of them knows
 * which page it sits on.
 */

/** A filled card on the settings background. */
export const card = <M>(
  children: ReadonlyArray<Html | string>,
  h: HtmlBuilder<M>,
  attributes: ReadonlyArray<Attribute<M>> = [],
): Html =>
  h.div(
    [
      h.DataAttribute('settings-card', ''),
      h.Class('rounded-xl border border-border/60 bg-card shadow-sm'),
      ...attributes,
    ],
    children,
  )

export type SectionConfig = Readonly<{
  title: string
  /** Right-aligned heading action, like the Voice Input refresh button. */
  action?: Html
}>

/** A settings section heading with an optional trailing action. */
export const section = <M>(config: SectionConfig, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('mb-2 flex h-7 items-center gap-2')],
    [
      h.h2([h.Class('text-sm font-semibold')], [config.title]),
      h.div([h.Class('flex-1')], []),
      ...(config.action === undefined ? [] : [config.action]),
    ],
  )

export type ToggleRowConfig<M> = Readonly<{
  id: string
  title: string
  description?: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => M
}>

/** A labelled switch row. The parent owns the checked state. */
export const toggleRow = <M>(config: ToggleRowConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex items-start justify-between gap-4 py-2.5')],
    [
      h.div(
        [h.Class('flex min-w-0 flex-col gap-0.5')],
        [
          h.span([h.Class('text-sm')], [config.title]),
          ...(config.description === undefined
            ? []
            : [h.span([h.Class('text-xs text-muted-foreground')], [config.description])]),
        ],
      ),
      Switch.view(
        {
          id: config.id,
          isChecked: config.isChecked,
          onToggle: config.onToggle,
          toView: (attributes) =>
            h.button(
              [
                ...attributes.button,
                h.Id(config.id),
                h.AriaLabel(config.title),
                h.Class(
                  cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    config.isChecked ? 'bg-primary' : 'bg-muted',
                  ),
                ),
              ],
              [
                h.span(
                  [
                    h.Class(
                      cn(
                        'absolute top-0.5 left-0.5 block size-4 rounded-full bg-white shadow transition-transform duration-150 ease-out',
                        config.isChecked && 'translate-x-4',
                      ),
                    ),
                  ],
                  [],
                ),
              ],
            ),
        },
        h,
      ),
    ],
  )

export type SelectOption = Readonly<{
  value: string
  label: string
}>

export type SelectRowConfig<M> = Readonly<{
  id: string
  title: string
  description?: string
  value: string
  options: ReadonlyArray<SelectOption>
  onChange: (value: string) => M
  ariaLabel?: string
}>

/** A labelled native select row, chevron overlaid on the trailing edge. */
export const selectRow = <M>(config: SelectRowConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex items-start justify-between gap-4 py-2.5')],
    [
      h.div(
        [h.Class('flex min-w-0 flex-col gap-0.5')],
        [
          h.span([h.Class('text-sm')], [config.title]),
          ...(config.description === undefined
            ? []
            : [h.span([h.Class('text-xs text-muted-foreground')], [config.description])]),
        ],
      ),
      h.div(
        [h.Class('relative shrink-0')],
        [
          h.select(
            [
              h.Id(config.id),
              h.Value(config.value),
              h.OnChange(config.onChange),
              h.AriaLabel(config.ariaLabel ?? config.title),
              h.Class(
                'h-8 appearance-none rounded-lg border border-border/60 bg-background pr-8 pl-2.5 text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50',
              ),
            ],
            config.options.map((option) =>
              h.option(
                [
                  h.Value(option.value),
                  ...(option.value === config.value ? [h.Selected(true)] : []),
                ],
                [option.label],
              ),
            ),
          ),
          h.span(
            [
              h.Class(
                'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground',
              ),
            ],
            [icon(h, ChevronDown, 'size-3.5')],
          ),
        ],
      ),
    ],
  )

export type TextRowConfig<M> = Readonly<{
  id: string
  title: string
  description?: string
  value: string
  onInput: (value: string) => M
  placeholder?: string
  isMonospace?: boolean
}>

/** A labelled text field row: the label and description stack above the input. */
export const textRow = <M>(config: TextRowConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex flex-col gap-1.5 py-2.5')],
    [
      h.div(
        [h.Class('flex min-w-0 flex-col gap-0.5')],
        [
          h.label([h.For(config.id), h.Class('text-sm')], [config.title]),
          ...(config.description === undefined
            ? []
            : [h.span([h.Class('text-xs text-muted-foreground')], [config.description])]),
        ],
      ),
      h.input([
        h.Id(config.id),
        h.Type('text'),
        h.Value(config.value),
        h.OnInput(config.onInput),
        ...(config.placeholder === undefined ? [] : [h.Placeholder(config.placeholder)]),
        h.Class(cn(inputClass, config.isMonospace === true && 'font-mono text-[0.8rem]')),
      ]),
    ],
  )
