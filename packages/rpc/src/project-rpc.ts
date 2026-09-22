import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import {
  DirectoryMissing,
  NotDirectory,
  PersonalProjectLocked,
  ProjectId,
  ProviderUnavailable,
  RelativeCwd,
  UnknownProject,
} from '@oru/kernel'
import { UnknownProvider, WorkspaceFailed, WorkspaceInfo } from '@oru/workspace'
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

export const Checkout = Schema.Struct({
  machine: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
})
export type Checkout = typeof Checkout.Type

export const ProjectThreadDefaults = Schema.Struct({
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  model: Schema.UndefinedOr(Schema.NonEmptyString),
  reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
})
export type ProjectThreadDefaults = typeof ProjectThreadDefaults.Type

export const ProjectDetail = Schema.Struct({
  project: Project,
  threadCount: Schema.Number,
  createdAt: Schema.Number,
  gitRemote: Schema.UndefinedOr(Schema.String),
  checkout: Checkout,
  threadDefaults: Schema.UndefinedOr(ProjectThreadDefaults),
})
export type ProjectDetail = typeof ProjectDetail.Type

export { WorkspaceInfo }

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
    error: Schema.Union([UnknownProject, PersonalProjectLocked]),
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
  Rpc.make('GetProjectDetail', {
    payload: { project: ProjectId },
    success: ProjectDetail,
    error: UnknownProject,
  }),
  Rpc.make('ListWorkspaces', {
    payload: { project: ProjectId },
    success: Schema.Array(WorkspaceInfo),
    error: Schema.Union([UnknownProject, UnknownProvider, WorkspaceFailed, ProviderUnavailable]),
  }),
  Rpc.make('CreateWorkspace', {
    payload: {
      project: ProjectId,
      path: Schema.NonEmptyString,
      branch: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
    },
    success: WorkspaceInfo,
    error: Schema.Union([
      UnknownProject,
      RelativeCwd,
      UnknownProvider,
      WorkspaceFailed,
      ProviderUnavailable,
    ]),
  }),
  Rpc.make('RemoveWorkspace', {
    payload: {
      project: ProjectId,
      path: Schema.NonEmptyString,
      provider: Schema.optional(Schema.String),
    },
    success: Schema.Struct({ path: Schema.String }),
    error: Schema.Union([UnknownProject, UnknownProvider, WorkspaceFailed, ProviderUnavailable]),
  }),
)
