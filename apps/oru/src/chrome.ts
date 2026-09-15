import type { Html, HtmlBuilder } from 'foldkit/html'
import {
  init as initSidebar,
  Sidebar,
  SidebarInset,
  view as sidebarView,
  type Message as SidebarMessage,
  type Model as SidebarModel,
  type SidebarSlots,
} from '@/components/ui/sidebar.ts'

export const initChromeSidebar = (): SidebarModel =>
  initSidebar({ id: 'oru-sidebar', cookieName: 'oru-sidebar' })

export type Chrome<M> = Readonly<{
  sidebar: SidebarModel
  toSidebar: (message: SidebarMessage) => M
  title: string
  sidebarContent: ReadonlyArray<Html | string>
  main: Html
}>

const sidebarColumn = <M>(
  config: Chrome<M>,
  slots: SidebarSlots,
  h: HtmlBuilder<M>,
): ReadonlyArray<Html | string> => [
  Sidebar.header(
    { className: 'flex flex-row items-center gap-1 p-2' },
    [
      h.span([h.Class('truncate px-2 text-sm font-medium')], [config.title]),
      h.span([h.Class('ml-auto')], [Sidebar.trigger(slots.trigger, {}, h)]),
    ],
    h,
  ),
  Sidebar.content({}, config.sidebarContent, h),
  Sidebar.rail(slots.rail, {}, h),
]

export const chrome = <M>(config: Chrome<M>, h: HtmlBuilder<M>): Html =>
  h.submodel({
    slotId: 'oru-sidebar',
    model: config.sidebar,
    view: sidebarView,
    viewInputs: {
      side: 'left',
      collapsible: 'icon',
      content: (slots) => sidebarColumn(config, slots, h),
      children: () => [SidebarInset({}, [config.main], h)],
    },
    toParentMessage: config.toSidebar,
  })
