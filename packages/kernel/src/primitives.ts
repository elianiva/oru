import { Schema } from 'effect'

export const PluginId = Schema.NonEmptyString
export type PluginId = typeof PluginId.Type

export const BundleAddress = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9a-f]{64}$/))
export type BundleAddress = typeof BundleAddress.Type

export const TokenId = Schema.NonEmptyString
export type TokenId = typeof TokenId.Type

export const ThreadId = Schema.NonEmptyString
export type ThreadId = typeof ThreadId.Type

export const ProjectId = Schema.NonEmptyString

/** The singleton project every host seeds: one stable id across restarts, so the no-project working mode is a project fact and needs no migration. */
// SAFETY: 'personal' is a non-empty literal, so it satisfies the ProjectId string contract.
export const PERSONAL_PROJECT_ID = 'personal' as ProjectId
export const PERSONAL_PROJECT_NAME = 'Personal'
export const isPersonalProjectId = (id: string): id is ProjectId => id === PERSONAL_PROJECT_ID
export type ProjectId = typeof ProjectId.Type

export const EventId = Schema.NonEmptyString
export type EventId = typeof EventId.Type

export const TurnId = Schema.NonEmptyString
export type TurnId = typeof TurnId.Type

export const ToolCallId = Schema.NonEmptyString
export type ToolCallId = typeof ToolCallId.Type

export const PluginScope = Schema.Literals(['host', 'thread'])
export type PluginScope = typeof PluginScope.Type
