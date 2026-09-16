import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Predicate, Effect, type Scope } from 'effect'
import {
  foldThreadCwd,
  RelativeCwd,
  SessionLog,
  UnknownProject,
  sessionLogLayer,
  type SessionLogContract,
  type SessionLogError,
} from '@oru/kernel'
import { sqliteJournalLayer } from '@oru/kernel/sqlite'
import { ProjectClient, ThreadClient, clientsFor } from '@oru/rpc'
import { corePlugins, serveHost } from '../src/index.ts'

const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-project-')), 'session.db')

const withHost = <A, E>(
  file: string,
  effect: Effect.Effect<A, E, ProjectClient | ThreadClient | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins: corePlugins,
        hostname: '127.0.0.1',
        port: 0,
        journal: file,
      })
      return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
    }),
  )

const readJournal = <A>(
  file: string,
  read: (log: SessionLogContract) => Effect.Effect<A, SessionLogError>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const log = yield* SessionLog
        return yield* read(log)
      }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
    ),
  )

describe('project cwd on a thread', () => {
  it("writes the project's absolute cwd into the journal a thread created against it folds", async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-project-cwd-'))
    expect(isAbsolute(cwd)).toBe(true)

    const threadId = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id)
          return created.threadId
        }),
      ),
    )

    const entries = await readJournal(file, (log) => log.entries)
    expect(foldThreadCwd(entries, threadId)).toBe(cwd)
    expect(
      entries.some((event) => Predicate.isTagged(event, 'project/created') && event.cwd === '.'),
    ).toBe(false)
    const created = entries.find(
      (event) => Predicate.isTagged(event, 'thread/created') && event.thread === threadId,
    )
    expect(created?._tag).toBe('thread/created')
    const project = entries.find((event) => Predicate.isTagged(event, 'project/created'))
    expect(project?._tag).toBe('project/created')
    if (
      Predicate.isTagged(created, 'thread/created') &&
      Predicate.isTagged(project, 'project/created')
    ) {
      expect(created.project).toBe(project.project)
      expect(project.cwd).toBe(cwd)
    }
  })

  it('moves a thread already created against the project to the edited cwd it folds', async () => {
    const file = sessionFile()
    const before = mkdtempSync(join(tmpdir(), 'oru-project-before-'))
    const after = mkdtempSync(join(tmpdir(), 'oru-project-after-'))

    const threadId = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', before)
          const created = yield* threads.create(project.id)
          yield* projects.update(project.id, { name: 'demo', cwd: after })
          return created.threadId
        }),
      ),
    )

    const entries = await readJournal(file, (log) => log.entries)
    expect(foldThreadCwd(entries, threadId)).toBe(after)
  })
})

describe('UpdateProject', () => {
  it('records the new name and cwd and answers with the project', async () => {
    const file = sessionFile()
    const first = mkdtempSync(join(tmpdir(), 'oru-project-first-'))
    const second = mkdtempSync(join(tmpdir(), 'oru-project-second-'))

    const seen = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('demo', first)
          const updated = yield* projects.update(project.id, { name: 'renamed', cwd: second })
          return {
            project,
            updated,
            listed: yield* projects.list(),
            fetched: yield* projects.get(project.id),
          }
        }),
      ),
    )

    expect(seen.updated).toEqual({ id: seen.project.id, name: 'renamed', cwd: second })
    expect(seen.listed).toEqual([seen.updated])
    expect(seen.fetched).toEqual(seen.updated)

    const entries = await readJournal(file, (log) => log.entries)
    const facts = entries.filter((event) => Predicate.isTagged(event, 'project/updated'))
    expect(facts).toHaveLength(1)
    const fact = facts[0]
    if (!Predicate.isTagged(fact, 'project/updated')) expect.fail('no project/updated fact')
    expect(fact.project).toBe(seen.project.id)
    expect(fact.name).toBe('renamed')
    expect(fact.cwd).toBe(second)
  })

  it("refuses a relative cwd with the host's own error, writing nothing", async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-project-relative-'))

    const refused = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('demo', cwd)
          return yield* Effect.flip(projects.update(project.id, { name: 'demo', cwd: './here' }))
        }),
      ),
    )

    expect(refused).toEqual(new RelativeCwd({ cwd: './here' }))

    const entries = await readJournal(file, (log) => log.entries)
    expect(entries.some((event) => Predicate.isTagged(event, 'project/updated'))).toBe(false)
  })

  it("refuses an unknown project with the host's own error, writing nothing", async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-project-unknown-'))

    const refused = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          return yield* Effect.flip(projects.update('p-ghost', { name: 'ghost', cwd }))
        }),
      ),
    )

    expect(refused).toEqual(new UnknownProject({ project: 'p-ghost' }))

    const entries = await readJournal(file, (log) => log.entries)
    expect(entries.some((event) => Predicate.isTagged(event, 'project/updated'))).toBe(false)
  })
})
