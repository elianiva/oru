import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils.ts'

/**
 * Presentational tabs: the pill row a picker filters by.
 *
 * Behaviour stays in the owning submodel (which tab is active, what selecting
 * one does), the way `picker-panel.ts` holds geometry and each picker holds
 * its open state. This module owns only the tablist markup and the active
 * styling, so every picker's tabs read as one control.
 */

export const tabsListClass = 'flex items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1'

const tabsTriggerBase =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0'

const tabsTriggerActive = 'bg-background text-foreground shadow-sm'
const tabsTriggerInactive = 'text-muted-foreground hover:bg-background/60'

export type TabsListConfig = Readonly<{
  ariaLabel?: string | undefined
  className?: string | undefined
}>

/** The tablist row. Children are `tabsTrigger` buttons. */
export const tabsList = <M>(
  config: TabsListConfig,
  children: ReadonlyArray<Html | string>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Role('tablist'),
      ...(config.ariaLabel === undefined ? [] : [h.AriaLabel(config.ariaLabel)]),
      h.Class(cn(tabsListClass, config.className)),
      h.DataAttribute('slot', 'tabs-list'),
    ],
    children,
  )

export type TabsTriggerConfig<M> = Readonly<{
  /** The accessible name and the hover tooltip; icon-only tabs have no visible text. */
  label: string
  isActive: boolean
  onSelect: M
  className?: string | undefined
  /** Extra attributes merged onto the tab (data hooks, …). */
  attributes?: ReadonlyArray<Attribute<M>> | undefined
}>

/** One tab: an icon-only button with its name as the tooltip and the selected state on `aria-selected`. */
export const tabsTrigger = <M>(
  config: TabsTriggerConfig<M>,
  children: ReadonlyArray<Html | string>,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      h.Role('tab'),
      h.AriaSelected(config.isActive),
      h.Tabindex(config.isActive ? 0 : -1),
      h.AriaLabel(config.label),
      h.Attribute('title', config.label),
      h.DataAttribute('state', config.isActive ? 'active' : 'inactive'),
      h.OnClick(config.onSelect),
      h.Class(
        cn(
          tabsTriggerBase,
          config.isActive ? tabsTriggerActive : tabsTriggerInactive,
          config.className,
        ),
      ),
      h.DataAttribute('slot', 'tabs-trigger'),
      ...(config.attributes ?? []),
    ],
    children,
  )
