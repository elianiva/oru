import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the bridge keeps things.
 *
 * Each thread maps to the Muse session id its last turn ran in, so resume is
 * a file read. The `claude` CLI owns the conversation itself; oru keeps only
 * the pointer, never a transcript (ADR-0007).
 */
export interface ClaudePaths {
  readonly sessionDir: string
}

const ORU_CLAUDE_HOME = 'ORU_CLAUDE_HOME'
const ORU_CLAUDE_SESSION_DIR = 'ORU_CLAUDE_SESSION_DIR'

/** Thread ids are opaque; a file name is not. */
const sanitize = (threadId: string): string => threadId.replace(/[^A-Za-z0-9._-]/gu, '-')

export const claudeHome = (env: NodeJS.ProcessEnv): string =>
  env[ORU_CLAUDE_HOME] ?? join(homedir(), '.oru', 'Muse')

export const resolveClaudePaths = (env: NodeJS.ProcessEnv): ClaudePaths => {
  const sessionDir = env[ORU_CLAUDE_SESSION_DIR] ?? join(claudeHome(env), 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  return { sessionDir }
}

/** The file holding one thread's `{ sessionId, cwd }` pointer. */
export const mapFileFor = (paths: ClaudePaths, threadId: string): string =>
  join(paths.sessionDir, `${sanitize(threadId)}.json`)
