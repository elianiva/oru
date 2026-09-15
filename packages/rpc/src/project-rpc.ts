import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { ProjectId, RelativeCwd, UnknownProject } from '@oru/kernel'
import { Project } from './project.ts'

export const ProjectRpc = RpcGroup.make(
  Rpc.make('CreateProject', {
    payload: { name: Schema.NonEmptyString, cwd: Schema.NonEmptyString },
    success: Project,
    error: RelativeCwd,
  }),
  Rpc.make('ListProjects', {
    success: Schema.Array(Project),
  }),
  Rpc.make('GetProject', {
    payload: { project: ProjectId },
    success: Project,
    error: UnknownProject,
  }),
)
