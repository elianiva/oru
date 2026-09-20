import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Predicate, Effect, type Scope } from 'effect'
import {
  SessionLog,
  foldThreadCwd,
  sessionLogLayer,
  type SessionLogContract,
  type SessionLogError,
} from '@oru/kernel'
import { sqliteJournalLayer } from '@oru/kernel/sqlite'
import { ProjectClient, ThreadClient, clientsFor } from '@oru/rpc'
import { corePlugins, serveHost } from '../src/index.ts'

const sessionFile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'oru-thread-lifecycle-')), 'session.db')

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

describe('thread lifecycle without a model', () => {
  it('stores the cwd a creation carried and reads it back', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-lifecycle-cwd-'))
    const override = join(cwd, 'worktrees', 'one')

    const threadId = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id, { cwd: override })
          return created.threadId
        }),
      ),
    )

    const resolved = await readJournal(file, (log) =>
      log.entries.pipe(Effect.map((events) => foldThreadCwd(events, threadId))),
    )
    expect(resolved).toBe(override)
  })

  it('forks with a summary of the source and the cwd it was given', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-lifecycle-fork-'))
    const override = join(cwd, 'worktrees', 'two')

    const forked = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id)
          yield* threads.send(created.threadId, 'build the provisioning surface')
          yield* threads.wait(created.threadId)
          return yield* threads.fork(created.threadId, override)
        }),
      ),
    )

    const branch = await readJournal(file, (log) =>
      log.entries.pipe(
        Effect.map((events) =>
          events.find(
            (event) =>
              Predicate.isTagged(event, 'thread/branched') && event.thread === forked.threadId,
          ),
        ),
      ),
    )
    if (branch === undefined || !Predicate.isTagged(branch, 'thread/branched')) {
      expect.fail('the journal has no thread/branched for the fork')
    }
    expect(branch.summary).toContain('build the provisioning surface')
    expect(branch.cwd).toBe(override)

    const resolved = await readJournal(file, (log) =>
      log.entries.pipe(Effect.map((events) => foldThreadCwd(events, forked.threadId))),
    )
    expect(resolved).toBe(override)
  })

  it('lists threads with titles drawn from their first user message', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-lifecycle-list-'))

    const listed = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const first = yield* threads.create(project.id)
          yield* threads.send(first.threadId, 'first thread topic')
          yield* threads.wait(first.threadId)
          const second = yield* threads.create(project.id)
          yield* threads.send(second.threadId, 'second thread topic')
          yield* threads.wait(second.threadId)
          return yield* threads.list(project.id)
        }),
      ),
    )

    expect(listed.map((entry) => entry.title).sort()).toEqual([
      'first thread topic',
      'second thread topic',
    ])
  })

  it('answers compact with a typed failure when no harness can compact', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-lifecycle-compact-'))

    const failure = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id)
          return yield* threads.compact(created.threadId).pipe(Effect.flip)
        }),
      ),
    )

    expect(Predicate.isTagged(failure, 'CompactFailed')).toBe(true)
    if (Predicate.isTagged(failure, 'CompactFailed')) {
      expect(failure.reason).toContain('cannot compact')
    }
  })

  it('waits for the idle the send leaves behind', async () => {
    const file = sessionFile()
    const cwd = mkdtempSync(join(tmpdir(), 'oru-lifecycle-wait-'))

    await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('demo', cwd)
          const created = yield* threads.create(project.id)
          yield* threads.send(created.threadId, 'settle this turn')
          yield* threads.wait(created.threadId)
        }),
      ),
    )

    const failed = await readJournal(file, (log) =>
      log.entries.pipe(
        Effect.map((events) => events.some((event) => Predicate.isTagged(event, 'turn/failed'))),
      ),
    )
    expect(failed).toBe(true)
  })
})
