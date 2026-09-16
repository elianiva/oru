/**
 * The left column: a t3code-style thread list.
 *
 * The list never re-orders: rows hold the place the source gave them, and each
 * row carries its own status, so the sidebar only moves when you act. The
 * footer holds the app's navigation.
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
  Folder,
  FolderGit,
  GitBranch,
  MessagesSquare,
  Settings,
} from 'lucide'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'
import type { ThreadProject, ThreadRow, ThreadSection, ThreadStatus } from './threads.ts'

const CLOCK_INTERVAL_MS = 30_000

export const Model = S.Struct({
  expandedSections: S.Array(S.String),
  now: S.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ToggledSection: { id: S.String },
  ClickedThread: { id: S.String },
  Ticked: { now: S.Number },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  Selected: { id: S.String },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  expandedSections: ['pinned', 'active'],
  now: Date.now(),
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

/** The slot holds a status word or an age, never both, so `'idle'` names no word. */
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

/** Fixed width, because an age and a status word vary in width: a variable slot drags the project column back and forth. */
const statusSlot = (row: ThreadRow, now: number, h: HtmlBuilder<Message>): Html => {
  const label = statusLabel(row.status)
  return h.span(
    [h.Class('flex w-16 shrink-0 items-center justify-end')],
    [
      label === undefined
        ? h.span(
            [h.Class('tabular-nums text-2xs text-muted-foreground')],
            [relativeAge(row.updatedAt, now)],
          )
        : h.span(
            [h.Class(cn('max-w-full truncate text-2xs font-medium', statusTone(row.status)))],
            [label],
          ),
    ],
  )
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
            h.Class('mt-1 ml-1 flex flex-col gap-px border-l border-border pl-3'),
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
): Html =>
  h.li(
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
                'flex shrink-0 items-center justify-end text-2xs text-muted-foreground tabular-nums',
              ),
            ],
            [statusLabel(row.status) ?? relativeAge(row.updatedAt, config.now)],
          ),
        ],
      ),
      ...subagentList(row, depth + 1, config, h),
    ],
  )

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
              config.selected
                ? 'bg-sidebar-accent ring-1 ring-inset ring-primary/60'
                : 'hover:bg-sidebar-accent/60',
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
              statusSlot(row, config.now, h),
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
              ...(row.activity === 0
                ? []
                : [
                    h.span(
                      [
                        h.Class('shrink-0 rounded bg-muted px-1 font-mono text-2xs'),
                        h.AriaLabel(`${String(row.activity)} background activities`),
                      ],
                      [String(row.activity)],
                    ),
                  ]),
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
          h.span([h.Class('h-px flex-1 bg-sidebar-border')], []),
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
                h.Class(
                  cn(
                    'flex flex-col gap-px',
                    group.rows.length > 1 && 'rounded-lg border border-sidebar-border/30 p-px',
                  ),
                ),
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

const NAV_ROWS: ReadonlyArray<Readonly<{ id: string; label: string; icon: IconNode }>> = [
  { id: 'threads', label: 'Threads', icon: MessagesSquare },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const navRow = (
  row: Readonly<{ id: string; label: string; icon: IconNode }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.DataAttribute('nav', row.id),
      ...(row.id === 'threads' ? [h.DataAttribute('active', 'true')] : []),
      h.Class(
        cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150 ease-out',
          row.id === 'threads'
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        ),
      ),
    ],
    [icon(h, row.icon, 'size-4'), h.span([h.Class('truncate')], [row.label])],
  )

const navFooter = (h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class('flex shrink-0 flex-col gap-1 border-t border-border-seam p-1.5')],
    NAV_ROWS.map((row) => navRow(row, h)),
  )

export type ViewInputs = Readonly<{
  sections: ReadonlyArray<ThreadSection>
  selected: Option.Option<string>
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
  h.div(
    [h.DataAttribute('thread-list', ''), h.Class('flex h-full min-h-0 flex-col')],
    [
      h.div(
        [h.Class('min-h-0 flex-1 overflow-y-auto px-1.5 pb-2')],
        [
          h.div(
            [h.Class('flex flex-col gap-1.5')],
            viewInputs.sections.map((section) =>
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
      navFooter(h),
    ],
  ),
)
