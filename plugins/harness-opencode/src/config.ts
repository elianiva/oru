import { Schema } from 'effect'

/**
 * The bridge's environment, as plain data on the plugin's `Config`.
 *
 * A configured env is the bridge's whole environment, so a scripted test
 * stays hermetic; absent, the bridge runs on the process environment.
 * `undefined` values never survive the trip across the host boundary, so
 * the schema admits them and `envOf` drops them before use.
 */
export const OpenCodeEnv = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String))
export type OpenCodeEnv = typeof OpenCodeEnv.Type

export const OpenCodeConfig = Schema.Struct({
  env: Schema.optional(OpenCodeEnv),
})
export type OpenCodeConfig = typeof OpenCodeConfig.Type
export type OpenCodeConfigValue = OpenCodeConfig

/** A config env is the bridge's whole environment; `undefined` reads as absent. */
export const envOf = (env: OpenCodeEnv | undefined): NodeJS.ProcessEnv => {
  if (env === undefined) return process.env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
