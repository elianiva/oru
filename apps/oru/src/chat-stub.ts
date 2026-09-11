import type { Html, HtmlBuilder } from 'foldkit/html'
import {
  ArrowUp,
  Bell,
  ChartNoAxesColumn,
  ChevronDown,
  CircleHelp,
  Copy,
  Ellipsis,
  GitPullRequest,
  Mic,
  PanelRight,
  Plus,
  Puzzle,
  Search,
  Settings,
  Workflow,
} from 'lucide'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { Card } from '@/components/ui/card.ts'
import {
  inputGroup,
  inputGroupAddon,
  inputGroupButton,
  inputGroupTextarea,
} from '@/components/ui/input-group.ts'
import {
  Sidebar,
  SidebarInset,
  init as initSidebar,
  view as sidebarView,
  type Message as SidebarMessage,
  type Model as SidebarModel,
  type SidebarSlots,
} from '@/components/ui/sidebar.ts'
import { icon } from '@/lib/icons.ts'

export type StubChild = Readonly<{ title: string; ago: string; dot: string }>

export type StubThread = Readonly<{
  title: string
  selected: boolean
  ago: string
  branch?: string
  children: ReadonlyArray<StubChild>
}>

export type StubLine =
  | Readonly<{ role: 'user'; body: string }>
  | Readonly<{ role: 'assistant'; body: string }>
  | Readonly<{ role: 'tool'; name: string; detail: string }>
  | Readonly<{ role: 'banner'; body: string }>

export type StubCommit = Readonly<{ message: string; sha: string }>

export type StubChange = Readonly<{ mark: string; path: string; add: string; del: string }>

export type StubChrome = Readonly<{
  project: string
  machine: string
  threads: ReadonlyArray<StubThread>
  inactive: ReadonlyArray<string>
  title: string
  children: string
  parent: string
  environment: string
  directory: string
  branch: string
  mergeMode: string
  gitAhead: string
  gitOpen: string
  pr: string
  prChecks: string
  model: string
  effort: string
  commits: ReadonlyArray<StubCommit>
  changes: ReadonlyArray<StubChange>
  lines: ReadonlyArray<StubLine>
}>

export const stubChrome: StubChrome = {
  project: 'oru',
  machine: 'melon',
  threads: [
    {
      title: 'Foldon frontend with shadcn registry',
      selected: true,
      ago: '8m',
      branch: 'feat/oru-foldcn',
      children: [
        { title: 'You are writing an architecture.', ago: '37s', dot: 'bg-emerald-500' },
        { title: 'You are producing one candidate', ago: '37s', dot: 'bg-orange-400' },
        { title: 'You are producing one candidate', ago: '40s', dot: 'bg-violet-500' },
        { title: 'Review comments and suppressions.', ago: '52s', dot: 'bg-lime-500' },
      ],
    },
    {
      title: 'Wire foldcn chrome',
      selected: false,
      ago: '46m',
      children: [],
    },
    {
      title: 'Kernel host replay',
      selected: false,
      ago: '2h',
      children: [],
    },
  ],
  inactive: ['pass, lint, fmt, commit and push', 'feat/oru-foldcn'],
  title: 'Foldon frontend with shadcn registry',
  children: '4 children',
  parent: 'None',
  environment: 'Remote',
  directory: '~/Development/personal/apps/oru',
  branch: 'feat/oru-foldcn',
  mergeMode: 'master',
  gitAhead: 'Ahead 5 ahead of master',
  gitOpen: 'Open',
  pr: '#6 Open',
  prChecks: 'Checks failing',
  model: 'Cursor Grok 4.6',
  effort: 'Medium',
  commits: [
    { message: 'feat(oru): paint a static bb-like chat stub', sha: 'f8c689c' },
    { message: 'feat(oru): switch foldcn chrome to light bb-like shell', sha: '21f6553' },
    { message: 'feat(oru): restyle the host UI with foldcn', sha: '1080777' },
  ],
  changes: [
    { mark: 'A', path: 'apps/oru/components.json', add: '+24', del: '' },
    { mark: 'A', path: 'apps/oru/index.html', add: '+3', del: '−2' },
    { mark: 'M', path: 'apps/oru/package.json', add: '+7', del: '−1' },
    { mark: 'A', path: 'apps/oru/src/chat-stub.ts', add: '+272', del: '' },
    { mark: 'A', path: 'apps/oru/src/components/ui/avatar.ts', add: '+104', del: '' },
  ],
  lines: [
    {
      role: 'assistant',
      body: 'What you see. A 16rem rail, thread canvas, and info pane. Tokens mix ink into canvas so seams stay quiet.',
    },
    {
      role: 'assistant',
      body: 'What stayed. TEA models, RPC, and Scene tests. TwoPaneSlots is still rail plus pane. Experience First picked light chrome over another dark pass.',
    },
    {
      role: 'assistant',
      body: 'Verification. Typecheck and 17 Scene tests passed. Live click on Greet keeps acked inside the rail.',
    },
    {
      role: 'user',
      body: 'no, like make the whole chat app with all components, just as a stub for now, no need to wire things up',
    },
    { role: 'banner', body: 'NEW' },
    { role: 'assistant', body: 'Worked for 6m 12s' },
    {
      role: 'assistant',
      body: 'The running app is now a full chat chrome stub. Nothing is wired to the host. Clicks do not send.',
    },
    { role: 'tool', name: 'read', detail: 'apps/oru/src/shell.ts' },
    { role: 'user', body: 'Make the host look like a basic bb chrome, light mode, foldcn only.' },
    {
      role: 'assistant',
      body: 'This view is the stub. Buttons do not send. The list is fixture data.',
    },
  ],
}

export const initRailSidebar = (): SidebarModel =>
  initSidebar({ id: 'oru-rail', cookieName: 'oru-rail' })

export const initInfoSidebar = (): SidebarModel =>
  initSidebar({ id: 'oru-info', cookieName: 'oru-info' })

const ghostIcon = <M>(h: HtmlBuilder<M>, node: Parameters<typeof icon>[1]): Html =>
  button(
    { variant: 'ghost', size: 'icon-xs', className: 'text-muted-foreground' },
    [icon(h, node, 'size-3.5')],
    h,
  )

const navRow = <M>(h: HtmlBuilder<M>, node: Parameters<typeof icon>[1], label: string): Html =>
  Sidebar.menuItem(
    {},
    [
      Sidebar.menuButton(
        { size: 'sm' },
        [icon(h, node, 'size-4 text-muted-foreground'), h.span([], [label])],
        h,
      ),
    ],
    h,
  )

const threadRow = <M>(thread: StubThread, h: HtmlBuilder<M>): Html =>
  Sidebar.menuItem(
    {},
    [
      Sidebar.menuButton(
        { isActive: thread.selected },
        [
          h.span([h.Class('size-1.5 shrink-0 rounded-full bg-emerald-500')], []),
          h.span([], [thread.title]),
        ],
        h,
      ),
      Sidebar.menuBadge({}, [thread.ago], h),
      ...(thread.branch === undefined
        ? []
        : [
            h.p(
              [h.Class('truncate px-8 text-[10px] leading-4 text-muted-foreground')],
              [thread.branch],
            ),
          ]),
      ...(thread.children.length === 0
        ? []
        : [
            Sidebar.menuSub(
              {},
              thread.children.map((child) =>
                Sidebar.menuSubItem(
                  {},
                  [
                    Sidebar.menuSubButton(
                      [],
                      { size: 'sm' },
                      [
                        h.span([h.Class(`size-1.5 shrink-0 rounded-full ${child.dot}`)], []),
                        h.span([], [child.title]),
                        h.span([h.Class('ml-auto text-[11px] text-muted-foreground')], [child.ago]),
                      ],
                      h,
                    ),
                  ],
                  h,
                ),
              ),
              h,
            ),
          ]),
    ],
    h,
  )

const railContent = <M>(slots: SidebarSlots, h: HtmlBuilder<M>): ReadonlyArray<Html> => [
  Sidebar.header(
    { className: 'flex flex-row items-center gap-1 p-2' },
    [
      Sidebar.menuButton(
        { className: 'flex-1' },
        [icon(h, Plus, 'size-4'), h.span([], ['New thread'])],
        h,
      ),
      Sidebar.trigger(slots.trigger, {}, h),
    ],
    h,
  ),
  Sidebar.content(
    {},
    [
      Sidebar.group(
        {},
        [
          Sidebar.groupContent(
            {},
            [
              Sidebar.menu(
                {},
                [
                  navRow(h, Puzzle, 'Extensions'),
                  navRow(h, Search, 'Search threads'),
                  navRow(h, Workflow, 'Automations'),
                  navRow(h, GitPullRequest, 'GitHub+'),
                  navRow(h, ChartNoAxesColumn, 'Usage'),
                ],
                h,
              ),
            ],
            h,
          ),
        ],
        h,
      ),
      Sidebar.group(
        {},
        [
          Sidebar.groupLabel({}, ['All projects'], h),
          Sidebar.groupAction([], {}, [icon(h, ChevronDown, 'size-4')], h),
          Sidebar.groupContent(
            {},
            [
              Sidebar.menu(
                {},
                [
                  Sidebar.menuItem({}, [Sidebar.groupLabel({}, ['Active'], h)], h),
                  ...stubChrome.threads.map((thread) => threadRow(thread, h)),
                  Sidebar.menuItem({}, [Sidebar.groupLabel({}, ['Inactive (1)'], h)], h),
                  ...stubChrome.inactive.map((label) =>
                    Sidebar.menuItem(
                      {},
                      [Sidebar.menuButton({ size: 'sm' }, [h.span([], [label])], h)],
                      h,
                    ),
                  ),
                ],
                h,
              ),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
    h,
  ),
  Sidebar.footer(
    { className: 'flex-row gap-0.5' },
    [ghostIcon(h, Settings), ghostIcon(h, CircleHelp), ghostIcon(h, Bell)],
    h,
  ),
  Sidebar.rail(slots.rail, {}, h),
]

const lineView = <M>(line: StubLine, h: HtmlBuilder<M>): Html => {
  if (line.role === 'user') {
    return h.div(
      [
        h.Class(
          'ml-auto max-w-[70%] rounded-2xl bg-[color-mix(in_oklch,oklch(0.78_0.09_350)_26%,var(--canvas))] px-3.5 py-2.5 text-sm leading-5',
        ),
      ],
      [line.body],
    )
  }
  if (line.role === 'tool') {
    return h.div(
      [h.Class('flex items-center gap-2 text-xs text-muted-foreground')],
      [
        h.span([h.Class('h-4 w-px bg-foreground/30')], []),
        badge({ variant: 'outline' }, [line.name], h),
        h.span([h.Class('font-mono')], [line.detail]),
      ],
    )
  }
  if (line.role === 'banner') {
    return h.div(
      [h.Class('flex items-center gap-3 py-1 text-[11px] tracking-wide text-muted-foreground')],
      [
        h.span([h.Class('h-px flex-1 bg-border-seam')], []),
        line.body,
        h.span([h.Class('h-px flex-1 bg-border-seam')], []),
      ],
    )
  }
  return h.p([h.Class('max-w-[85%] text-sm leading-5')], [line.body])
}

const prBar = <M>(h: HtmlBuilder<M>): Html =>
  Card(
    { size: 'sm', className: 'w-full ring-border-seam' },
    [
      Card.content(
        { className: 'flex flex-wrap items-center gap-2 py-0' },
        [
          badge({ variant: 'outline' }, ['PR #6'], h),
          h.span([h.Class('text-destructive')], [stubChrome.prChecks]),
          h.span([h.Class('text-muted-foreground')], ['Committed · 33 files, +2,441 −57']),
          h.span([h.Class('ml-auto text-muted-foreground')], ['Merge']),
        ],
        h,
      ),
    ],
    h,
  )

const composerChips = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground')],
    [
      badge({ variant: 'secondary', className: 'h-5 font-normal' }, [stubChrome.project], h),
      badge({ variant: 'secondary', className: 'h-5 font-normal' }, [stubChrome.machine], h),
      badge({ variant: 'secondary', className: 'h-5 font-normal' }, [stubChrome.branch], h),
      h.span([h.Class('ml-auto font-medium text-foreground/80')], ['Full Access']),
    ],
  )

const threadPane = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex min-h-0 min-w-0 flex-1 flex-col bg-background')],
    [
      h.div(
        [h.Class('flex h-10 shrink-0 items-center gap-2 border-b border-border-seam px-4')],
        [
          h.span([h.Class('min-w-0 flex-1 truncate text-sm font-medium')], [stubChrome.title]),
          h.span([h.Class('text-[12px] text-emerald-600')], [stubChrome.children]),
          ghostIcon(h, PanelRight),
        ],
      ),
      h.div(
        [h.Class('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4')],
        stubChrome.lines.map((line) => lineView(line, h)),
      ),
      h.div(
        [h.Class('shrink-0 px-6 pb-3')],
        [
          h.div([h.Class('mb-3')], [prBar(h)]),
          inputGroup(
            { className: 'h-auto flex-col rounded-2xl py-1.5' },
            [
              inputGroupTextarea(
                {
                  id: 'stub-draft',
                  rows: 2,
                  placeholder:
                    'Ask for a follow-up. @ to mention files, folders, sections, or threads',
                  className: 'min-h-10 px-3',
                },
                h,
              ),
              inputGroupAddon(
                { align: 'block-end', className: 'justify-between px-2' },
                [
                  h.div(
                    [h.Class('flex items-center gap-1')],
                    [
                      inputGroupButton({ size: 'icon-xs' }, icon(h, Plus, 'size-3.5'), h),
                      button(
                        {
                          variant: 'ghost',
                          size: 'sm',
                          className: 'h-7 gap-1 px-1.5 font-normal text-muted-foreground',
                        },
                        [stubChrome.model, icon(h, ChevronDown, 'size-3')],
                        h,
                      ),
                      button(
                        {
                          variant: 'ghost',
                          size: 'sm',
                          className: 'h-7 gap-1 px-1.5 font-normal text-muted-foreground',
                        },
                        [stubChrome.effort, icon(h, ChevronDown, 'size-3')],
                        h,
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class('flex items-center gap-1')],
                    [
                      ghostIcon(h, Mic),
                      button(
                        { size: 'icon-sm', className: 'rounded-full' },
                        [icon(h, ArrowUp, 'size-4')],
                        h,
                      ),
                    ],
                  ),
                ],
                h,
              ),
            ],
            h,
          ),
          composerChips(h),
        ],
      ),
    ],
  )

const kv = <M>(label: string, value: Html, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex min-h-7 items-start justify-between gap-3 py-0.5 text-xs')],
    [h.span([h.Class('shrink-0 text-muted-foreground')], [label]), value],
  )

const copyValue = <M>(text: string, h: HtmlBuilder<M>): Html =>
  h.span(
    [h.Class('flex min-w-0 items-center gap-1')],
    [
      h.span([h.Class('truncate font-mono')], [text]),
      icon(h, Copy, 'size-3 text-muted-foreground'),
    ],
  )

const infoContent = <M>(slots: SidebarSlots, h: HtmlBuilder<M>): ReadonlyArray<Html> => [
  Sidebar.header(
    { className: 'flex flex-row items-center justify-end gap-0.5' },
    [Sidebar.trigger(slots.trigger, {}, h), ghostIcon(h, Plus), ghostIcon(h, Ellipsis)],
    h,
  ),
  Sidebar.content(
    { className: 'gap-3 px-1' },
    [
      h.div(
        [h.Class('flex items-center justify-between px-2 text-xs')],
        [
          h.span(
            [h.Class('flex items-center gap-1 text-muted-foreground')],
            ['Parent', icon(h, ChevronDown, 'size-3')],
          ),
          h.span(
            [h.Class('flex items-center gap-1')],
            [stubChrome.parent, icon(h, ChevronDown, 'size-3')],
          ),
        ],
      ),
      Sidebar.group(
        {},
        [
          Sidebar.groupContent(
            {},
            [
              kv('Environment', h.span([h.Class('truncate')], [stubChrome.environment]), h),
              kv('Directory', copyValue(stubChrome.directory, h), h),
              kv('Branch', copyValue(stubChrome.branch, h), h),
              kv(
                'Merge mode',
                h.span(
                  [h.Class('flex items-center gap-1')],
                  [stubChrome.mergeMode, icon(h, ChevronDown, 'size-3 text-muted-foreground')],
                ),
                h,
              ),
              kv(
                'Git status',
                h.span(
                  [h.Class('flex min-w-0 flex-col items-end gap-0.5 text-right')],
                  [
                    h.span([h.Class('font-medium')], [stubChrome.gitAhead]),
                    h.span([h.Class('text-muted-foreground')], [stubChrome.gitOpen]),
                  ],
                ),
                h,
              ),
              kv(
                'Pull request',
                h.span(
                  [h.Class('flex min-w-0 flex-col items-end gap-0.5 text-right')],
                  [
                    h.span([], [stubChrome.pr]),
                    h.span([h.Class('text-destructive')], [stubChrome.prChecks]),
                  ],
                ),
                h,
              ),
            ],
            h,
          ),
        ],
        h,
      ),
      Sidebar.group(
        {},
        [
          Sidebar.groupLabel({}, ['Commits'], h),
          Sidebar.groupContent(
            {},
            stubChrome.commits.map((commit) =>
              h.div(
                [h.Class('flex items-start justify-between gap-2 px-2 py-0.5 text-[11px]')],
                [
                  h.span([h.Class('min-w-0 leading-4')], [commit.message]),
                  h.span([h.Class('shrink-0 font-mono text-muted-foreground')], [commit.sha]),
                ],
              ),
            ),
            h,
          ),
        ],
        h,
      ),
      Sidebar.group(
        {},
        [
          Sidebar.groupLabel({}, ['Committed · 33 files, +2,441 −57'], h),
          Sidebar.groupContent(
            {},
            [
              ...stubChrome.changes.map((change) =>
                h.div(
                  [h.Class('flex items-center gap-2 px-2 py-px font-mono text-[11px]')],
                  [
                    h.span([h.Class('w-3 text-muted-foreground')], [change.mark]),
                    h.span([h.Class('min-w-0 flex-1 truncate')], [change.path]),
                    h.span([h.Class('text-emerald-600')], [change.add]),
                    h.span([h.Class('text-destructive')], [change.del]),
                  ],
                ),
              ),
              h.p([h.Class('px-2 pt-1 text-[11px] text-muted-foreground')], ['Show 28 more']),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
    h,
  ),
  Sidebar.rail(slots.rail, {}, h),
]

export const chatStub = <M>(
  rail: SidebarModel,
  info: SidebarModel,
  toRail: (message: SidebarMessage) => M,
  toInfo: (message: SidebarMessage) => M,
  h: HtmlBuilder<M>,
): Html =>
  h.submodel({
    slotId: 'oru-rail',
    model: rail,
    view: sidebarView,
    viewInputs: {
      side: 'left',
      collapsible: 'icon',
      content: (slots) => railContent(slots, h),
      children: () => [
        SidebarInset({ className: 'min-h-0 min-w-0 w-auto' }, [threadPane(h)], h),
        h.submodel({
          slotId: 'oru-info',
          model: info,
          view: sidebarView,
          viewInputs: {
            side: 'right',
            collapsible: 'icon',
            className: 'contents',
            content: (slots) => infoContent(slots, h),
            children: () => [],
          },
          toParentMessage: toInfo,
        }),
      ],
    },
    toParentMessage: toRail,
  })
