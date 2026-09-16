import type { Html, HtmlBuilder } from 'foldkit/html'
import { ChevronLeft } from 'lucide'
import { homeRouter, sectionForRoute, settingsSections, type AppRoute } from '../route.ts'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The settings shell: a left nav over every settings section and a content
 * slot the route arms fill. The active link derives from the route, never
 * from local state, so back/forward and cold loads highlight correctly.
 *
 * Per-plugin pages mount as a second nav group once their routes land; the
 * shell already takes any content.
 */
const backLink = <M>(h: HtmlBuilder<M>): Html =>
  h.a(
    [
      h.Href(homeRouter()),
      h.DataAttribute('settings-back', ''),
      h.Class(
        'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-sidebar-foreground/80 transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      ),
    ],
    [icon(h, ChevronLeft, 'size-4'), h.span([h.Class('truncate')], ['Back to app'])],
  )

const sectionLink = <M>(
  route: AppRoute,
  section: (typeof settingsSections)[number],
  h: HtmlBuilder<M>,
): Html => {
  const active = sectionForRoute(route)?.id === section.id
  return h.a(
    [
      h.Href(section.href),
      h.DataAttribute('settings-link', section.id),
      ...(active ? [h.AriaCurrent('page')] : []),
      h.Class(
        cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150 ease-out',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        ),
      ),
    ],
    [icon(h, section.icon, 'size-4'), h.span([h.Class('truncate')], [section.label])],
  )
}

const sidebar = <M>(route: AppRoute, h: HtmlBuilder<M>): Html =>
  h.aside(
    [
      h.DataAttribute('settings-nav', ''),
      h.Class('flex h-full min-h-0 w-60 shrink-0 flex-col gap-1 overflow-y-auto p-3'),
    ],
    [
      backLink(h),
      h.div([h.Class('mt-2 px-2 text-2xs font-medium text-muted-foreground/70')], ['Settings']),
      h.nav(
        [h.AriaLabel('Settings sections'), h.Class('flex flex-col gap-px')],
        settingsSections.map((section) => sectionLink(route, section, h)),
      ),
    ],
  )

export const view = <M>(route: AppRoute, content: Html, h: HtmlBuilder<M>): Html =>
  h.div(
    [
      h.DataAttribute('settings', ''),
      h.Class('flex h-full min-h-0 flex-col text-sidebar-foreground'),
    ],
    [
      h.div(
        [h.Class('flex h-10 shrink-0 items-center px-5')],
        [h.span([h.Class('truncate text-sm font-medium')], ['Settings'])],
      ),
      h.div(
        [h.Class('flex min-h-0 flex-1')],
        [
          sidebar(route, h),
          h.main(
            [
              h.DataAttribute('settings-content', ''),
              h.Class('min-h-0 flex-1 overflow-y-auto px-8 py-2 pb-16'),
            ],
            [h.div([h.Class('mx-auto w-full max-w-3xl')], [content])],
          ),
        ],
      ),
    ],
  )
