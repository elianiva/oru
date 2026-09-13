import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils.ts'
import { button, type ButtonConfig } from './button.ts'
import { inputClass } from './input.ts'
import { textareaClass } from './textarea.ts'

type Child = Html | string

// InputGroup draws a shared bordered box and lets you slot text/icon add-ons
// around a connected input. The inner control carries
// data-slot="input-group-control" so the group token's focus/invalid/disabled
// frame states key off it.

/** Upstream InputGroup root string. */
export const inputGroupClass =
  'border-input dark:bg-input/30 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-disabled:bg-input/50 dark:has-disabled:bg-input/80 h-8 rounded-lg border transition-colors in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-3 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5 group/input-group relative flex w-full min-w-0 items-center outline-none has-[>textarea]:h-auto'

/** Upstream InputGroupAddon base string; alignment via the align tokens. */
export const inputGroupAddonClass =
  "text-muted-foreground h-auto gap-2 py-1.5 text-sm font-medium group-data-[disabled]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4 flex cursor-text items-center justify-center select-none"

export const inputGroupAddonAlignClasses = {
  'inline-start': 'pl-2 has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem] order-first',
  'inline-end': 'pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem] order-last',
  'block-start':
    'px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2 order-first w-full justify-start',
  'block-end':
    'px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2 order-last w-full justify-start',
} as const

export type InputGroupAddonAlign = keyof typeof inputGroupAddonAlignClasses

export const inputGroupButtonSizeKeys = ['xs', 'sm', 'icon-xs', 'icon-sm'] as const
export type InputGroupButtonSize = (typeof inputGroupButtonSizeKeys)[number]

/** Upstream InputGroupButton base string (sizes are tokens). */
export const inputGroupButtonClass = 'gap-2 text-sm flex items-center shadow-none'

/** Upstream InputGroupButton size tokens; keyed like upstream's cva variants. */
export const inputGroupButtonSizeClasses = {
  xs: "h-6 gap-1 rounded-[calc(var(--radius)-3px)] px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
  sm: 'gap-1',
  'icon-xs': 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
  'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
} as const

export type InputGroupTextareaConfig<M> = Readonly<{
  id: string
  value?: string
  onInput?: (value: string) => M
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  placeholder?: string
  name?: string
  rows?: number
  className?: string
}>

export const inputGroupTextareaClass =
  'rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1 resize-none'

export const inputGroupTextClass =
  "text-muted-foreground gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 flex items-center [&_svg]:pointer-events-none"

export const inputGroupInputClass =
  'rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1'

/** The connected textarea for use inside `inputGroup`. Emits
 *  data-slot="input-group-control" so the group frame reacts to it. */
export const inputGroupTextarea = <M>(
  config: InputGroupTextareaConfig<M>,
  h: HtmlBuilder<M>,
): Html =>
  h.textarea([
    h.Id(config.id),
    ...(config.onInput === undefined ? [] : [h.OnInput(config.onInput)]),
    ...(config.value === undefined ? [] : [h.Value(config.value)]),
    ...(config.isDisabled === true ? [h.Disabled(true), h.DataAttribute('disabled', '')] : []),
    ...(config.isReadOnly === true ? [h.Attribute('readonly', 'true')] : []),
    ...(config.isInvalid === true ? [h.AriaInvalid(true), h.DataAttribute('invalid', '')] : []),
    ...(config.name === undefined ? [] : [h.Name(config.name)]),
    ...(config.rows === undefined ? [] : [h.Rows(config.rows)]),
    ...(config.placeholder === undefined ? [] : [h.Placeholder(config.placeholder)]),
    h.DataAttribute('slot', 'input-group-control'),
    h.Class(cn(textareaClass, inputGroupTextareaClass, config.className)),
  ])

export type InputGroupInputConfig<M> = Readonly<{
  id: string
  ariaLabel?: string
  value?: string
  onInput?: (value: string) => M
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  placeholder?: string
  name?: string
  type?: string
  className?: string
  /** Extra attributes merged onto the input element. */
  attributes?: ReadonlyArray<Attribute<M>>
}>

/** The connected input for use inside `inputGroup`. Emits
 *  data-slot="input-group-control" so the group frame reacts to it. */
export const inputGroupInput = <M>(config: InputGroupInputConfig<M>, h: HtmlBuilder<M>): Html =>
  h.input([
    h.Id(config.id),
    ...(config.ariaLabel === undefined ? [] : [h.AriaLabel(config.ariaLabel)]),
    ...(config.onInput === undefined ? [] : [h.OnInput(config.onInput)]),
    ...(config.value === undefined ? [] : [h.Value(config.value)]),
    ...(config.isDisabled === true ? [h.Disabled(true), h.DataAttribute('disabled', '')] : []),
    ...(config.isReadOnly === true ? [h.Attribute('readonly', 'true')] : []),
    ...(config.isInvalid === true ? [h.AriaInvalid(true), h.DataAttribute('invalid', '')] : []),
    ...(config.name === undefined ? [] : [h.Name(config.name)]),
    ...(config.type === undefined ? [] : [h.Type(config.type)]),
    ...(config.placeholder === undefined ? [] : [h.Placeholder(config.placeholder)]),
    h.DataAttribute('slot', 'input-group-control'),
    h.Class(cn(inputClass, inputGroupInputClass, config.className)),
    ...(config.attributes ?? []),
  ])

export type InputGroupButtonConfig<M> = Omit<ButtonConfig<M>, 'size'> &
  Readonly<{
    /** Group-local size, keys `cn-input-group-button-size-*` tokens. */
    size?: InputGroupButtonSize
  }>

/** A `button` styled to sit inside an `inputGroup`. Ghost by default, sized by the group tokens. */
export const inputGroupButton = <M>(
  config: InputGroupButtonConfig<M>,
  label: Html | string,
  h: HtmlBuilder<M>,
): Html => {
  const size = config.size ?? 'xs'
  const { size: _groupSize, ...buttonConfig } = config
  return button<M>(
    {
      ...buttonConfig,
      variant: config.variant ?? 'ghost',
      className: cn(inputGroupButtonClass, inputGroupButtonSizeClasses[size], config.className),
      attributes: [h.DataAttribute('size', size), ...(config.attributes ?? [])],
    },
    label,
    h,
  )
}

type StyleConfig = Readonly<{ className?: string }>

type AddonConfig = StyleConfig & Readonly<{ align?: InputGroupAddonAlign }>

/** Add-on (text or icon) for either side of the group. Clicking the addon
 *  focuses the contained input (unless the click target is a button), matching
 *  upstream InputGroupAddon's onClick delegation. */
export const inputGroupAddon = <M>(
  config: AddonConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html => {
  const align = config.align ?? 'inline-start'
  return h.div(
    [
      h.Role('group'),
      h.DataAttribute('slot', 'input-group-addon'),
      h.DataAttribute('align', align),
      h.Class(cn(inputGroupAddonClass, inputGroupAddonAlignClasses[align], config.className)),
      h.Attribute(
        'onclick',
        "if(!event.target.closest('button'))this.parentElement?.querySelector('input')?.focus()",
      ),
    ],
    children,
  )
}

/** Alias kept for backward compatibility, an inline-start text addon.
 *  Upstream renders a `span` with NO data-slot (foldcn previously added
 *  an extra slot; removed to match upstream). */
export const inputGroupText = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html => h.span([h.Class(cn(inputGroupTextClass, config.className))], children)

/** Segmented container. Pass addons and controls as children. */
export const inputGroup = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Role('group'),
      h.Class(cn(inputGroupClass, config.className)),
      h.DataAttribute('slot', 'input-group'),
    ],
    children,
  )
