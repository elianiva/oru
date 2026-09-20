/**
 * The thread list's data seam.
 * One module owns the thread vocabulary the left column draws.
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
  kind: 'branch' | 'workspace' | 'machine'
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

/** The thread list starts empty: rows arrive from the host's thread
 *  integration, never from a placeholder dataset. */
export const emptyThreadSections: ReadonlyArray<ThreadSection> = []
