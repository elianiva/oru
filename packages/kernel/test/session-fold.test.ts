import { describe, expect, it } from 'vitest'
import {
  MessageAppended,
  ProjectCreated,
  ProjectDeleted,
  ProjectUpdated,
  SessionActivated,
  ThreadCreated,
  ThreadContextWindow,
  TurnUsage,
  chain,
  ensurePersonalProject,
  foldThreadContextWindow,
  foldThreadUsage,
  isPersonalProjectId,
  leafOf,
  pathFromLeaf,
  personalProject,
  relink,
  threadLane,
  unsignedTree,
} from '../src/index.ts'
import { foldNamedThreads, foldProject, foldProjects, foldThreadCwd } from '../src/session-fold.ts'

describe('foldNamedThreads', () => {
  it('names a thread from thread/created without any messages', () => {
    const created = ThreadCreated.make({
      ...unsignedTree,
      id: 'e1',
      thread: 't1',
      project: 'p1',
    })
    expect([...foldNamedThreads([created])]).toEqual(['t1'])
  })

  it('names a thread from later work facts and ignores plugin facts', () => {
    const events = [
      SessionActivated.make({
        ...unsignedTree,
        id: 'e1',
        plugin: 'logging',
        scope: 'host',
      }),
      MessageAppended.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't2',
        role: 'user',
        body: 'hi',
      }),
    ]
    expect([...foldNamedThreads(events)]).toEqual(['t2'])
  })
})

describe('session tree', () => {
  it('walks parentId to the leaf and ignores an abandoned sibling', () => {
    const root = ThreadCreated.make({
      ...unsignedTree,
      id: 'e0',
      thread: 't1',
      project: 'p1',
    })
    const user = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'a',
      }),
      1,
      root.id,
    )
    const abandoned = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        role: 'assistant',
        body: 'old',
      }),
      2,
      user.id,
    )
    const kept = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        role: 'assistant',
        body: 'new',
      }),
      3,
      user.id,
    )
    const events = [root, user, abandoned, kept]
    expect(leafOf(events, threadLane('t1'))).toBe('e3')
    expect(pathFromLeaf(events, 'e3').map((event) => event.id)).toEqual(['e0', 'e1', 'e3'])
    expect(abandoned.id).toBe('e2')
  })
})

describe('foldProjects', () => {
  it('reads name and cwd from project/created', () => {
    const created = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    expect(foldProjects([created])).toEqual([{ id: 'p1', name: 'oru', cwd: '/tmp/oru' }])
    expect(foldProject([created], 'p1')).toEqual({ id: 'p1', name: 'oru', cwd: '/tmp/oru' })
  })

  it('carries the icon from project/created through an update', () => {
    const created = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: '/icons/oru.svg',
    })
    expect(foldProject([created], 'p1')?.icon).toBe('/icons/oru.svg')
    const relabeled = ProjectUpdated.make({
      ...unsignedTree,
      id: 'e2',
      project: 'p1',
      name: 'oru-app',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    expect(foldProject([created, relabeled], 'p1')).toEqual({
      id: 'p1',
      name: 'oru-app',
      cwd: '/tmp/oru',
    })
  })

  it('drops a project project/deleted names', () => {
    const created = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    const deleted = ProjectDeleted.make({ ...unsignedTree, id: 'e2', project: 'p1' })
    expect(foldProjects([created, deleted])).toEqual([])
    expect(foldProject([created, deleted], 'p1')).toBeUndefined()
  })

  it('lets the latest project/updated carry the whole project', () => {
    const created = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    const renamed = ProjectUpdated.make({
      ...unsignedTree,
      id: 'e2',
      project: 'p1',
      name: 'oru-app',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    const moved = ProjectUpdated.make({
      ...unsignedTree,
      id: 'e3',
      project: 'p1',
      name: 'oru-app',
      cwd: '/tmp/elsewhere',
      icon: undefined,
    })
    expect(foldProjects([created, renamed, moved])).toEqual([
      { id: 'p1', name: 'oru-app', cwd: '/tmp/elsewhere' },
    ])
    expect(foldProject([created, renamed, moved], 'p1')).toEqual({
      id: 'p1',
      name: 'oru-app',
      cwd: '/tmp/elsewhere',
    })
  })

  it('drops an update to a project the log never created', () => {
    const stranded = ProjectUpdated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p-ghost',
      name: 'ghost',
      cwd: '/tmp/ghost',
      icon: undefined,
    })
    expect(foldProjects([stranded])).toEqual([])
    expect(foldProject([stranded], 'p-ghost')).toBeUndefined()
  })
})

describe('personal project', () => {
  it('builds the singleton from a cwd', () => {
    expect(personalProject('/tmp/personal')).toEqual({
      id: 'personal',
      name: 'Personal',
      cwd: '/tmp/personal',
    })
    expect(isPersonalProjectId('personal')).toBe(true)
    expect(isPersonalProjectId('p1')).toBe(false)
  })

  it('proposes the fact once, and again after a deletion', () => {
    const created = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'personal',
      name: 'Personal',
      cwd: '/tmp/personal',
      icon: undefined,
    })
    expect(ensurePersonalProject([], '/tmp/personal')).toEqual({
      id: 'personal',
      name: 'Personal',
      cwd: '/tmp/personal',
    })
    expect(ensurePersonalProject([created], '/tmp/personal')).toBeUndefined()
    const deleted = ProjectDeleted.make({ ...unsignedTree, id: 'e2', project: 'personal' })
    expect(ensurePersonalProject([created, deleted], '/tmp/personal')).toEqual({
      id: 'personal',
      name: 'Personal',
      cwd: '/tmp/personal',
    })
  })
})

describe('foldThreadCwd', () => {
  it("returns the absolute cwd of the thread's project", () => {
    const project = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    const thread = ThreadCreated.make({
      ...unsignedTree,
      id: 'e2',
      thread: 't1',
      project: 'p1',
    })
    expect(foldThreadCwd([project, thread], 't1')).toBe('/tmp/oru')
  })

  it('follows a cwd edit made after the thread was created', () => {
    const project = ProjectCreated.make({
      ...unsignedTree,
      id: 'e1',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/oru',
      icon: undefined,
    })
    const thread = ThreadCreated.make({
      ...unsignedTree,
      id: 'e2',
      thread: 't1',
      project: 'p1',
    })
    const moved = ProjectUpdated.make({
      ...unsignedTree,
      id: 'e3',
      project: 'p1',
      name: 'oru',
      cwd: '/tmp/moved',
      icon: undefined,
    })
    expect(foldThreadCwd([project, thread, moved], 't1')).toBe('/tmp/moved')
  })
})

describe('foldThreadUsage', () => {
  it('sums turn usage on the lane and keeps the latest context window', () => {
    const events = chain([
      ThreadCreated.make({
        ...unsignedTree,
        id: 'e0',
        thread: 't1',
        project: 'p1',
      }),
      TurnUsage.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        turn: 'turn-1',
        inputTokens: 10,
        outputTokens: 4,
        cost: 0.02,
      }),
      ThreadContextWindow.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        tokens: 80,
        contextWindow: 200,
      }),
      TurnUsage.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn-2',
        inputTokens: 2,
        outputTokens: 1,
        cost: undefined,
      }),
      ThreadContextWindow.make({
        ...unsignedTree,
        id: 'e4',
        thread: 't1',
        tokens: 90,
        contextWindow: 200,
      }),
    ])
    expect(foldThreadUsage(events, 't1')).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cost: 0.02,
    })
    expect(foldThreadContextWindow(events, 't1')).toEqual({ tokens: 90, contextWindow: 200 })
    expect(foldThreadUsage(events, 't2')).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cost: undefined,
    })
  })
})
