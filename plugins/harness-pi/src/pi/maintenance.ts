import { execFileSync } from 'node:child_process'
import { HarnessHealth } from '@oru/harness'

/**
 * pi's version gate (ADR-0023).
 *
 * oru reports what is wrong and what to run; it does not install anything. The
 * version oru requires is the oldest one whose RPC surface this bridge uses:
 * `agent_settled` and `--no-builtin-tools` both exist from 0.84.0.
 */

export const MINIMUM_PI_VERSION = '0.84.0'

export interface PiVersion {
  readonly raw: string
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** `0.85.1` and pre-release suffixes both parse; anything else is unknown. */
export const parsePiVersion = (raw: string): PiVersion | undefined => {
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

export const isSupportedVersion = (version: PiVersion): boolean => {
  const [minimumMajor, minimumMinor, minimumPatch] = MINIMUM_PI_VERSION.split('.').map(Number)
  if (minimumMajor === undefined || minimumMinor === undefined || minimumPatch === undefined) {
    return false
  }
  if (version.major !== minimumMajor) return version.major > minimumMajor
  if (version.minor !== minimumMinor) return version.minor > minimumMinor
  return version.patch >= minimumPatch
}

/**
 * The command that would fix an old pi, derived from how this pi was installed.
 *
 * A global bun or npm install is upgraded through its own package manager;
 * anything else upgrades itself through `pi update self`.
 */
export const installCommandFor = (executable: string): string =>
  executable.includes('/.bun/') || executable.includes('/bun/')
    ? 'bun add -g @earendil-works/pi-coding-agent@latest'
    : executable.includes('/lib/node_modules/')
      ? 'npm install -g @earendil-works/pi-coding-agent@latest'
      : 'pi update self'

/** A launch: the command and the arguments that make it run pi. */
export interface PiLaunch {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Ask this pi for its version, through the same launch a turn would use — a pi
 * behind a wrapper or a runner reports its version through its arguments, not
 * through its name. Absent or unreadable means not installed.
 */
export const probePiVersion = (launch: PiLaunch, env: NodeJS.ProcessEnv): string | undefined => {
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

/** Health from the outside: installed, new enough, and usable. */
export const healthFromVersion = (
  raw: string | undefined,
  installCommand: string,
): HarnessHealth => {
  if (raw === undefined || raw === '') {
    return HarnessHealth.make({
      status: 'not_installed',
      message: 'pi is not on PATH',
      minimumSupportedVersion: MINIMUM_PI_VERSION,
      installCommand,
    })
  }
  const version = parsePiVersion(raw)
  if (version === undefined) {
    return HarnessHealth.make({
      status: 'unknown',
      message: `pi reported an unrecognized version: ${raw}`,
      installedVersion: raw,
      minimumSupportedVersion: MINIMUM_PI_VERSION,
      installCommand,
    })
  }
  if (!isSupportedVersion(version)) {
    return HarnessHealth.make({
      status: 'unsupported_version',
      message: `pi ${version.raw} is older than ${MINIMUM_PI_VERSION}`,
      installedVersion: version.raw,
      minimumSupportedVersion: MINIMUM_PI_VERSION,
      installCommand,
    })
  }
  return HarnessHealth.make({
    status: 'ready',
    installedVersion: version.raw,
    minimumSupportedVersion: MINIMUM_PI_VERSION,
    installCommand,
  })
}
