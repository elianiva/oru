/**
 * The thread list's data seam.
 * One module owns the thread vocabulary and the dataset the left column draws.
 */
import { Option } from 'effect'

export type ThreadStatus =
  | 'failed'
  | 'needs-you'
  | 'unread'
  | 'working'
  | 'workflow'
  | 'agent'
  | 'command'
  | 'planning'
  | 'goal'
  | 'draft'
  | 'idle'

export type ThreadLocation = Readonly<{
  kind: 'branch' | 'worktree' | 'machine'
  name: string
}>

/** `None` is a value the row renders as the name's first letter, rather than a
 *  gap the row invents a placeholder for. */
export type ThreadProject = Readonly<{
  id: string
  name: string
  iconUrl: Option.Option<string>
}>

export type ThreadRow = Readonly<{
  id: string
  title: string
  project: ThreadProject
  location: ThreadLocation
  status: ThreadStatus
  isUnread: boolean
  /** Background workflows, agents and commands still running for this thread. */
  activity: number
  pullRequest?: number
  updatedAt: number
  children: ReadonlyArray<ThreadRow>
}>

export type ThreadSection = Readonly<{
  id: string
  label: string
  rows: ReadonlyArray<ThreadRow>
}>

const walk = (rows: ReadonlyArray<ThreadRow>, id: string): ThreadRow | undefined => {
  for (const row of rows) {
    if (row.id === id) return row
    const child = walk(row.children, id)
    if (child !== undefined) return child
  }
  return undefined
}

export const threadById = (
  sections: ReadonlyArray<ThreadSection>,
  id: string,
): ThreadRow | undefined => {
  for (const section of sections) {
    const found = walk(section.rows, id)
    if (found !== undefined) return found
  }
  return undefined
}

const loadedAt = Date.now()
const minutesAgo = (minutes: number): number => loadedAt - minutes * 60_000
const hoursAgo = (hours: number): number => loadedAt - hours * 3_600_000
const daysAgo = (days: number): number => loadedAt - days * 86_400_000

const oru = { id: 'oru', name: 'oru', iconUrl: Option.none<string>() }
const sidebar = { id: 'bb-sidebar', name: 'bb-sidebar', iconUrl: Option.none<string>() }

export const fakeThreadSections: ReadonlyArray<ThreadSection> = [
  {
    id: 'pinned',
    label: 'Pinned',
    rows: [
      {
        id: 'pinned-shell',
        title: 'Panel shell: three columns, two splitters',
        project: oru,
        location: { kind: 'worktree', name: 'feat/panel-shell' },
        status: 'needs-you',
        isUnread: true,
        activity: 0,
        pullRequest: 214,
        updatedAt: minutesAgo(3),
        children: [],
      },
    ],
  },
  {
    id: 'active',
    label: 'Active',
    rows: [
      {
        id: 'shell-retro',
        title: 'Fold the resizable engine into the app shell',
        project: oru,
        location: { kind: 'worktree', name: 'feat/panel-shell' },
        status: 'working',
        isUnread: true,
        activity: 2,
        pullRequest: 214,
        updatedAt: minutesAgo(12),
        children: [
          {
            id: 'shell-retro-audit',
            title: 'Audit collapse semantics',
            project: oru,
            location: { kind: 'worktree', name: 'feat/panel-shell' },
            status: 'working',
            isUnread: false,
            activity: 0,
            updatedAt: minutesAgo(9),
            children: [],
          },
          {
            id: 'shell-retro-tests',
            title: 'Pin the toggle round-trip',
            project: oru,
            location: { kind: 'worktree', name: 'feat/panel-shell' },
            status: 'needs-you',
            isUnread: true,
            activity: 0,
            updatedAt: minutesAgo(6),
            children: [
              {
                id: 'shell-retro-tests-reload',
                title: 'Reload with both sidebars shut',
                project: oru,
                location: { kind: 'worktree', name: 'feat/panel-shell' },
                status: 'agent',
                isUnread: false,
                activity: 1,
                updatedAt: minutesAgo(4),
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: 'kernel-session-fold',
        title: 'Projection order for the session fold',
        project: oru,
        location: { kind: 'branch', name: 'main' },
        status: 'idle',
        isUnread: false,
        activity: 0,
        updatedAt: hoursAgo(5),
        children: [],
      },
      {
        id: 'sidebar-rows',
        title: 'Status slot: word or age, never both',
        project: sidebar,
        location: { kind: 'machine', name: 'macbook' },
        status: 'unread',
        isUnread: true,
        activity: 0,
        updatedAt: hoursAgo(1),
        children: [],
      },
    ],
  },
  {
    id: 'inactive',
    label: 'Inactive',
    rows: [
      {
        id: 'host-transport',
        title: 'Host transport spike over effect/unstable/rpc',
        project: oru,
        location: { kind: 'worktree', name: 'spike/rpc-transport' },
        status: 'idle',
        isUnread: false,
        activity: 0,
        updatedAt: daysAgo(2),
        children: [],
      },
      {
        id: 'sidebar-settings',
        title: 'Sidebar settings surface',
        project: sidebar,
        location: { kind: 'branch', name: 'main' },
        status: 'draft',
        isUnread: false,
        activity: 0,
        updatedAt: daysAgo(6),
        children: [],
      },
    ],
  },
]
