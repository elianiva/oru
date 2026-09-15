import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { ProjectId } from '@oru/kernel'
import { Project } from './project.ts'

export const ProjectRpc = RpcGroup.make(
  Rpc.make('CreateProject', {
    payload: { name: Schema.NonEmptyString, cwd: Schema.NonEmptyString },
    success: Project,
  }),
  Rpc.make('ListProjects', {
    success: Schema.Array(Project),
  }),
  Rpc.make('GetProject', {
    payload: { project: ProjectId },
    success: Project,
  }),
)
