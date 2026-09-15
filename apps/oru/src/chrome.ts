import type { Html, HtmlBuilder } from 'foldkit/html'
import { Empty } from '@/components/ui/empty.ts'
import {
  init as initSidebar,
  Sidebar,
  SidebarInset,
  view as sidebarView,
  type Message as SidebarMessage,
  type Model as SidebarModel,
  type SidebarSlots,
} from '@/components/ui/sidebar.ts'

export const initRailSidebar = (): SidebarModel =>
  initSidebar({ id: 'oru-rail', cookieName: 'oru-rail' })

export const initInfoSidebar = (): SidebarModel =>
  initSidebar({ id: 'oru-info', cookieName: 'oru-info' })

/**
 * The app's chrome: a rail sidebar, a centre pane, and an info sidebar.
 *
 * Every region is built by the caller with the caller's own `h`, so a control
 * it puts there dispatches the app's messages. The chrome owns the sidebar
 * nesting, because the info sidebar shares the rail's provider.
 */
export type Chrome<M> = Readonly<{
  railSidebar: SidebarModel
  infoSidebar: SidebarModel
  toRail: (message: SidebarMessage) => M
  toInfo: (message: SidebarMessage) => M
  header: ReadonlyArray<Html>
  rail: ReadonlyArray<Html>
  info: ReadonlyArray<Html>
  pane: Html | undefined
}>

const railChrome = <M>(
  config: Chrome<M>,
  slots: SidebarSlots,
  h: HtmlBuilder<M>,
): ReadonlyArray<Html> => [
  Sidebar.header(
    { className: 'flex flex-row items-center gap-1 p-2' },
    [...config.header, Sidebar.trigger(slots.trigger, {}, h)],
    h,
  ),
  Sidebar.content({}, config.rail, h),
  Sidebar.rail(slots.rail, {}, h),
]

const infoChrome = <M>(
  config: Chrome<M>,
  slots: SidebarSlots,
  h: HtmlBuilder<M>,
): ReadonlyArray<Html> => [
  Sidebar.header(
    { className: 'flex flex-row items-center justify-end gap-0.5' },
    [Sidebar.trigger(slots.trigger, {}, h)],
    h,
  ),
  Sidebar.content({ className: 'gap-3 px-1' }, config.info, h),
  Sidebar.rail(slots.rail, {}, h),
]

export const chrome = <M>(config: Chrome<M>, h: HtmlBuilder<M>): Html =>
  h.submodel({
    slotId: 'oru-rail',
    model: config.railSidebar,
    view: sidebarView,
    viewInputs: {
      side: 'left',
      collapsible: 'icon',
      content: (slots) => railChrome(config, slots, h),
      children: () => [
        SidebarInset(
          { className: 'min-h-0 min-w-0 w-auto' },
          [config.pane ?? Empty({}, [Empty.header({}, [Empty.title({}, ['No thread'], h)], h)], h)],
          h,
        ),
        h.submodel({
          slotId: 'oru-info',
          model: config.infoSidebar,
          view: sidebarView,
          viewInputs: {
            side: 'right',
            collapsible: 'icon',
            className: 'contents',
            content: (slots) => infoChrome(config, slots, h),
            children: () => [],
          },
          toParentMessage: config.toInfo,
        }),
      ],
    },
    toParentMessage: config.toRail,
  })
