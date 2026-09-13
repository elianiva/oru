import { mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the bridge keeps things.
 *
 * Sessions are keyed by thread id so resume, checkpoint fork, and discard are
 * ordinary file operations; scratch files are per process because they exist
 * only as long as the pi children that read them (ADR-0007).
 */
export interface PiPaths {
  readonly sessionDir: string
  readonly scratchDir: string
}

const ORU_PI_HOME = 'ORU_PI_HOME'
const ORU_PI_SESSION_DIR = 'ORU_PI_SESSION_DIR'

/** Thread ids are opaque; a file name is not. */
const sanitize = (threadId: string): string => threadId.replace(/[^A-Za-z0-9._-]/gu, '-')

export const piHome = (env: NodeJS.ProcessEnv): string =>
  env[ORU_PI_HOME] ?? join(homedir(), '.oru', 'pi')

export const resolvePiPaths = (env: NodeJS.ProcessEnv): PiPaths => {
  const sessionDir = env[ORU_PI_SESSION_DIR] ?? join(piHome(env), 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  const scratchDir = mkdtempSync(join(tmpdir(), 'oru-pi-'))
  return { sessionDir, scratchDir }
}

export const sessionFileFor = (paths: PiPaths, threadId: string): string =>
  join(paths.sessionDir, `${sanitize(threadId)}.jsonl`)

export const toolsFileFor = (paths: PiPaths, threadId: string): string =>
  join(paths.scratchDir, `tools-${sanitize(threadId)}.json`)
