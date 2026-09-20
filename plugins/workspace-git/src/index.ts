import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Effect } from 'effect'
import { definePlugin } from '@oru/kernel'
import type { ProjectId } from '@oru/kernel'
import {
  WorkspaceFailed,
  WorkspaceKind,
  defineWorkspaceProvider,
  type WorkspaceInfo,
  type WorkspaceProvisionOptions,
} from '@oru/workspace'

export const WORKTREE_PROVIDER_ID = 'worktree'

interface PorcelainRow {
  path: string
  branch?: string
  commit?: string
  isCurrent: boolean
  provider: string
}

const fail = (project: ProjectId, path: string, reason: string): WorkspaceFailed =>
  new WorkspaceFailed({ project, provider: WORKTREE_PROVIDER_ID, path, reason })

const runGit = (
  project: ProjectId,
  cwd: string,
  args: readonly string[],
): Effect.Effect<string, WorkspaceFailed> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolveOut, reject) => {
        execFile('git', [...args], { cwd, timeout: 10_000 }, (error, stdout, stderr) => {
          if (error) {
            reject(fail(project, cwd, stderr.trim() || error.message))
            return
          }
          resolveOut(stdout)
        })
      }),
    catch: (cause) =>
      cause instanceof WorkspaceFailed ? cause : fail(project, cwd, String(cause)),
  })

const canonical = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const parsePorcelain = (
  project: ProjectId,
  stdout: string,
  cwd: string,
): readonly WorkspaceInfo[] => {
  const entries: WorkspaceInfo[] = []
  const home = canonical(cwd)
  let current: { path?: string; branch?: string; commit?: string } | undefined
  const flush = () => {
    if (current?.path !== undefined) {
      const row: PorcelainRow = {
        path: current.path,
        isCurrent: canonical(current.path) === home,
        provider: WORKTREE_PROVIDER_ID,
      }
      if (current.branch !== undefined) row.branch = current.branch
      if (current.commit !== undefined) row.commit = current.commit
      entries.push(row)
    }
    current = undefined
  }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length).trim() }
    } else if (line.startsWith('branch ')) {
      if (current !== undefined) current.branch = line.slice('branch '.length).trim()
    } else if (line.startsWith('HEAD ')) {
      if (current !== undefined) current.commit = line.slice('HEAD '.length).trim()
    } else if (line.length === 0) {
      flush()
    }
  }
  flush()
  return entries
}

const runSetupHook = (path: string): Effect.Effect<void> =>
  Effect.promise(
    () =>
      new Promise<void>((resolveHook) => {
        const hook = resolve(path, '.oru-setup.sh')
        if (!existsSync(hook)) {
          resolveHook()
          return
        }
        execFile('sh', [hook], { cwd: path, timeout: 60_000 }, () => resolveHook())
      }),
  ).pipe(Effect.asVoid)

const list = (
  project: ProjectId,
  cwd: string,
): Effect.Effect<readonly WorkspaceInfo[], WorkspaceFailed> =>
  Effect.gen(function* () {
    const stdout = yield* runGit(project, cwd, ['worktree', 'list', '--porcelain'])
    return parsePorcelain(project, stdout, cwd)
  })

const provision = (
  project: ProjectId,
  cwd: string,
  path: string,
  options?: WorkspaceProvisionOptions,
): Effect.Effect<WorkspaceInfo, WorkspaceFailed> =>
  Effect.gen(function* () {
    if (!isAbsolute(path)) {
      return yield* Effect.fail(fail(project, path, 'workspace path is not absolute'))
    }
    const branch = options?.branch
    if (branch === undefined) {
      yield* runGit(project, cwd, ['worktree', 'add', path])
    } else {
      yield* runGit(project, cwd, ['worktree', 'add', '-b', branch, path])
    }
    yield* runSetupHook(path)
    const stdout = yield* runGit(project, cwd, ['worktree', 'list', '--porcelain'])
    const created = parsePorcelain(project, stdout, cwd).find(
      (entry) => canonical(entry.path) === canonical(path),
    )
    if (created !== undefined) return created
    return { path, isCurrent: false, provider: WORKTREE_PROVIDER_ID }
  })

const remove = (
  project: ProjectId,
  cwd: string,
  path: string,
): Effect.Effect<string, WorkspaceFailed> =>
  Effect.gen(function* () {
    if (canonical(path) === canonical(cwd)) {
      return yield* Effect.fail(fail(project, path, 'cannot remove the project checkout itself'))
    }
    yield* runGit(project, cwd, ['worktree', 'remove', '--force', path])
    return path
  })

/**
 * `oru/workspace-git`, the git-worktree workspace strategy.
 *
 * One provider under `WorkspaceKind`: `git worktree list/add/remove` over the
 * project's checkout, plus the `.oru-setup.sh` hook. Replacing the mechanism
 * is another plugin contributing the same kind, never a change to the host.
 */
export const gitWorkspaceProvider = defineWorkspaceProvider({
  meta: { id: WORKTREE_PROVIDER_ID, label: 'Git worktree' },
  list,
  provision,
  remove,
})

export const workspaceGitPlugin = definePlugin({
  id: 'oru/workspace-git',
  apply: (ctx) => ctx.contribute(WorkspaceKind.of(gitWorkspaceProvider)),
})

export default workspaceGitPlugin
