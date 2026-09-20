import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Effect, Predicate, type Scope } from 'effect'
import { definePlugin, type AnyPlugin } from '@oru/kernel'
import { ProjectClient, clientsFor } from '@oru/rpc'
import { WorkspaceKind, defineWorkspaceProvider, type WorkspaceInfo } from '@oru/workspace'
import { corePlugins, serveHost } from '../src/index.ts'

const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-workspace-')), 'session.db')

const gitRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'oru-workspace-repo-'))
  execFileSync('git', ['init', '-b', 'master'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@oru.dev'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'oru test'], { cwd: dir })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

const withHost = <A, E>(
  file: string,
  effect: Effect.Effect<A, E, ProjectClient | Scope.Scope>,
  extraPlugins: readonly AnyPlugin[] = [],
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* serveHost({
        plugins: [...corePlugins, ...extraPlugins],
        hostname: '127.0.0.1',
        port: 0,
        journal: file,
      })
      return yield* effect.pipe(Effect.provide(clientsFor(running.url)))
    }),
  )

/** A replacement strategy: no git, just a marker row per checkout. */
const fakeProviderPlugin = definePlugin({
  id: 'test/fake-workspace',
  apply: (ctx) =>
    ctx.contribute(
      WorkspaceKind.of(
        defineWorkspaceProvider({
          meta: { id: 'fake', label: 'Fake' },
          list: (_project, cwd) =>
            Effect.succeed<readonly WorkspaceInfo[]>([
              { path: cwd, isCurrent: true, provider: 'fake' },
            ]),
          provision: (project, cwd, path) =>
            Effect.succeed({ path, isCurrent: false, provider: 'fake' }),
          remove: (_project, _cwd, path) => Effect.succeed(path),
        }),
      ),
    ),
})

describe('project workspaces without a model', () => {
  it('lists the checkout, adds a workspace, and removes it', async () => {
    const file = sessionFile()
    const repo = gitRepo()
    const added = join(repo, '..', `oru-ws-${Date.now()}`)

    const seen = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('repo', repo)
          const before = yield* projects.workspaces(project.id)
          const created = yield* projects.createWorkspace(project.id, added)
          const during = yield* projects.workspaces(project.id)
          yield* projects.removeWorkspace(project.id, added)
          const after = yield* projects.workspaces(project.id)
          return { before, created, during, after }
        }),
      ),
    )

    expect(seen.before).toHaveLength(1)
    expect(seen.before[0]?.isCurrent).toBe(true)
    expect(seen.before[0]?.provider).toBe('worktree')
    const canonicalAdded = join(realpathSync(dirname(added)), basename(added))
    expect(seen.created.path).toBe(canonicalAdded)
    expect(seen.created.provider).toBe('worktree')
    expect(seen.during.map((entry) => entry.path).sort()).toEqual(
      [realpathSync(repo), canonicalAdded].sort(),
    )
    expect(seen.after.map((entry) => entry.path)).toEqual([realpathSync(repo)])
  })

  it('refuses a relative workspace path', async () => {
    const file = sessionFile()
    const repo = gitRepo()

    const failure = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('repo', repo)
          return yield* projects.createWorkspace(project.id, 'relative/path').pipe(Effect.flip)
        }),
      ),
    )

    expect(Predicate.isTagged(failure, 'RelativeCwd')).toBe(true)
  })

  it('skips the git strategy when listing a directory that is not a checkout', async () => {
    const file = sessionFile()
    const plain = mkdtempSync(join(tmpdir(), 'oru-workspace-plain-'))

    const seen = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('plain', plain)
          const listed = yield* projects.workspaces(project.id)
          const failure = yield* projects
            .createWorkspace(project.id, join(plain, 'ws'))
            .pipe(Effect.flip)
          return { listed, failure }
        }),
      ),
    )

    // Listing is best effort across strategies; creating names the default
    // provider and keeps its typed failure.
    expect(seen.listed).toEqual([])
    expect(Predicate.isTagged(seen.failure, 'WorkspaceFailed')).toBe(true)
    if (Predicate.isTagged(seen.failure, 'WorkspaceFailed')) {
      expect(seen.failure.provider).toBe('worktree')
    }
  })

  it('answers an unknown provider name with a typed failure', async () => {
    const file = sessionFile()
    const repo = gitRepo()

    const failure = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('repo', repo)
          return yield* projects
            .createWorkspace(project.id, join(repo, 'ws'), { provider: 'nope' })
            .pipe(Effect.flip)
        }),
      ),
    )

    expect(Predicate.isTagged(failure, 'UnknownProvider')).toBe(true)
  })

  it('provisions through a contributed replacement instead of git', async () => {
    const file = sessionFile()
    const plain = mkdtempSync(join(tmpdir(), 'oru-workspace-plain-'))

    const seen = await Effect.runPromise(
      withHost(
        file,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const project = yield* projects.create('plain', plain)
          const listed = yield* projects.workspaces(project.id)
          const created = yield* projects.createWorkspace(project.id, join(plain, 'ws'), {
            provider: 'fake',
          })
          return { listed, created }
        }),
        [fakeProviderPlugin],
      ),
    )

    // The fake owns rows the git provider never reported: replacement works
    // through contribution, with no change to the host.
    expect(seen.listed.some((entry) => entry.provider === 'fake')).toBe(true)
    expect(seen.created).toEqual({
      path: join(plain, 'ws'),
      isCurrent: false,
      provider: 'fake',
    })
  })
})
