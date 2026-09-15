import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
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

const children = []

const stop = () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const host = spawn(process.execPath, [hostMain, '--port', '7317', '--journal', journal], {
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

const hostReady = new Promise((resolve, reject) => {
  let settled = false
  const fail = (reason) => {
    if (settled) return
    settled = true
    reject(reason instanceof Error ? reason : new Error(String(reason)))
  }
  const pass = () => {
    if (settled) return
    settled = true
    resolve(undefined)
  }
  const timer = setTimeout(() => {
    fail(new Error(`the host did not listen:\n${hostText}`))
  }, 30_000)
  const check = () => {
    if (/listening on http:\/\//u.test(hostText)) {
      clearTimeout(timer)
      pass()
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

await hostReady

const vite = spawn(
  'pnpm',
  ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  { cwd: appDir, stdio: 'inherit' },
)
children.push(vite)

vite.once('exit', (code) => {
  stop()
  process.exit(code ?? 1)
})
