import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Command, defaultHost, defaultPort, packageVersion, parseArgs } from '../src/index.ts'
import { ranHost, startedHost } from './spawn-host.ts'

const scratchHome = () => mkdtempSync(join(tmpdir(), 'oru-host-cli-'))

describe('parseArgs', () => {
  it('serves with no flags filled in, so defaults come from resolve', () => {
    expect(parseArgs([])).toEqual(Command.Serve({}))
  })

  it('takes a home, a host, a port, and a journal, including a port of zero', () => {
    expect(
      parseArgs([
        '--home',
        '/tmp/oru',
        '--host',
        '0.0.0.0',
        '--port',
        '0',
        '--journal',
        '/tmp/j.db',
      ]),
    ).toEqual(
      Command.Serve({
        home: '/tmp/oru',
        hostname: '0.0.0.0',
        port: 0,
        journal: '/tmp/j.db',
      }),
    )
  })

  it('parses config list, set, and unset', () => {
    expect(parseArgs(['config', 'list'])).toEqual(Command.ConfigList({}))
    expect(parseArgs(['--home', '/tmp/oru', 'config', 'set', 'host', '0.0.0.0'])).toEqual(
      Command.ConfigSet({ home: '/tmp/oru', key: 'host', value: '0.0.0.0' }),
    )
    expect(parseArgs(['config', 'unset', 'host'])).toEqual(Command.ConfigUnset({ key: 'host' }))
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
    expect(parseArgs(['--home'])).toEqual(Command.Invalid({ message: '--home needs a value' }))
    expect(parseArgs(['--port', 'seventy'])).toEqual(
      Command.Invalid({ message: '--port takes a port number, got seventy' }),
    )
    expect(parseArgs(['--port', '70000'])).toEqual(
      Command.Invalid({ message: '--port takes a port number, got 70000' }),
    )
    expect(parseArgs(['config'])).toEqual(
      Command.Invalid({ message: 'config needs list, set, or unset' }),
    )
  })
})

describe('the host binary', () => {
  it('prints its usage and exits zero for --help', async () => {
    const ran = await ranHost(['--help'])
    expect(ran.code).toBe(0)
    expect(ran.stdout).toContain('Usage:')
    expect(ran.stdout).toContain('--port')
    expect(ran.stdout).toContain('config list')
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
    const home = scratchHome()
    const host = await startedHost(['--port', '0'], {
      ...process.env,
      ORU_HOME: home,
    })
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(host.output()).toContain('listening on')
    expect(statSync(join(home, 'config.json')).mode & 0o777).toBe(0o600)
    await host.stop()
  }, 60_000)

  it('lists resolved settings from a private home', async () => {
    const home = scratchHome()
    const ran = await ranHost(['config', 'list'], { ...process.env, ORU_HOME: home })
    expect(ran.code).toBe(0)
    expect(ran.stdout).toContain(`home=${home} source=env lifetime=startup`)
    expect(ran.stdout).toContain(`host=${defaultHost} source=default lifetime=startup`)
    expect(ran.stdout).toContain(`port=${String(defaultPort)} source=default lifetime=startup`)
    expect(ran.stdout).toContain(
      `journal=${join(home, 'data', 'oru.db')} source=default lifetime=startup`,
    )
  })

  it('writes host through config set and reads it back as file', async () => {
    const home = scratchHome()
    const env = { ...process.env, ORU_HOME: home }
    const set = await ranHost(['config', 'set', 'host', '0.0.0.0'], env)
    expect(set.code).toBe(0)
    expect(set.stdout).toContain('startup-only')
    const listed = await ranHost(['config', 'list'], env)
    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain('host=0.0.0.0 source=file lifetime=startup')
    const unset = await ranHost(['config', 'unset', 'host'], env)
    expect(unset.code).toBe(0)
    const again = await ranHost(['config', 'list'], env)
    expect(again.stdout).toContain(`host=${defaultHost} source=default lifetime=startup`)
  })
})
