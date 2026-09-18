/**
 * The left column: a t3code-style thread list.
 *
 * The list never re-orders: rows hold the place the source gave them, and each
 * row carries its own status, so the sidebar only moves when you act. The
 * The menu above the list and the action bar below it mirror the reference
 * app's chrome; both stay visual until the app grows the features behind them.
 */
import { Effect, Option, Queue, Schema as S, Stream } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'
import type { IconNode } from 'lucide'
import {
  ChevronDown,
  Computer,
  FolderGit,
  GitBranch,
  MessageCirclePlus,
  Plug,
  Plus,
  Search,
  Settings,
  Undo2,
  Zap,
} from 'lucide'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'
import { homeRouter, settingsIndexRouter } from './route.ts'
import type { ThreadProject, ThreadRow, ThreadSection, ThreadStatus } from './threads.ts'

const CLOCK_INTERVAL_MS = 30_000

/** The project filter: shut, or open on the project list. */
export const FilterClosed = S.TaggedStruct('FilterClosed', {})
export const FilterOpen = S.TaggedStruct('FilterOpen', {})
export const ProjectFilter = S.Union([FilterClosed, FilterOpen])
export type ProjectFilter = typeof ProjectFilter.Type

export const Model = S.Struct({
  expandedSections: S.Array(S.String),
  now: S.Number,
  filter: ProjectFilter,
  /** The project the list is filtered to, as an id. Absent means all. */
  selectedProject: S.UndefinedOr(S.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ToggledSection: { id: S.String },
  ClickedThread: { id: S.String },
  Ticked: { now: S.Number },
  ToggledProjectFilter: {},
  SelectedProjectFilter: { project: S.UndefinedOr(S.String) },
  ClickedNewProject: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Selected: { id: S.String },
  RequestedNewProject: {},
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  expandedSections: ['pinned', 'active'],
  now: Date.now(),
  filter: FilterClosed.make({}),
  selectedProject: undefined,
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    ToggledSection: ({ id }) => ({
      model: evo(model, {
        expandedSections: () =>
          model.expandedSections.includes(id)
            ? model.expandedSections.filter((current) => current !== id)
            : [...model.expandedSections, id],
      }),
    }),
    ClickedThread: ({ id }) => ({ model, outMessage: OutMessage.Selected({ id }) }),
    Ticked: ({ now }) => ({ model: evo(model, { now: () => now }) }),
    ToggledProjectFilter: () => ({
      model: evo(model, {
        filter: (filter) =>
          S.is(FilterClosed)(filter) ? FilterOpen.make({}) : FilterClosed.make({}),
      }),
    }),
    SelectedProjectFilter: ({ project }) => ({
      model: evo(model, {
        selectedProject: () => project,
        filter: () => FilterClosed.make({}),
      }),
    }),
    ClickedNewProject: () => ({
      model: evo(model, { filter: () => FilterClosed.make({}) }),
      outMessage: OutMessage.RequestedNewProject(),
    }),
  })

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  clock: entry(
    { isTicking: S.Boolean },
    {
      modelToDependencies: () => ({ isTicking: true }),
      dependenciesToStream: ({ isTicking }) =>
        Stream.when(
          Stream.callback<Message>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                Queue.offerUnsafe(queue, Message.Ticked({ now: Date.now() }))
                return window.setInterval(() => {
                  Queue.offerUnsafe(queue, Message.Ticked({ now: Date.now() }))
                }, CLOCK_INTERVAL_MS)
              }),
              (handle) => Effect.sync(() => window.clearInterval(handle)),
            ).pipe(Effect.flatMap(() => Effect.never)),
          ),
          Effect.sync(() => isTicking),
        ),
    },
  ),
}))

const STATUS_LABELS: Readonly<Record<Exclude<ThreadStatus, 'idle'>, string>> = {
  failed: 'Failed',
  'needs-you': 'Needs you',
  unread: 'Unread',
  working: 'Working',
  workflow: 'Workflow',
  agent: 'Agent',
  command: 'Command',
  planning: 'Planning',
  goal: 'Goal',
  draft: 'Draft',
}

const STATUS_TONES: Readonly<Record<Exclude<ThreadStatus, 'idle'>, string>> = {
  failed: 'text-status-failed',
  'needs-you': 'text-status-attention',
  unread: 'text-status-unread',
  working: 'text-status-working',
  workflow: 'text-status-working',
  agent: 'text-status-working',
  command: 'text-status-working',
  planning: 'text-status-working',
  goal: 'text-status-working',
  draft: 'text-status-draft',
}

/** The details panel names the status word, so `'idle'` names no word. The list itself carries status as dots, never words. */
export const statusLabel = (status: ThreadStatus): string | undefined =>
  status === 'idle' ? undefined : STATUS_LABELS[status]

export const statusTone = (status: ThreadStatus): string =>
  status === 'idle' ? 'text-muted-foreground' : STATUS_TONES[status]

const relativeAge = (updatedAt: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const locationGlyph = (row: ThreadRow): typeof FolderGit =>
  row.location.kind === 'worktree'
    ? FolderGit
    : row.location.kind === 'branch'
      ? GitBranch
      : Computer

const projectGlyph = (project: ThreadProject, h: HtmlBuilder<Message>): Html =>
  Option.match(project.iconUrl, {
    onNone: () =>
      h.span(
        [
          h.DataAttribute('project-monogram', ''),
          h.Class(
            'flex size-3 shrink-0 items-center justify-center rounded-[3px] bg-muted text-[8px] font-medium text-muted-foreground uppercase',
          ),
        ],
        [project.name.slice(0, 1)],
      ),
    onSome: (src) => h.img([h.Src(src), h.Alt(''), h.Class('size-3 shrink-0 rounded-[3px]')]),
  })

/** Fixed width, because an age varies in width (`3m` versus `12d`): a variable slot drags the project column back and forth. The top-right slot is always the age; the status lives in the bottom row as dots. */
const ageSlot = (row: ThreadRow, now: number, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.DataAttribute('thread-age', ''), h.Class('flex w-16 shrink-0 items-center justify-end')],
    [
      h.span(
        [h.Class('tabular-nums text-2xs text-muted-foreground')],
        [relativeAge(row.updatedAt, now)],
      ),
    ],
  )

/** The dots preview whose statuses the count behind them stands for: the row's own when it works alone, its children's when it fronts subagents. */
const MAX_PILL_DOTS = 3

const activityPill = (row: ThreadRow, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const frontsSubagents = row.children.length > 0
  const count = frontsSubagents ? row.children.length : row.activity
  if (count === 0) return []
  const dotted: ReadonlyArray<ThreadRow> = frontsSubagents
    ? row.children.slice(0, MAX_PILL_DOTS)
    : [row]
  return [
    h.span(
      [
        h.DataAttribute('activity-pill', ''),
        h.AriaLabel(
          frontsSubagents ? `${String(count)} subagents` : `${String(count)} background activities`,
        ),
        h.Class('flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px'),
      ],
      [
        ...dotted.map((dottedRow) =>
          h.span(
            [
              h.Class(
                cn('size-1.5 shrink-0 rounded-full bg-current', statusTone(dottedRow.status)),
              ),
            ],
            [],
          ),
        ),
        h.span([h.Class('font-mono text-2xs tabular-nums')], [String(count)]),
      ],
    ),
  ]
}

/** The renderer's bound: a source can hand back a cycle, and a cycle is a hang, not a wrong pixel. */
const MAX_SUBAGENT_DEPTH = 3

const drawsSubagents = (row: ThreadRow, depth: number): boolean =>
  row.children.length > 0 && depth <= MAX_SUBAGENT_DEPTH

const subagentList = (
  row: ThreadRow,
  depth: number,
  config: Readonly<{ selected: boolean; now: number }>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  drawsSubagents(row, depth)
    ? [
        h.ul(
          [
            h.AriaLabel(`Subagents of ${row.title}`),
            h.DataAttribute('subagent-list', String(depth)),
            h.Class('mt-1 ml-2 flex flex-col gap-px pl-3'),
          ],
          row.children.map((child) => childRow(child, depth, config, h)),
        ),
      ]
    : []

const childRow = (
  row: ThreadRow,
  depth: number,
  config: Readonly<{ selected: boolean; now: number }>,
  h: HtmlBuilder<Message>,
): Html => {
  const childCount = row.children.length > 0 ? row.children.length : row.activity
  return h.li(
    [h.Class('list-none')],
    [
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('thread-row', row.id),
          ...(config.selected ? [h.AriaCurrent('page')] : []),
          h.AriaLabel(`Subagent: ${row.title}`),
          h.OnClick(Message.ClickedThread({ id: row.id })),
          h.Class(
            cn(
              'flex h-7 w-full items-center gap-2 rounded-md pr-1 pl-2 text-left transition-colors duration-150 ease-out',
              config.selected ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
            ),
          ),
        ],
        [
          h.span(
            [h.Class(cn('size-1.5 shrink-0 rounded-full bg-current', statusTone(row.status)))],
            [],
          ),
          h.span([h.Class('min-w-0 flex-1 truncate text-xs')], [row.title]),
          h.span(
            [
              h.Class(
                'flex shrink-0 items-center justify-end gap-1.5 text-2xs text-muted-foreground tabular-nums',
              ),
            ],
            [
              h.span(
                [h.DataAttribute('thread-age', ''), h.Class('tabular-nums')],
                [relativeAge(row.updatedAt, config.now)],
              ),
              ...(childCount === 0
                ? []
                : [
                    h.span(
                      [h.DataAttribute('subagent-count', ''), h.Class('font-mono')],
                      [String(childCount)],
                    ),
                  ]),
            ],
          ),
        ],
      ),
      ...subagentList(row, depth + 1, config, h),
    ],
  )
}

/** The card holds no nested control, so the row is one button instead of an anchor with an overlay. */
const threadCard = (
  row: ThreadRow,
  config: Readonly<{ selected: boolean; now: number }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [h.Class('list-none')],
    [
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('thread-row', row.id),
          ...(config.selected ? [h.AriaCurrent('page')] : []),
          h.AriaLabel(`${config.selected ? 'Selected, ' : ''}${row.title}`),
          h.OnClick(Message.ClickedThread({ id: row.id })),
          h.Class(
            cn(
              'group/card relative w-full rounded-md px-2.5 py-2 text-left transition-colors duration-150 ease-out',
              config.selected ? 'bg-background shadow-sm' : 'hover:bg-sidebar-accent/60',
            ),
          ),
        ],
        [
          h.div(
            [h.Class('flex h-5 items-center gap-1.5')],
            [
              projectGlyph(row.project, h),
              h.span(
                [h.Class('min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground')],
                [row.project.name],
              ),
              ageSlot(row, config.now, h),
            ],
          ),
          h.div(
            [
              h.Class(
                cn(
                  'mt-0.5 truncate text-sm',
                  row.isUnread ? 'font-medium text-foreground' : 'text-muted-foreground',
                ),
              ),
            ],
            [row.title],
          ),
          h.div(
            [h.Class('mt-0.5 flex h-4 items-center gap-1.5 text-2xs text-muted-foreground')],
            [
              h.span(
                [h.Class('flex min-w-0 flex-1 items-center gap-1 truncate')],
                [
                  icon(h, locationGlyph(row), 'size-3 shrink-0 opacity-60'),
                  h.span([h.Class('truncate font-mono')], [row.location.name]),
                ],
              ),
              ...activityPill(row, h),
              ...(row.pullRequest === undefined
                ? []
                : [h.span([h.Class('shrink-0 font-mono')], [`#${String(row.pullRequest)}`])]),
            ],
          ),
        ],
      ),
      ...subagentList(row, 1, config, h),
    ],
  )

/** A group of more than one row is enclosed; a group of one is not. */
const projectGroups = (
  rows: ReadonlyArray<ThreadRow>,
): ReadonlyArray<Readonly<{ project: string; label: string; rows: ReadonlyArray<ThreadRow> }>> => {
  const groups: Array<{ project: string; label: string; rows: Array<ThreadRow> }> = []
  for (const row of rows) {
    const group = groups.find((candidate) => candidate.project === row.project.id)
    if (group === undefined) {
      groups.push({ project: row.project.id, label: row.project.name, rows: [row] })
    } else {
      group.rows.push(row)
    }
  }
  return groups
}

const shelf = (
  section: ThreadSection,
  expanded: boolean,
  selected: Option.Option<string>,
  now: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.AriaLabel(section.label), h.DataAttribute('thread-section', section.id)],
    [
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('section-toggle', section.id),
          h.AriaExpanded(expanded),
          h.OnClick(Message.ToggledSection({ id: section.id })),
          h.Class('mt-3 flex w-full items-center gap-2 px-2.5 pb-1 text-left'),
        ],
        [
          h.span(
            [h.Class('text-2xs font-medium text-muted-foreground/70')],
            [expanded ? section.label : `${section.label} (${String(section.rows.length)})`],
          ),
          h.span([h.Class('flex-1')], []),
          h.span(
            [h.Class('flex size-3.5 shrink-0 items-center justify-center')],
            [
              icon(
                h,
                ChevronDown,
                cn(
                  'size-3 text-muted-foreground/70 transition-transform duration-150 ease-out',
                  expanded && 'rotate-180',
                ),
              ),
            ],
          ),
        ],
      ),
      ...(expanded
        ? projectGroups(section.rows).map((group) =>
            h.ul(
              [
                h.AriaLabel(`${group.label} threads`),
                h.DataAttribute('thread-group', group.project),
                h.Class('flex flex-col gap-1'),
              ],
              group.rows.map((row) =>
                threadCard(row, { selected: isSelected(selected, row.id), now }, h),
              ),
            ),
          )
        : []),
    ],
  )

const isSelected = (selected: Option.Option<string>, id: string): boolean =>
  Option.match(selected, { onNone: () => false, onSome: (current) => current === id })

/** The sidebar menu mirrors the reference app's chrome. The rows stay visual until the app grows the features behind them, so they carry no messages. */
const NAV_ROWS: ReadonlyArray<Readonly<{ id: string; label: string; icon: IconNode }>> = [
  { id: 'new-thread', label: 'New thread', icon: MessageCirclePlus },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'search', label: 'Search threads', icon: Search },
  { id: 'automations', label: 'Automations', icon: Undo2 },
]

const navRow = (
  row: Readonly<{ id: string; label: string; icon: IconNode }>,
  h: HtmlBuilder<Message>,
): Html => {
  const attrs = [
    h.DataAttribute('nav', row.id),
    h.Class(
      'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground/80 transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    ),
  ] as const
  const children = [icon(h, row.icon, 'size-4'), h.span([h.Class('truncate')], [row.label])]
  // `/` is the new-thread route, so the row is a link; the rest stay visual
  // until the app grows the features behind them.
  return row.id === 'new-thread'
    ? h.a([h.Href(homeRouter()), ...attrs], [...children])
    : h.div([...attrs], [...children])
}

const navMenu = (h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.DataAttribute('sidebar-menu', ''), h.Class('flex shrink-0 flex-col gap-px')],
    NAV_ROWS.map((row) => navRow(row, h)),
  )

export type FilterProject = Readonly<{
  id: string
  name: string
}>

const filterLabel = (model: Model, projects: ReadonlyArray<FilterProject>): string =>
  model.selectedProject === undefined
    ? 'All projects'
    : (projects.find((project) => project.id === model.selectedProject)?.name ?? 'All projects')

/** Rows the filter keeps: the selected project, or every row when shut to all. */
export const filteredSections = (
  model: Model,
  sections: ReadonlyArray<ThreadSection>,
): ReadonlyArray<ThreadSection> => {
  if (model.selectedProject === undefined) return sections
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => row.project.id === model.selectedProject)
    return rows.length === 0 ? [] : [{ ...section, rows }]
  })
}

const projectFilter = (
  model: Model,
  projects: ReadonlyArray<FilterProject>,
  h: HtmlBuilder<Message>,
): Html => {
  const isOpen = S.is(FilterOpen)(model.filter)
  return h.div(
    [h.DataAttribute('project-filter', ''), h.Class('relative mt-1.5 shrink-0')],
    [
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('project-filter-trigger', ''),
          h.AriaHasPopup('menu'),
          h.AriaExpanded(isOpen),
          h.OnClick(Message.ToggledProjectFilter()),
          h.Class(
            'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors duration-150 ease-out hover:bg-sidebar-accent',
          ),
        ],
        [
          h.span(
            [h.Class('truncate text-sm font-medium text-muted-foreground')],
            [filterLabel(model, projects)],
          ),
          h.span(
            [h.Class('ml-auto flex shrink-0 items-center')],
            [icon(h, ChevronDown, 'size-4 text-muted-foreground/70')],
          ),
        ],
      ),
      ...(isOpen
        ? [
            h.div(
              [
                h.DataAttribute('project-filter-panel', ''),
                h.AriaLabel('Filter by project'),
                h.Class(
                  'absolute top-full right-1.5 left-1.5 z-30 mt-1 rounded-xl border border-border/60 bg-card p-1 shadow-lg',
                ),
              ],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('project-filter-option', 'all'),
                    h.OnClick(Message.SelectedProjectFilter({ project: undefined })),
                    h.Class(
                      cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                        model.selectedProject === undefined && 'bg-accent',
                      ),
                    ),
                  ],
                  ['All projects'],
                ),
                ...projects.map((project) =>
                  h.button(
                    [
                      h.Type('button'),
                      h.DataAttribute('project-filter-option', project.id),
                      h.OnClick(Message.SelectedProjectFilter({ project: project.id })),
                      h.Class(
                        cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                          model.selectedProject === project.id && 'bg-accent',
                        ),
                      ),
                    ],
                    [project.name],
                  ),
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('project-filter-option', 'new'),
                    h.OnClick(Message.ClickedNewProject()),
                    h.Class(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent',
                    ),
                  ],
                  [icon(h, Plus, 'size-4'), 'New project…'],
                ),
              ],
            ),
          ]
        : []),
    ],
  )
}

const bottomBar = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('sidebar-actions', ''),
      h.Class('flex shrink-0 items-center gap-5 text-muted-foreground'),
    ],
    [
      h.a(
        [
          h.Href(settingsIndexRouter()),
          h.AriaLabel('Settings'),
          h.DataAttribute('nav', 'settings'),
          h.Class(
            'flex size-7 items-center justify-center rounded-md transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          ),
        ],
        [icon(h, Settings, 'size-4')],
      ),
    ],
  )

export type ViewInputs = Readonly<{
  sections: ReadonlyArray<ThreadSection>
  selected: Option.Option<string>
  projects: ReadonlyArray<FilterProject>
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
  h.div(
    [h.DataAttribute('thread-list', ''), h.Class('flex h-full min-h-0 flex-col')],
    [
      navMenu(h),
      projectFilter(model, viewInputs.projects, h),
      h.div(
        [h.Class('min-h-0 flex-1 overflow-y-auto px-1.5 pb-2')],
        [
          h.div(
            [h.Class('flex flex-col gap-1.5')],
            filteredSections(model, viewInputs.sections).map((section) =>
              shelf(
                section,
                model.expandedSections.includes(section.id),
                viewInputs.selected,
                model.now,
                h,
              ),
            ),
          ),
        ],
      ),
      bottomBar(h),
    ],
  ),
)
