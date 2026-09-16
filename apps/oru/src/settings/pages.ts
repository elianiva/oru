import type { Html, HtmlBuilder } from 'foldkit/html'
import { card, section } from './controls.ts'

/**
 * Placeholder pages for every settings section behind General. Each is its
 * own named view so the route arms below stay one line each; real controls
 * replace the placeholder card section by section.
 */
const placeholder = <M>(id: string, title: string, blurb: string, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.DataAttribute('settings-page', id), h.Class('flex flex-col gap-6')],
    [
      h.section(
        [h.AriaLabel(title)],
        [
          section({ title }, h),
          card([h.p([h.Class('px-4 py-6 text-sm text-muted-foreground')], [blurb])], h),
        ],
      ),
    ],
  )

export const providersView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('providers', 'Providers', 'Model providers and their credentials will live here.', h)

export const appearanceView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('appearance', 'Appearance', 'Theme, density, and font preferences will live here.', h)

export const keyboardView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('keyboard', 'Keyboard', 'Keyboard shortcuts and keymap overrides will live here.', h)

export const browserView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('browser', 'Browser', 'Built-in browser defaults will live here.', h)

export const usageLimitsView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('usage-limits', 'Usage limits', 'Spend caps and usage summaries will live here.', h)

export const filesView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('files', 'Files', 'File watching and ignore rules will live here.', h)

export const projectsView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('projects', 'Projects', 'Tracked projects and their defaults will live here.', h)

export const machinesView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('machines', 'Machines', 'Connected machines and remote executors will live here.', h)

export const updatesView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('updates', 'Updates', 'Release channel and update checks will live here.', h)

export const installedPluginsView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder(
    'installed-plugins',
    'Installed plugins',
    'Installed plugins and their toggles will live here.',
    h,
  )

export const pluginMarketplacesView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder(
    'plugin-marketplaces',
    'Plugin marketplaces',
    'Configured plugin marketplaces will live here.',
    h,
  )

export const experimentsView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('experiments', 'Experiments', 'Opt-in experiments will live here.', h)

export const communityView = <M>(h: HtmlBuilder<M>): Html =>
  placeholder('community', 'Community', 'Community links and attribution will live here.', h)
