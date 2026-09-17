import { Combobox as FoldkitCombobox } from '@foldkit/ui'
import type { AnchorConfig } from '@foldkit/ui/combobox'
import type { Option } from 'effect/Option'
import {
  childAttributes,
  inertHtml,
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
} from 'foldkit/html'

import { icon } from '@/lib/icons'
import { Check, ChevronDown } from 'lucide'
import { cn } from '@/lib/utils'

// Re-export the @foldkit/ui Combobox surface. Create a bundle once per
// item type:
//
//   export const CityCombobox = Combobox.create<City>()
//   export const CityMultiCombobox = Combobox.Multi.create<City>()

export const create = FoldkitCombobox.create
export const Multi = FoldkitCombobox.Multi
export const init = (config: InitConfig): Model =>
  FoldkitCombobox.init({ isAnimated: true, ...config })
export const inputId = FoldkitCombobox.inputId
export const Model = FoldkitCombobox.Model
export type Model = typeof Model.Type
export const Message = FoldkitCombobox.Message
export type Message = typeof Message.Type
export const OutMessage = FoldkitCombobox.OutMessage
export type OutMessage = typeof OutMessage.Type

export type Bundle<Item extends string = string> = FoldkitCombobox.Bundle<Item>
export type InitConfig = FoldkitCombobox.InitConfig
export type ViewInputs<Item extends string = string> = FoldkitCombobox.ViewInputs<Item>
export type ItemConfig = FoldkitCombobox.ItemConfig
export type GroupHeading = FoldkitCombobox.GroupHeading

// foldkit deltas: items highlight via data-active (upstream
// data-highlighted:) per the derivation mapping. Gaps vs upstream: no chips
// UI for multi-select, no clear button, no Empty row; filtering is
// parent-owned. Content now uses cn-combobox-content family (was bare); item
// stripped of data-selected:font-medium etc — selection indicator is via
// check icon. Chips/clear/empty data-slots not supported — documented gap.

/** foldcn renders a bare input (upstream wraps one in an InputGroup inside
 *  the popup for chips mode); keep the input token string. */
export const comboboxInputClass =
  'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-disabled:bg-input/50 data-disabled:bg-input/50 dark:aria-disabled:bg-input/80 dark:data-disabled:bg-input/80 w-full min-w-0 rounded-md pr-9 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'

export const comboboxButtonClass =
  'absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'

export const comboboxItemsClass =
  'text-popover-foreground data-enter:animate-in data-leave:animate-out data-leave:fade-out-0 data-enter:fade-in-0 data-leave:zoom-out-95 data-enter:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 *:data-[slot=input-group]:bg-input/30 *:data-[slot=input-group]:border-input/30 overflow-hidden rounded-lg shadow-md ring-1 duration-100 *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:shadow-none not-data-[side=bottom]:data-[placement=bottom]:slide-in-from-top-2 not-data-[side=left]:data-[placement=left]:slide-in-from-right-2 not-data-[side=right]:data-[placement=right]:slide-in-from-left-2 not-data-[side=top]:data-[placement=top]:slide-in-from-bottom-2 [--anchor-width:var(--button-width)] overflow-hidden! data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 animate-none! before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground! bg-popover group/combobox-content relative isolate z-50 max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) data-[chips=true]:min-w-(--anchor-width)'

export const comboboxItemsAnimatedClass = comboboxItemsClass

export const comboboxItemClass =
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 relative flex w-full cursor-default items-center outline-hidden select-none data-active:bg-accent data-active:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

export const comboboxGroupHeadingClass = 'text-muted-foreground px-2 py-1.5 text-xs'

export const comboboxSeparatorClass = 'bg-border -mx-1 my-1 h-px'

export const comboboxItemsScrollClass = 'no-scrollbar max-h-72 scroll-py-1 overflow-y-auto p-1'

export const comboboxBackdropClass = 'fixed inset-0 z-0'

export const comboboxWrapperClass = 'relative w-full'

export const comboboxInputWrapperClass = 'relative'

export const COMBOBOX_ANCHOR: AnchorConfig = {
  placement: 'bottom-start',
  gap: 8,
  padding: 8,
}

export const comboboxChevron = <M>(h: HtmlBuilder<M>): Html =>
  h.span([h.Class('shrink-0 text-muted-foreground')], [icon(h, ChevronDown, 'size-4')])

export const comboboxCheck = <M>(h: HtmlBuilder<M>): Html =>
  h.span([h.Class('absolute right-2 flex size-4 items-center justify-center')], [icon(h, Check)])

type CommonConfig<Item extends string> = Readonly<{
  items: ReadonlyArray<Item>
  restingInputValue: string
  itemToConfig: (
    item: Item,
    context: Readonly<{
      isActive: boolean
      isDisabled: boolean
      isReadOnly: boolean
      isSelected: boolean
    }>,
  ) => ItemConfig
  itemToValue: (item: Item, index: number) => Item
  itemToDisplayText: (item: Item, index: number) => string
  anchor?: AnchorConfig
  isItemDisabled?: (item: Item, index: number) => boolean
  inputPlaceholder?: string
  buttonContent?: Html
  isAnimated?: boolean
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  openOnFocus?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  inputAttributes?: ReadonlyArray<ChildAttribute>
  itemsAttributes?: ReadonlyArray<Attribute<unknown>>
  itemGroupKey?: (item: Item, index: number) => string
  groupToHeading?: (groupKey: string) => GroupHeading | undefined
  formName?: string
  inputClass?: string
  itemsClass?: string
  itemsScrollClass?: string
  itemClass?: string
  groupClass?: string
  separatorClass?: string
  backdropClass?: string
  wrapperClass?: string
  inputWrapperClass?: string
}>

const common = <Item extends string>(config: CommonConfig<Item>) => ({
  items: config.items,
  restingInputValue: config.restingInputValue,
  anchor: config.anchor ?? COMBOBOX_ANCHOR,
  isItemDisabled: config.isItemDisabled ?? (() => false),
  itemToValue: config.itemToValue,
  itemToDisplayText: config.itemToDisplayText,
  inputPlaceholder: config.inputPlaceholder,
  buttonContent: config.buttonContent,
  formName: config.formName,
  isDisabled: config.isDisabled,
  isReadOnly: config.isReadOnly,
  isInvalid: config.isInvalid,
  // Base UI opens the popup when the input receives focus. Keep the option
  // overridable for callers that need explicit keyboard-only opening.
  openOnFocus: config.openOnFocus ?? true,
  ariaLabel: config.ariaLabel,
  ariaLabelledBy: config.ariaLabelledBy,
  inputAttributes: config.inputAttributes ?? [],
  itemGroupKey: config.itemGroupKey,
  groupToHeading: config.groupToHeading,
  inputClassName: cn(comboboxInputClass, config.inputClass),
  itemsClassName: cn(
    config.isAnimated !== false ? comboboxItemsAnimatedClass : comboboxItemsClass,
    config.itemsClass,
  ),
  itemsAttributes: childAttributes([
    inertHtml.DataAttribute('slot', 'combobox-content'),
    ...(config.itemsAttributes ?? []),
  ]),
  itemsScrollClassName: config.itemsScrollClass ?? comboboxItemsScrollClass,
  itemToConfig: (item: Item, context: Parameters<CommonConfig<Item>['itemToConfig']>[1]) => {
    const { className, content } = config.itemToConfig(item, context)
    return { className: cn(comboboxItemClass, config.itemClass, className), content }
  },
  groupClassName: cn(comboboxGroupHeadingClass, config.groupClass),
  groupAttributes: childAttributes([inertHtml.DataAttribute('slot', 'combobox-group')]),
  separatorClassName: cn(comboboxSeparatorClass, config.separatorClass),
  separatorAttributes: childAttributes([inertHtml.DataAttribute('slot', 'combobox-separator')]),
  buttonClassName: comboboxButtonClass,
  buttonAttributes: childAttributes([inertHtml.DataAttribute('slot', 'combobox-trigger')]),
  inputWrapperClassName: cn(comboboxInputWrapperClass, config.inputWrapperClass),
  inputWrapperAttributes: childAttributes([
    inertHtml.DataAttribute('slot', 'combobox-input-wrapper'),
  ]),
  backdropClassName: cn(comboboxBackdropClass, config.backdropClass),
  className: cn(comboboxWrapperClass, config.wrapperClass),
  attributes: childAttributes([inertHtml.DataAttribute('slot', 'combobox')]),
})

export type SingleViewInputsConfig<Item extends string> = CommonConfig<Item> &
  Readonly<{
    maybeSelectedValue: Option<Item>
  }>

/** Build styled single-select `Combobox.ViewInputs`.
 *  Mirrors the shadcn v4 `combobox.tsx` trigger/content/item behavior:
 *  chevron trigger, check indicator on the selected item, scrollable list
 *  with max-height, grouping + separator support, and disabled/invalid/
 *  read-only + aria-label states. Filtering is parent-owned: pass the
 *  already-filtered `items` each render. The panel is hidden when `items`
 *  is empty (no empty-state row — show it outside the combobox if needed). */
export const viewInputs = <Item extends string>(
  config: SingleViewInputsConfig<Item>,
): ViewInputs<Item> => ({
  ...common(config),
  maybeSelectedValue: config.maybeSelectedValue,
})

export type MultiViewInputsConfig<Item extends string> = CommonConfig<Item> &
  Readonly<{
    selectedValues: ReadonlyArray<Item>
  }>

/** Build styled multi-select `Combobox.Multi` view inputs.
 *  Mirrors the same trigger/list/item styling as the single-select
 *  variant; the input rests empty after each commit and the parent
 *  toggles membership on `Selected` out-messages. Supports grouping and
 *  the same disabled/invalid/read-only states. */
export const multiViewInputs = <Item extends string>(
  config: MultiViewInputsConfig<Item>,
): FoldkitCombobox.Multi.ViewInputs<Item> => ({
  ...common(config),
  selectedValues: config.selectedValues,
})
