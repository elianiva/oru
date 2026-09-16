import { isAbsolute } from 'node:path'
import { Effect, Predicate } from 'effect'
import {
  ProjectCreated,
  ProjectUpdated,
  RelativeCwd,
  SessionLog,
  UnknownProject,
  foldProject,
  foldProjects,
  newId,
  unsignedTree,
  type ProjectId,
} from '@oru/kernel'

const keepProjectError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, 'RelativeCwd') || Predicate.isTagged(error, 'UnknownProject')
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )

export const projectRpcHandlers = {
  CreateProject: (payload: { readonly name: string; readonly cwd: string }) =>
    keepProjectError(
      Effect.gen(function* () {
        if (!isAbsolute(payload.cwd)) {
          return yield* new RelativeCwd({ cwd: payload.cwd })
        }
        const log = yield* SessionLog
        const project = yield* newId()
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
      }),
    ),
  ListProjects: () =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      return foldProjects(yield* log.entries)
    }).pipe(Effect.orDie),
  UpdateProject: (payload: {
    readonly project: ProjectId
    readonly name: string
    readonly cwd: string
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
}
