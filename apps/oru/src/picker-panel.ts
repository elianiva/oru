/**
 * The shared geometry of a composer's picker: a ghost trigger and the panel it
 * opens, anchored above it. Presentational only — each picker owns its open
 * state and its panel's content, so this module holds no Model, no Message,
 * and no update. One place for the backdrop, the Escape handling, and the
 * positioning every picker would otherwise duplicate.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode } from 'lucide'
import { ChevronDown } from 'lucide'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'

export type PickerTriggerConfig<M> = Readonly<{
  label: string
  icon?: IconNode | undefined
  isOpen: boolean
  /** A glanceable dot while the picker needs attention (a harness not ready). */
  isAttention?: boolean | undefined
  /** The `data-*` hook on the trigger, e.g. `project-picker-trigger`. */
  hook: string
  message: M
}>

export const pickerTrigger = <M>(config: PickerTriggerConfig<M>, h: HtmlBuilder<M>): Html =>
  button(
    {
      onClick: config.message,
      variant: 'ghost',
      size: 'sm',
      className: 'gap-1.5 px-2 font-normal text-muted-foreground',
      attributes: [
        h.DataAttribute(config.hook, ''),
        h.AriaHasPopup('menu'),
        h.AriaExpanded(config.isOpen),
      ],
    },
    [
      ...(config.icon === undefined ? [] : [icon(h, config.icon, 'size-4')]),
      ...(config.isAttention === true
        ? [
            h.span(
              [
                h.DataAttribute(`${config.hook}-attention`, ''),
                h.Class('size-1.5 shrink-0 rounded-full bg-destructive'),
              ],
              [],
            ),
          ]
        : []),
      config.label,
      icon(h, ChevronDown, 'size-3.5'),
    ],
    h,
  )

export type PickerPanelConfig<M> = Readonly<{
  label: string
  /** The `data-*` hook on the panel, e.g. `project-picker-panel`. */
  hook: string
  onClose: M
  widthClass?: string | undefined
  children: ReadonlyArray<Html | string>
}>

export const pickerPanel = <M>(config: PickerPanelConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [],
    [
      // One panel at a time, enforced by geometry rather than by shared state:
      // while a panel is open, every click outside it lands here.
      h.div([
        h.DataAttribute(`${config.hook}-backdrop`, ''),
        h.OnClick(config.onClose),
        h.Class('fixed inset-0 z-20'),
      ]),
      h.div(
        [
          h.DataAttribute(config.hook, ''),
          h.AriaLabel(config.label),
          h.Tabindex(-1),
          h.OnKeyDownPreventDefault((key) =>
            key === 'Escape' ? Option.some(config.onClose) : Option.none(),
          ),
          h.Class(
            cn(
              'absolute bottom-full left-0 z-30 mb-2 rounded-xl border border-border/60 bg-card p-1 shadow-lg',
              config.widthClass ?? 'w-72',
            ),
          ),
        ],
        config.children,
      ),
    ],
  )

/** The trigger plus the panel it opens, anchored above it so `relative` is the
 *  trigger's own positioning context. */
export const pickerAnchor = <M>(trigger: Html, panel: Html | undefined, h: HtmlBuilder<M>): Html =>
  h.div([h.Class('relative')], panel === undefined ? [trigger] : [trigger, panel])

export type PickerMenuOption<M> = Readonly<{
  id: string
  label: string
  description?: string | undefined
  icon?: IconNode | undefined
  isSelected?: boolean | undefined
  /** A divider above the row: the menu's escape hatch. */
  isSeparated?: boolean | undefined
  toMessage: (id: string) => M
}>

export type PickerMenuConfig<M> = Readonly<{
  /** The `data-*` hook prefix for the rows, e.g. `project-picker-option`. */
  hook: string
  /** What the panel says when it has no rows to show. */
  note?: string | undefined
  options: ReadonlyArray<PickerMenuOption<M>>
}>

export const pickerMenu = <M>(config: PickerMenuConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [],
    [
      ...(config.note === undefined
        ? []
        : [h.p([h.Class('px-2 py-1.5 text-xs text-muted-foreground')], [config.note])]),
      h.ul(
        [h.Class('max-h-64 overflow-y-auto')],
        config.options.map((option) =>
          h.li(
            [h.Class(option.isSeparated === true ? 'mt-1 border-t border-border/60 pt-1' : '')],
            [
              button(
                {
                  onClick: option.toMessage(option.id),
                  variant: 'ghost',
                  size: 'sm',
                  className: 'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal',
                  attributes: [
                    h.DataAttribute(config.hook, option.id),
                    h.AriaSelected(option.isSelected === true),
                    ...(option.isSelected === true
                      ? [h.DataAttribute(`${config.hook}-selected`, '')]
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
    ],
  )
