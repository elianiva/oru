import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { DirectoryMissing, NotDirectory, ProjectId, RelativeCwd, UnknownProject } from '@oru/kernel'
import { Project } from './project.ts'

export const DirectoryEntry = Schema.Struct({
  name: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
  isDirectory: Schema.Boolean,
})
export type DirectoryEntry = typeof DirectoryEntry.Type

export const DirectoryListing = Schema.Struct({
  path: Schema.NonEmptyString,
  parent: Schema.optional(Schema.String),
  entries: Schema.Array(DirectoryEntry),
})
export type DirectoryListing = typeof DirectoryListing.Type

export const ProjectRpc = RpcGroup.make(
  Rpc.make('CreateProject', {
    payload: {
      name: Schema.NonEmptyString,
      cwd: Schema.NonEmptyString,
      icon: Schema.optional(Schema.String),
    },
    success: Project,
    error: RelativeCwd,
  }),
  Rpc.make('UpdateProject', {
    payload: {
      project: ProjectId,
      name: Schema.NonEmptyString,
      cwd: Schema.NonEmptyString,
      icon: Schema.optional(Schema.String),
    },
    success: Project,
    error: Schema.Union([RelativeCwd, UnknownProject]),
  }),
  Rpc.make('DeleteProject', {
    payload: { project: ProjectId },
    success: Schema.Struct({ project: ProjectId }),
    error: UnknownProject,
  }),
  Rpc.make('ListProjects', {
    success: Schema.Array(Project),
  }),
  Rpc.make('GetProject', {
    payload: { project: ProjectId },
    success: Project,
    error: UnknownProject,
  }),
  Rpc.make('ListDirectory', {
    payload: { path: Schema.optional(Schema.String) },
    success: DirectoryListing,
    error: Schema.Union([DirectoryMissing, NotDirectory]),
  }),
)
