import { Schema } from 'effect'

/**
 * The bridge's environment, as plain data on the plugin's `Config`.
 *
 * A configured env is the child's whole environment, so a scripted test
 * stays hermetic; absent, the bridge runs on the process environment.
 * `undefined` values never survive the trip across the host boundary, so
 * the schema admits them and `envOf` drops them before the spawn.
 */
export const PiBridgeEnv = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String))
export type PiBridgeEnv = typeof PiBridgeEnv.Type

export const PiBridgeConfig = Schema.Struct({
  env: Schema.optional(PiBridgeEnv),
})
export type PiBridgeConfig = typeof PiBridgeConfig.Type
export type PiBridgeConfigValue = PiBridgeConfig

/** A config env is the child's whole environment; `undefined` reads as absent. */
export const envOf = (env: PiBridgeEnv | undefined): NodeJS.ProcessEnv => {
  if (env === undefined) return process.env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
