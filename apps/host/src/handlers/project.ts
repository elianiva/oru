import { isAbsolute } from 'node:path'
import { Clock, Effect, Random } from 'effect'
import {
  ProjectCreated,
  SessionLog,
  foldProject,
  foldProjects,
  unsignedTree,
  type ProjectId,
} from '@oru/kernel'

const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})

export const projectRpcHandlers = {
  CreateProject: (payload: { readonly name: string; readonly cwd: string }) =>
    Effect.gen(function* () {
      if (!isAbsolute(payload.cwd)) {
        return yield* Effect.die(new Error(`project cwd must be absolute, got ${payload.cwd}`))
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
    }).pipe(Effect.orDie),
  ListProjects: () =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      return foldProjects(yield* log.entries)
    }).pipe(Effect.orDie),
  GetProject: (payload: { readonly project: ProjectId }) =>
    Effect.gen(function* () {
      const log = yield* SessionLog
      const named = foldProject(yield* log.entries, payload.project)
      if (named === undefined) {
        return yield* Effect.die(new Error(`unknown project ${payload.project}`))
      }
      return named
    }).pipe(Effect.orDie),
}
