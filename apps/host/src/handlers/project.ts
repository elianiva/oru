import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Effect, Option, Predicate } from 'effect'
import {
  UnknownProvider,
  Workspaces,
  type WorkspaceEntry,
  type WorkspacesContract,
} from '@oru/workspace'
import type { Host } from '@oru/kernel'

/** The provider a call names, or the host default. Unknown names fail typed. */
const resolveWorkspaceProvider = (
  registry: WorkspacesContract,
  provider: string | undefined,
): Effect.Effect<WorkspaceEntry, UnknownProvider> =>
  Effect.gen(function* () {
    if (provider !== undefined) {
      const named = yield* registry.get(provider)
      if (Option.isSome(named)) return named.value
      return yield* new UnknownProvider({ provider })
    }
    const preferred = yield* registry.preferred()
    if (Option.isSome(preferred)) return preferred.value
    return yield* new UnknownProvider({ provider: '(default)' })
  })
import {
  DirectoryMissing,
  NotDirectory,
  PersonalProjectLocked,
  ProjectCreated,
  ProjectDeleted,
  ProjectUpdated,
  RelativeCwd,
  SessionLog,
  UnknownProject,
  ensurePersonalProject,
  foldProject,
  foldProjectCreatedAt,
  foldProjectThreadDefaults,
  foldProjectThreads,
  foldProjects,
  isPersonalProjectId,
  newId,
  unsignedTree,
  type ProjectId,
} from '@oru/kernel'

const keepProjectError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, 'RelativeCwd') ||
      Predicate.isTagged(error, 'UnknownProject') ||
      Predicate.isTagged(error, 'PersonalProjectLocked') ||
      Predicate.isTagged(error, 'DirectoryMissing') ||
      Predicate.isTagged(error, 'NotDirectory') ||
      Predicate.isTagged(error, 'UnknownProvider') ||
      Predicate.isTagged(error, 'WorkspaceFailed')
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )

const blankIcon = (icon: string | undefined): string | undefined => {
  const trimmed = icon?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

export const projectRpcHandlers = (
  host: Host,
  options?: { readonly personalCwd?: string | undefined },
) => {
  const personalCwd = options?.personalCwd
  const seedPersonal =
    personalCwd === undefined
      ? Effect.void
      : Effect.gen(function* () {
          const log = yield* SessionLog
          const missing = ensurePersonalProject(yield* log.entries, personalCwd)
          if (missing === undefined) return
          yield* Effect.sync(() => mkdirSync(personalCwd, { recursive: true }))
          yield* log.write(
            ProjectCreated.make({
              ...unsignedTree,
              id: yield* newId(),
              project: missing.id,
              name: missing.name,
              cwd: missing.cwd,
            }),
          )
        })
  return {
    CreateProject: (payload: {
      readonly name: string
      readonly cwd: string
      readonly icon?: string | undefined
    }) =>
      keepProjectError(
        Effect.gen(function* () {
          yield* seedPersonal
          if (!isAbsolute(payload.cwd)) {
            return yield* new RelativeCwd({ cwd: payload.cwd })
          }
          const log = yield* SessionLog
          const project = yield* newId()
          const icon = blankIcon(payload.icon)
          if (icon === undefined) {
            yield* log.write(
              ProjectCreated.make({
                ...unsignedTree,
                id: yield* newId(),
                project,
                name: payload.name,
                cwd: payload.cwd,
              }),
            )
            return { id: project, name: payload.name, cwd: payload.cwd }
          }
          yield* log.write(
            ProjectCreated.make({
              ...unsignedTree,
              id: yield* newId(),
              project,
              name: payload.name,
              cwd: payload.cwd,
              icon,
            }),
          )
          return { id: project, name: payload.name, cwd: payload.cwd, icon }
        }),
      ),
    ListProjects: () =>
      Effect.gen(function* () {
        yield* seedPersonal
        const log = yield* SessionLog
        return foldProjects(yield* log.entries)
      }).pipe(Effect.orDie),
    UpdateProject: (payload: {
      readonly project: ProjectId
      readonly name: string
      readonly cwd: string
      readonly icon?: string | undefined
    }) =>
      keepProjectError(
        Effect.gen(function* () {
          if (!isAbsolute(payload.cwd)) {
            return yield* new RelativeCwd({ cwd: payload.cwd })
          }
          const log = yield* SessionLog
          const existing = foldProject(yield* log.entries, payload.project)
          if (existing === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          const icon = blankIcon(payload.icon)
          if (icon === undefined) {
            yield* log.write(
              ProjectUpdated.make({
                ...unsignedTree,
                id: yield* newId(),
                project: payload.project,
                name: payload.name,
                cwd: payload.cwd,
              }),
            )
            return { id: payload.project, name: payload.name, cwd: payload.cwd }
          }
          yield* log.write(
            ProjectUpdated.make({
              ...unsignedTree,
              id: yield* newId(),
              project: payload.project,
              name: payload.name,
              cwd: payload.cwd,
              icon,
            }),
          )
          return { id: payload.project, name: payload.name, cwd: payload.cwd, icon }
        }),
      ),
    DeleteProject: (payload: { readonly project: ProjectId }) =>
      keepProjectError(
        Effect.gen(function* () {
          if (isPersonalProjectId(payload.project)) {
            return yield* new PersonalProjectLocked({ project: payload.project })
          }
          const log = yield* SessionLog
          const existing = foldProject(yield* log.entries, payload.project)
          if (existing === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          yield* log.write(
            ProjectDeleted.make({
              ...unsignedTree,
              id: yield* newId(),
              project: payload.project,
            }),
          )
          return { project: payload.project }
        }),
      ),
    GetProjectDetail: (payload: { readonly project: ProjectId }) =>
      keepProjectError(
        Effect.gen(function* () {
          const log = yield* SessionLog
          const entries = yield* log.entries
          const named = foldProject(entries, payload.project)
          if (named === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          const threads = foldProjectThreads(entries, payload.project)
          const defaults = foldProjectThreadDefaults(entries, payload.project)
          const createdAt = foldProjectCreatedAt(entries, payload.project) ?? Date.now()
          const gitRemote = yield* Effect.tryPromise({
            try: () =>
              new Promise<string | undefined>((resolveRemote) => {
                execFile(
                  'git',
                  ['-C', named.cwd, 'config', '--get', 'remote.origin.url'],
                  { timeout: 2000 },
                  (error, stdout) => {
                    if (error) {
                      resolveRemote(undefined)
                      return
                    }
                    const remote = stdout.trim()
                    resolveRemote(remote.length === 0 ? undefined : remote)
                  },
                )
              }),
            catch: () => new UnknownProject({ project: payload.project }),
          }).pipe(
            Effect.catch(() => Effect.succeed<string | undefined>(undefined)),
            Effect.orDie,
          )
          return {
            project: named,
            threadCount: threads.length,
            createdAt,
            gitRemote,
            checkout: { machine: hostname(), path: named.cwd },
            threadDefaults:
              defaults === undefined
                ? undefined
                : {
                    harness: defaults.harness,
                    model: defaults.model,
                    reasoning: defaults.reasoning,
                  },
          }
        }),
      ),
    GetProject: (payload: { readonly project: ProjectId }) =>
      keepProjectError(
        Effect.gen(function* () {
          const log = yield* SessionLog
          const named = foldProject(yield* log.entries, payload.project)
          if (named === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          return named
        }),
      ),
    ListDirectory: (payload: { readonly path?: string | undefined }) =>
      keepProjectError(
        Effect.gen(function* () {
          const home = process.env.HOME ?? process.env.USERPROFILE ?? '/'
          const path = payload.path === undefined ? home : payload.path
          if (!isAbsolute(path)) {
            return yield* new NotDirectory({ path })
          }
          const resolved = resolve(path)
          const info = yield* Effect.tryPromise({
            try: () => stat(resolved),
            catch: () => new DirectoryMissing({ path }),
          })
          if (!info.isDirectory()) {
            return yield* new NotDirectory({ path })
          }
          const names = yield* Effect.tryPromise({
            try: () => readdir(resolved),
            catch: () => new DirectoryMissing({ path }),
          })
          const entries = yield* Effect.forEach(names.toSorted(), (name) =>
            Effect.option(
              Effect.tryPromise({
                try: async () => {
                  const entryPath = join(resolved, name)
                  const entryInfo = await stat(entryPath)
                  return {
                    name,
                    path: entryPath,
                    isDirectory: entryInfo.isDirectory(),
                  }
                },
                catch: () => new DirectoryMissing({ path: resolved }),
              }),
            ),
          ).pipe(
            Effect.map((listed) =>
              listed.flatMap((entry) => (Option.isSome(entry) ? [entry.value] : [])),
            ),
          )
          const parent = dirname(resolved)
          return parent === resolved
            ? { path: resolved, entries }
            : { path: resolved, parent, entries }
        }),
      ),
    ListWorkspaces: (payload: { readonly project: ProjectId }) =>
      keepProjectError(
        Effect.gen(function* () {
          const log = yield* SessionLog
          const named = foldProject(yield* log.entries, payload.project)
          if (named === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          const registry = yield* host.service(Workspaces)
          const entries = yield* registry.list()
          // Best effort across strategies: a provider that cannot read this
          // checkout reports nothing instead of failing the whole listing.
          const infos = yield* Effect.forEach(entries, (entry) =>
            entry.provider.list(payload.project, named.cwd).pipe(Effect.option),
          )
          return infos.flatMap((info) => (Option.isSome(info) ? [...info.value] : []))
        }),
      ),
    CreateWorkspace: (payload: {
      readonly project: ProjectId
      readonly path: string
      readonly branch?: string | undefined
      readonly provider?: string | undefined
    }) =>
      keepProjectError(
        Effect.gen(function* () {
          if (!isAbsolute(payload.path)) {
            return yield* new RelativeCwd({ cwd: payload.path })
          }
          const log = yield* SessionLog
          const named = foldProject(yield* log.entries, payload.project)
          if (named === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          const entry = yield* resolveWorkspaceProvider(
            yield* host.service(Workspaces),
            payload.provider,
          )
          return yield* entry.provider.provision(
            payload.project,
            named.cwd,
            payload.path,
            payload.branch === undefined ? undefined : { branch: payload.branch },
          )
        }),
      ),
    RemoveWorkspace: (payload: {
      readonly project: ProjectId
      readonly path: string
      readonly provider?: string | undefined
    }) =>
      keepProjectError(
        Effect.gen(function* () {
          const log = yield* SessionLog
          const named = foldProject(yield* log.entries, payload.project)
          if (named === undefined) {
            return yield* new UnknownProject({ project: payload.project })
          }
          const entry = yield* resolveWorkspaceProvider(
            yield* host.service(Workspaces),
            payload.provider,
          )
          const removed = yield* entry.provider.remove(payload.project, named.cwd, payload.path)
          return { path: removed }
        }),
      ),
  }
}
