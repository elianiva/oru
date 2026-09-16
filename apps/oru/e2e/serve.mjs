import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eDir = dirname(fileURLToPath(import.meta.url))
const appDir = dirname(e2eDir)
const repoDir = dirname(dirname(appDir))
const outDir = join(appDir, 'test-results')
mkdirSync(outDir, { recursive: true })

const hostLog = join(outDir, 'host.log')
const journal = join(outDir, 'oru.db')
const hostMain = join(repoDir, 'apps/host/src/main.ts')
const log = createWriteStream(hostLog)

// The dev server the suite drives. It moves with the environment so the suite
// can run beside a `pnpm dev` that already holds 5173.
const appPort = process.env.ORU_E2E_PORT ?? '5173'

// Each run starts from an empty log, so "a fresh host has no projects" is a
// property of the run and not of whatever an earlier run left behind.
rmSync(journal, { force: true })

const children = []

const stop = () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

// Port 0: the host picks its own, so a dev host on 7317 is not in the way. The
// dev server is told where it landed through the proxy target.
const host = spawn(process.execPath, [hostMain, '--port', '0', '--journal', journal], {
  env: { ...process.env, ORU_JOURNAL: journal },
  stdio: ['ignore', 'pipe', 'pipe'],
})
children.push(host)

let hostText = ''
const takeHostChunk = (chunk) => {
  const text = String(chunk)
  hostText += text
  log.write(text)
}

const hostUrl = await new Promise((resolve, reject) => {
  let settled = false
  const fail = (reason) => {
    if (settled) return
    settled = true
    reject(reason instanceof Error ? reason : new Error(String(reason)))
  }
  const pass = (url) => {
    if (settled) return
    settled = true
    resolve(url)
  }
  const timer = setTimeout(() => {
    fail(new Error(`the host did not listen:\n${hostText}`))
  }, 30_000)
  const check = () => {
    const listening = /listening on (http:\/\/\S+)/u.exec(hostText)
    if (listening?.[1] !== undefined) {
      clearTimeout(timer)
      pass(listening[1])
    }
  }
  host.stdout.on('data', (chunk) => {
    takeHostChunk(chunk)
    check()
  })
  host.stderr.on('data', (chunk) => {
    takeHostChunk(chunk)
    check()
  })
  host.once('error', fail)
  host.once('exit', (code) => {
    fail(new Error(`the host exited with ${String(code)} before listening:\n${hostText}`))
  })
  check()
})

const vite = spawn(
  'pnpm',
  ['exec', 'vite', '--host', '127.0.0.1', '--port', appPort, '--strictPort'],
  { cwd: appDir, env: { ...process.env, ORU_PROXY_TARGET: hostUrl }, stdio: 'inherit' },
)
children.push(vite)

vite.once('exit', (code) => {
  stop()
  process.exit(code ?? 1)
})
