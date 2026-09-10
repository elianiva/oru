import { Schema } from 'effect'

export const PluginId = Schema.NonEmptyString
export type PluginId = typeof PluginId.Type

export const TokenId = Schema.NonEmptyString
export type TokenId = typeof TokenId.Type

export const ThreadId = Schema.NonEmptyString
export type ThreadId = typeof ThreadId.Type

export const EventId = Schema.NonEmptyString
export type EventId = typeof EventId.Type

export const TurnId = Schema.NonEmptyString
export type TurnId = typeof TurnId.Type

export const ToolCallId = Schema.NonEmptyString
export type ToolCallId = typeof ToolCallId.Type

export const PluginScope = Schema.Literals(['host', 'thread'])
export type PluginScope = typeof PluginScope.Type
