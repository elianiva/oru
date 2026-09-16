import { pipe } from 'effect'
import { Route } from 'foldkit'
import { Schema } from 'effect'
import type { IconNode } from 'lucide'
import {
  Bot,
  ChartColumn,
  FlaskConical,
  Folder,
  FolderGit,
  Globe,
  Keyboard,
  Laptop,
  MessagesSquare,
  Package,
  Palette,
  Plug,
  Puzzle,
  Settings as SettingsGlyph,
} from 'lucide'

/**
 * Every page in the app, settings pages included. Each settings section is
 * its own variant with its own router below, so a URL parses to exactly one
 * page and every page builds back to exactly one URL. Nothing matches on
 * raw pathname strings.
 */
export const AppRoute = Route.defineRouteUnion({
  Home: {},
  SettingsGeneral: {},
  SettingsProviders: {},
  SettingsAppearance: {},
  SettingsKeyboard: {},
  SettingsBrowser: {},
  SettingsUsageLimits: {},
  SettingsFiles: {},
  SettingsProjects: {},
  SettingsMachines: {},
  SettingsUpdates: {},
  SettingsInstalledPlugins: {},
  SettingsPluginMarketplaces: {},
  SettingsExperiments: {},
  SettingsCommunity: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home))

/** `/settings` has no page of its own; it lands on General. */
export const settingsIndexRouter = pipe(
  Route.literal('settings'),
  Route.mapTo(AppRoute.SettingsGeneral),
)

export const settingsGeneralRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('general')),
  Route.mapTo(AppRoute.SettingsGeneral),
)

export const settingsProvidersRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('providers')),
  Route.mapTo(AppRoute.SettingsProviders),
)

export const settingsAppearanceRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('appearance')),
  Route.mapTo(AppRoute.SettingsAppearance),
)

export const settingsKeyboardRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('keyboard')),
  Route.mapTo(AppRoute.SettingsKeyboard),
)

export const settingsBrowserRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('browser')),
  Route.mapTo(AppRoute.SettingsBrowser),
)

export const settingsUsageLimitsRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('usage-limits')),
  Route.mapTo(AppRoute.SettingsUsageLimits),
)

export const settingsFilesRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('files')),
  Route.mapTo(AppRoute.SettingsFiles),
)

export const settingsProjectsRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('projects')),
  Route.mapTo(AppRoute.SettingsProjects),
)

export const settingsMachinesRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('machines')),
  Route.mapTo(AppRoute.SettingsMachines),
)

export const settingsUpdatesRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('updates')),
  Route.mapTo(AppRoute.SettingsUpdates),
)

export const settingsInstalledPluginsRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('installed-plugins')),
  Route.mapTo(AppRoute.SettingsInstalledPlugins),
)

export const settingsPluginMarketplacesRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('plugin-marketplaces')),
  Route.mapTo(AppRoute.SettingsPluginMarketplaces),
)

export const settingsExperimentsRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('experiments')),
  Route.mapTo(AppRoute.SettingsExperiments),
)

export const settingsCommunityRouter = pipe(
  Route.literal('settings'),
  Route.slash(Route.literal('community')),
  Route.mapTo(AppRoute.SettingsCommunity),
)

/**
 * A router only matches when it consumes the whole URL, so the bare
 * `/settings` index never shadows a section beneath it. Specific sections
 * still come first, keeping the order obviously safe.
 */
const routeParser = Route.oneOf(
  settingsGeneralRouter,
  settingsProvidersRouter,
  settingsAppearanceRouter,
  settingsKeyboardRouter,
  settingsBrowserRouter,
  settingsUsageLimitsRouter,
  settingsFilesRouter,
  settingsProjectsRouter,
  settingsMachinesRouter,
  settingsUpdatesRouter,
  settingsInstalledPluginsRouter,
  settingsPluginMarketplacesRouter,
  settingsExperimentsRouter,
  settingsCommunityRouter,
  settingsIndexRouter,
  homeRouter,
)

export const urlToAppRoute = Route.parseUrlWithFallback(routeParser, AppRoute.NotFound)

export type SettingsSectionId =
  | 'general'
  | 'providers'
  | 'appearance'
  | 'keyboard'
  | 'browser'
  | 'usage-limits'
  | 'files'
  | 'projects'
  | 'machines'
  | 'updates'
  | 'installed-plugins'
  | 'plugin-marketplaces'
  | 'experiments'
  | 'community'

export type SettingsSection = Readonly<{
  id: SettingsSectionId
  label: string
  href: string
  icon: IconNode
}>

/**
 * The sidebar order. `href` comes from the section router, never from a
 * hand-written path, so renaming a route moves its link with it.
 */
export const settingsSections: ReadonlyArray<SettingsSection> = [
  { id: 'general', label: 'General', href: settingsGeneralRouter(), icon: SettingsGlyph },
  { id: 'providers', label: 'Providers', href: settingsProvidersRouter(), icon: Bot },
  { id: 'appearance', label: 'Appearance', href: settingsAppearanceRouter(), icon: Palette },
  { id: 'keyboard', label: 'Keyboard', href: settingsKeyboardRouter(), icon: Keyboard },
  { id: 'browser', label: 'Browser', href: settingsBrowserRouter(), icon: Globe },
  {
    id: 'usage-limits',
    label: 'Usage limits',
    href: settingsUsageLimitsRouter(),
    icon: ChartColumn,
  },
  { id: 'files', label: 'Files', href: settingsFilesRouter(), icon: Folder },
  { id: 'projects', label: 'Projects', href: settingsProjectsRouter(), icon: FolderGit },
  { id: 'machines', label: 'Machines', href: settingsMachinesRouter(), icon: Laptop },
  { id: 'updates', label: 'Updates', href: settingsUpdatesRouter(), icon: Package },
  {
    id: 'installed-plugins',
    label: 'Installed plugins',
    href: settingsInstalledPluginsRouter(),
    icon: Plug,
  },
  {
    id: 'plugin-marketplaces',
    label: 'Plugin marketplaces',
    href: settingsPluginMarketplacesRouter(),
    icon: Puzzle,
  },
  {
    id: 'experiments',
    label: 'Experiments',
    href: settingsExperimentsRouter(),
    icon: FlaskConical,
  },
  { id: 'community', label: 'Community', href: settingsCommunityRouter(), icon: MessagesSquare },
]

const sectionIdForRoute = (route: AppRoute): SettingsSectionId | undefined =>
  AppRoute.match(route, {
    Home: () => undefined,
    SettingsGeneral: () => 'general',
    SettingsProviders: () => 'providers',
    SettingsAppearance: () => 'appearance',
    SettingsKeyboard: () => 'keyboard',
    SettingsBrowser: () => 'browser',
    SettingsUsageLimits: () => 'usage-limits',
    SettingsFiles: () => 'files',
    SettingsProjects: () => 'projects',
    SettingsMachines: () => 'machines',
    SettingsUpdates: () => 'updates',
    SettingsInstalledPlugins: () => 'installed-plugins',
    SettingsPluginMarketplaces: () => 'plugin-marketplaces',
    SettingsExperiments: () => 'experiments',
    SettingsCommunity: () => 'community',
    NotFound: () => undefined,
  })

/** The sidebar section a route belongs to, if it is a settings page at all. */
export const sectionForRoute = (route: AppRoute): SettingsSection | undefined => {
  const id = sectionIdForRoute(route)
  if (id === undefined) return undefined
  return settingsSections.find((section) => section.id === id)
}

/** Document titles derive from the same section list the sidebar renders. */
export const titleForRoute = (route: AppRoute): string => {
  const section = sectionForRoute(route)
  if (section !== undefined) return `${section.label} - Settings | oru`
  if (AppRoute.guards.Home(route)) return 'oru'
  return 'Not found | oru'
}
