import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  Command,
  defaultHost,
  defaultJournal,
  defaultPort,
  packageVersion,
  parseArgs,
} from '../src/index.ts'
import { ranHost, startedHost } from './spawn-host.ts'

describe('parseArgs', () => {
  it('serves on loopback by default', () => {
    expect(parseArgs([])).toEqual(
      Command.Serve({ hostname: defaultHost, port: defaultPort, journal: defaultJournal() }),
    )
  })

  it('takes a host and a port, including a port of zero', () => {
    expect(parseArgs(['--host', '0.0.0.0', '--port', '0'])).toEqual(
      Command.Serve({ hostname: '0.0.0.0', port: 0, journal: defaultJournal() }),
    )
  })

  it('takes the file the journal lives in', () => {
    expect(parseArgs(['--journal', '/tmp/oru-elsewhere.db'])).toEqual(
      Command.Serve({
        hostname: defaultHost,
        port: defaultPort,
        journal: '/tmp/oru-elsewhere.db',
      }),
    )
  })

  it('answers help and version', () => {
    expect(parseArgs(['--help'])).toEqual(Command.Help())
    expect(parseArgs(['-h'])).toEqual(Command.Help())
    expect(parseArgs(['--version'])).toEqual(Command.Version())
    expect(parseArgs(['-v'])).toEqual(Command.Version())
  })

  it('refuses an unknown argument, a missing value, and a port that is not one', () => {
    expect(parseArgs(['--nope'])).toEqual(Command.Invalid({ message: 'unknown argument --nope' }))
    expect(parseArgs(['--port'])).toEqual(Command.Invalid({ message: '--port needs a value' }))
    expect(parseArgs(['--host'])).toEqual(Command.Invalid({ message: '--host needs a value' }))
    expect(parseArgs(['--journal'])).toEqual(
      Command.Invalid({ message: '--journal needs a value' }),
    )
    expect(parseArgs(['--port', 'seventy'])).toEqual(
      Command.Invalid({ message: '--port takes a port number, got seventy' }),
    )
    expect(parseArgs(['--port', '70000'])).toEqual(
      Command.Invalid({ message: '--port takes a port number, got 70000' }),
    )
  })
})

describe('the host binary', () => {
  it('prints its usage and exits zero for --help', async () => {
    const ran = await ranHost(['--help'])
    expect(ran.code).toBe(0)
    expect(ran.stdout).toContain('Usage:')
    expect(ran.stdout).toContain('--port')
  })

  it('reports the package version for --version', async () => {
    const ran = await ranHost(['--version'])
    expect(ran.code).toBe(0)
    expect(ran.stdout.trim()).toBe(packageVersion())
  })

  it('prints usage to stderr and exits two for an argument it does not know', async () => {
    const ran = await ranHost(['--wat'])
    expect(ran.code).toBe(2)
    expect(ran.stderr).toContain('unknown argument --wat')
    expect(ran.stdout).toBe('')
  })

  it('listens on a free port when asked, and stops when the process is told to', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'oru-host-cli-'))
    const host = await startedHost(['--port', '0'], {
      ...process.env,
      ORU_JOURNAL: join(scratch, 'journal.db'),
    })
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(host.output()).toContain('listening on')
    await host.stop()
  }, 60_000)
})
