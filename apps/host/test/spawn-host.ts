import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))

export interface Ran {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const collect = (child: ChildProcess) => {
  const out = child.stdout
  const err = child.stderr
  if (out === null || err === null) throw new Error('the host reported no streams')
  out.setEncoding('utf8')
  err.setEncoding('utf8')
  return { out, err }
}

/** Run the host binary to completion: `--help`, `--version`, or a bad argument. */
export const ranHost = (args: readonly string[]): Promise<Ran> => {
  const settled = Promise.withResolvers<Ran>()
  const child = spawn(process.execPath, [main, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const { out, err } = collect(child)
  let stdout = ''
  let stderr = ''
  out.on('data', (chunk: string) => {
    stdout += chunk
  })
  err.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.on('close', (code) => {
    settled.resolve({ code, stdout, stderr })
  })
  return settled.promise
}

export interface StartedHost {
  readonly url: string
  readonly output: () => string
  readonly stop: () => Promise<void>
}

const READY = /listening on (http:\/\/\S+)/u

/**
 * Ask for the end of the process. SIGTERM is what the host turns into an
 * orderly scope close, so the pi bridge stops its children; the kill is only
 * for a process that will not go.
 */
const stop = (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  const settled = Promise.withResolvers<void>()
  const killer = setTimeout(() => {
    child.kill('SIGKILL')
  }, 10_000)
  child.once('close', () => {
    clearTimeout(killer)
    settled.resolve()
  })
  child.kill('SIGTERM')
  return settled.promise
}

/** Start the real binary and resolve once it announces where it is listening. */
export const startedHost = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<StartedHost> => {
  const settled = Promise.withResolvers<StartedHost>()
  const child = spawn(process.execPath, [main, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  const { out, err } = collect(child)
  let output = ''
  let stderr = ''
  out.on('data', (chunk: string) => {
    output += chunk
    const url = READY.exec(output)?.[1]
    if (url !== undefined) {
      settled.resolve({ url, output: () => output, stop: () => stop(child) })
    }
  })
  err.on('data', (chunk: string) => {
    stderr += chunk
    output += chunk
  })
  child.on('error', (cause) => {
    settled.reject(cause)
  })
  child.on('close', (code) => {
    settled.reject(
      new Error(`the host exited with ${String(code)} before listening:\n${stderr}${output}`),
    )
  })
  return settled.promise
}
