import { Schema } from 'effect'

export const PluginId = Schema.NonEmptyString
export type PluginId = Schema.Schema.Type<typeof PluginId>

export const TokenId = Schema.NonEmptyString
export type TokenId = Schema.Schema.Type<typeof TokenId>

export const ThreadId = Schema.NonEmptyString
export type ThreadId = Schema.Schema.Type<typeof ThreadId>

export const PluginScope = Schema.Literals(['host', 'thread'])
export type PluginScope = Schema.Schema.Type<typeof PluginScope>
