import { execFileSync } from 'node:child_process'
import { Option, Schema } from 'effect'

/**
 * How to run the `claude` CLI, and whether it is new enough to drive.
 *
 * oru reports what is wrong and what to run; it does not install anything. The
 * version oru requires is the oldest one whose `stream-json` output this
 * bridge reads: `--resume` and `--include-partial-messages` both exist from
 * 2.0.0.
 */

export const CLAUDE_COMMAND_ENV = 'ORU_CLAUDE_COMMAND'
export const CLAUDE_ARGS_ENV = 'ORU_CLAUDE_ARGS'

export const MINIMUM_CLAUDE_VERSION = '2.0.0'

export interface ClaudeVersion {
  readonly raw: string
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export interface ClaudeLaunch {
  readonly command: string
  readonly args: readonly string[]
}

/** A bridge failure with a stable message, so the runtime records why. */
export class ClaudeLaunchError extends Schema.TaggedError<ClaudeLaunchError>()(
  'ClaudeLaunchError',
  {
    message: Schema.String,
  },
) {}

const decodeOption = Schema.decodeUnknownOption

const ExtraArgs = Schema.Array(Schema.String)

/**
 * `ORU_CLAUDE_COMMAND` / `ORU_CLAUDE_ARGS` point the bridge at a `claude` that
 * is not on `PATH`. The args are a JSON array of strings, decoded here so a
 * malformed value fails at launch resolution rather than mid-turn. The extras
 * apply to the default command too: naming args without a command still sends
 * them to the `claude` on `PATH`.
 */
export const resolveClaudeLaunch = (env: NodeJS.ProcessEnv): ClaudeLaunch => {
  const command = env[CLAUDE_COMMAND_ENV]
  const resolved = command === undefined || command === '' ? 'claude' : command
  const rawArgs = env[CLAUDE_ARGS_ENV]
  if (rawArgs === undefined || rawArgs === '') return { command: resolved, args: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    throw new ClaudeLaunchError({ message: `${CLAUDE_ARGS_ENV} must be a JSON array of strings` })
  }
  const args = decodeOption(ExtraArgs)(parsed)
  if (Option.isNone(args)) {
    throw new ClaudeLaunchError({ message: `${CLAUDE_ARGS_ENV} must be a JSON array of strings` })
  }
  return { command: resolved, args: args.value }
}

/** `2.1.8` and `2.0.0 (Claude Code)` both parse; anything else is unknown. */
export const parseClaudeVersion = (raw: string): ClaudeVersion | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(raw.trim())
  if (match === null) return undefined
  const [, major, minor, patch] = match
  return {
    raw: raw.trim(),
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  }
}

export const isSupportedVersion = (version: ClaudeVersion): boolean => {
  const [minimumMajor, minimumMinor, minimumPatch] = MINIMUM_CLAUDE_VERSION.split('.').map(Number)
  if (minimumMajor === undefined || minimumMinor === undefined || minimumPatch === undefined) {
    return false
  }
  if (version.major !== minimumMajor) return version.major > minimumMajor
  if (version.minor !== minimumMinor) return version.minor > minimumMinor
  return version.patch >= minimumPatch
}

/**
 * Ask this `claude` for its version, through the same launch a turn would use.
 * A `claude` behind a wrapper reports its version through its arguments, not
 * through its name. Absent or unreadable means not installed.
 */
export const probeClaudeVersion = (
  launch: ClaudeLaunch,
  env: NodeJS.ProcessEnv,
): string | undefined => {
  try {
    return execFileSync(launch.command, [...launch.args, '--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}
