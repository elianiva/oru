import type { Html, HtmlBuilder } from 'foldkit/html'
import { Avatar } from '@/components/ui/avatar.ts'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { inputGroup, inputGroupAddon, inputGroupTextarea } from '@/components/ui/input-group.ts'
import { Item } from '@/components/ui/item.ts'
import { Kbd } from '@/components/ui/kbd.ts'
import { separator } from '@/components/ui/separator.ts'
import { skeleton } from '@/components/ui/skeleton.ts'

export type StubThread = Readonly<{ title: string; selected: boolean }>

export type StubLine =
  | Readonly<{ role: 'user'; body: string }>
  | Readonly<{ role: 'assistant'; body: string }>
  | Readonly<{ role: 'tool'; name: string; detail: string }>

export type StubChrome = Readonly<{
  project: string
  threads: ReadonlyArray<StubThread>
  title: string
  status: string
  branch: string
  directory: string
  environment: string
  model: string
  files: ReadonlyArray<string>
  note: string
  lines: ReadonlyArray<StubLine>
}>

export const stubChrome: StubChrome = {
  project: 'oru',
  threads: [
    { title: 'Wire foldcn chrome', selected: true },
    { title: 'Kernel host replay', selected: false },
    { title: 'Inference session fold', selected: false },
  ],
  title: 'Wire foldcn chrome',
  status: 'Idle',
  branch: 'feat/oru-foldcn',
  directory: '~/Development/personal/apps/oru',
  environment: 'Local',
  model: 'claude-fable-5',
  files: ['apps/oru/src/shell.ts', 'apps/oru/src/index.css'],
  note: 'Sidebar reads canvas ink. Selection stays a quiet wash.',
  lines: [
    { role: 'user', body: 'Make the host look like a basic bb chrome, light mode, foldcn only.' },
    {
      role: 'assistant',
      body: 'Laid out a 16rem rail, thread canvas, and info pane. Tokens mix ink into canvas so seams stay quiet.',
    },
    { role: 'tool', name: 'read', detail: 'apps/oru/src/shell.ts' },
    { role: 'user', body: 'Now stub the whole chat app. No wiring yet.' },
    {
      role: 'assistant',
      body: 'This view is the stub. Buttons do not send. The list is fixture data.',
    },
  ],
}

const rowClass = (selected: boolean): string =>
  selected
    ? 'w-full justify-start font-normal bg-sidebar-accent text-sidebar-accent-foreground'
    : 'w-full justify-start font-normal text-sidebar-foreground/85'

const sidebar = <M>(h: HtmlBuilder<M>): Html =>
  h.aside(
    [
      h.Class(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border-seam bg-sidebar text-sidebar-foreground',
      ),
    ],
    [
      h.div(
        [h.Class('flex h-8 shrink-0 items-center px-4 text-sm font-semibold')],
        [stubChrome.project],
      ),
      h.div(
        [h.Class('flex min-h-0 flex-1 flex-col gap-0.5 px-2 py-1')],
        [
          button(
            { variant: 'ghost', size: 'sm', className: 'w-full justify-start font-normal' },
            ['New thread'],
            h,
          ),
          h.p(
            [h.Class('px-2 pt-3 text-xs font-normal leading-5 text-subtle-foreground/75')],
            ['Today'],
          ),
          ...stubChrome.threads.map((thread) =>
            button(
              { variant: 'ghost', size: 'sm', className: rowClass(thread.selected) },
              [thread.title],
              h,
            ),
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-2 border-t border-border-seam px-3 py-2')],
        [
          Avatar({ size: 'sm' }, [Avatar.fallback({}, ['you'], h)], h),
          h.span([h.Class('truncate text-xs text-muted-foreground')], ['local']),
        ],
      ),
    ],
  )

const lineView = <M>(line: StubLine, h: HtmlBuilder<M>): Html => {
  if (line.role === 'user') {
    return h.div(
      [
        h.Class(
          'ml-auto max-w-[70%] rounded-2xl bg-muted/60 px-3.5 py-2.5 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--border-seam)]',
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
  return h.p([h.Class('max-w-[85%] text-sm leading-5')], [line.body])
}

const threadPane = <M>(h: HtmlBuilder<M>): Html =>
  h.main(
    [h.Class('flex min-h-0 min-w-0 flex-1 flex-col bg-background')],
    [
      h.div(
        [h.Class('flex h-12 shrink-0 items-center gap-2 border-b border-border-seam px-6')],
        [
          h.span([h.Class('min-w-0 flex-1 truncate text-sm font-semibold')], [stubChrome.title]),
          badge({ variant: 'secondary' }, [stubChrome.status], h),
          badge({ variant: 'outline' }, [stubChrome.branch], h),
        ],
      ),
      h.div(
        [h.Class('flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-6 py-4')],
        stubChrome.lines.map((line) => lineView(line, h)),
      ),
      h.div(
        [h.Class('shrink-0 px-6 pb-4')],
        [
          inputGroup(
            { className: 'h-auto flex-col rounded-2xl py-2' },
            [
              inputGroupTextarea(
                {
                  id: 'stub-draft',
                  rows: 2,
                  placeholder: 'Ask for a follow-up.',
                  className: 'min-h-12 px-3',
                },
                h,
              ),
              inputGroupAddon(
                { align: 'block-end', className: 'justify-between px-3' },
                [
                  h.span([h.Class('text-xs text-muted-foreground')], [stubChrome.model]),
                  h.div(
                    [h.Class('flex items-center gap-2')],
                    [
                      Kbd.group({}, [Kbd({}, ['⌘'], h), Kbd({}, ['Enter'], h)], h),
                      button({ variant: 'outline', size: 'sm' }, ['Send'], h),
                    ],
                  ),
                ],
                h,
              ),
            ],
            h,
          ),
        ],
      ),
    ],
  )

const kv = <M>(label: string, value: Html, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex h-7 items-center justify-between gap-3 text-xs')],
    [h.span([h.Class('text-muted-foreground')], [label]), value],
  )

const infoPane = <M>(h: HtmlBuilder<M>): Html =>
  h.aside(
    [
      h.Class(
        'flex min-h-0 w-[18rem] shrink-0 flex-col overflow-hidden border-l border-border-seam bg-sidebar text-sidebar-foreground',
      ),
    ],
    [
      h.div(
        [h.Class('flex h-12 items-center gap-3 px-4 text-xs')],
        [
          h.span([h.Class('font-semibold')], ['Info']),
          h.span([h.Class('text-muted-foreground')], ['Diff']),
        ],
      ),
      h.div(
        [h.Class('flex flex-col gap-4 px-4 py-3')],
        [
          h.div(
            [],
            [
              kv(
                'Environment',
                h.span([h.Class('truncate font-mono')], [stubChrome.environment]),
                h,
              ),
              kv('Directory', h.span([h.Class('truncate font-mono')], [stubChrome.directory]), h),
              kv('Branch', h.span([h.Class('truncate font-mono')], [stubChrome.branch]), h),
              kv('Status', badge({ variant: 'secondary' }, [stubChrome.status], h), h),
            ],
          ),
          separator({}, h),
          h.div(
            [],
            [
              h.p([h.Class('mb-1 text-xs text-subtle-foreground/75')], ['Files']),
              ...stubChrome.files.map((file) =>
                h.p([h.Class('truncate font-mono text-xs')], [file]),
              ),
            ],
          ),
          h.div(
            [
              h.Class(
                'rounded-lg bg-muted/50 px-3 py-2 text-xs leading-4 text-muted-foreground shadow-[inset_0_0_0_1px_var(--border-seam)]',
              ),
            ],
            [stubChrome.note],
          ),
          Item.group(
            {},
            [
              Item(
                { variant: 'muted', size: 'xs' },
                [
                  Item.content(
                    {},
                    [
                      Item.title({}, ['Context'], h),
                      Item.description({}, ['Fixture chrome. Not connected to the host.'], h),
                    ],
                    h,
                  ),
                ],
                h,
              ),
            ],
            h,
          ),
          skeleton({ className: 'h-8 w-full' }, [], h),
        ],
      ),
    ],
  )

export const chatStub = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('grid min-h-svh grid-cols-[16rem_minmax(0,1fr)_18rem] bg-background text-foreground')],
    [sidebar(h), threadPane(h), infoPane(h)],
  )
