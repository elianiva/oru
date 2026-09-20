import { Schema } from 'effect'

/**
 * The bridge's environment, as plain data on the plugin's `Config`.
 *
 * A configured env is the child's whole environment, so a scripted test
 * stays hermetic; absent, the bridge runs on the process environment.
 * `undefined` values never survive the trip across the host boundary, so
 * the schema admits them and `envOf` drops them before the spawn.
 */
export const ClaudeCodeEnv = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String))
export type ClaudeCodeEnv = typeof ClaudeCodeEnv.Type

export const ClaudeCodeConfig = Schema.Struct({
  env: Schema.optional(ClaudeCodeEnv),
})
export type ClaudeCodeConfig = typeof ClaudeCodeConfig.Type
export type ClaudeCodeConfigValue = ClaudeCodeConfig

/** A config env is the child's whole environment; `undefined` reads as absent. */
export const envOf = (env: ClaudeCodeEnv | undefined): NodeJS.ProcessEnv => {
  if (env === undefined) return process.env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
