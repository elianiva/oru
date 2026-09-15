import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  defaultHost,
  defaultJournalOf,
  defaultPiHomeOf,
  defaultPiSessionDirOf,
  defaultPort,
  ensureLayout,
  listLines,
  parseFileConfig,
  piEnvOf,
  resolveSettings,
  setFileKey,
  unsetFileKey,
} from '../src/config.ts'

const scratch = () => mkdtempSync(join(tmpdir(), 'oru-config-'))

describe('resolveSettings', () => {
  const osHome = '/Users/someone'

  it('defaults to loopback, port 7317, and a journal under the data directory', () => {
    const settings = resolveSettings({}, {}, {}, osHome)
    expect(settings.home.value).toBe(join(osHome, '.oru'))
    expect(settings.home.source).toBe('default')
    expect(settings.hostname).toEqual({ value: defaultHost, source: 'default' })
    expect(settings.port).toEqual({ value: defaultPort, source: 'default' })
    expect(settings.journal.value).toBe(defaultJournalOf(join(osHome, '.oru')))
    expect(settings.journal.source).toBe('default')
    expect(settings.dataDir).toBe(join(osHome, '.oru', 'data'))
    expect(settings.piHome.value).toBe(defaultPiHomeOf(join(osHome, '.oru')))
    expect(settings.piSessionDir.value).toBe(
      defaultPiSessionDirOf(defaultPiHomeOf(join(osHome, '.oru'))),
    )
  })

  it('lets a flag beat the file, the file beat the environment, and the environment beat the default', () => {
    const stacked = resolveSettings(
      { hostname: 'flag.example', port: 1, journal: '/flag.db', home: '/flag-home' },
      {
        ORU_HOME: '/env-home',
        ORU_HOST: 'env.example',
        ORU_PORT: '2',
        ORU_JOURNAL: '/env.db',
      },
      { host: 'file.example', port: 3, journal: '/file.db' },
      osHome,
    )
    expect(stacked.home).toEqual({ value: '/flag-home', source: 'flag' })
    expect(stacked.hostname).toEqual({ value: 'flag.example', source: 'flag' })
    expect(stacked.port).toEqual({ value: 1, source: 'flag' })
    expect(stacked.journal).toEqual({ value: '/flag.db', source: 'flag' })

    const fromFile = resolveSettings(
      {},
      { ORU_HOST: 'env.example', ORU_PORT: '2', ORU_JOURNAL: '/env.db' },
      { host: 'file.example', port: 3, journal: '/file.db' },
      osHome,
    )
    expect(fromFile.hostname).toEqual({ value: 'file.example', source: 'file' })
    expect(fromFile.port).toEqual({ value: 3, source: 'file' })
    expect(fromFile.journal).toEqual({ value: '/file.db', source: 'file' })

    const fromEnv = resolveSettings(
      {},
      { ORU_HOME: '/env-home', ORU_HOST: '0.0.0.0', ORU_PORT: '9', ORU_JOURNAL: '/env.db' },
      {},
      osHome,
    )
    expect(fromEnv.home).toEqual({ value: '/env-home', source: 'env' })
    expect(fromEnv.hostname).toEqual({ value: '0.0.0.0', source: 'env' })
    expect(fromEnv.port).toEqual({ value: 9, source: 'env' })
    expect(fromEnv.journal).toEqual({ value: '/env.db', source: 'env' })
  })

  it('rejects an unknown key in the file', () => {
    expect(() => parseFileConfig('{"token":"secret"}')).toThrow(ConfigError)
    expect(() => parseFileConfig('{"token":"secret"}')).toThrow('unknown key token')
  })

  it('creates config.json with mode 0600', () => {
    const home = scratch()
    ensureLayout(home)
    expect(statSync(join(home, 'config.json')).mode & 0o777).toBe(0o600)
  })

  it('records set and unset against the file layer', () => {
    const home = join(osHome, '.oru')
    const written = setFileKey({}, 'host', '0.0.0.0')
    const settings = resolveSettings({}, {}, written, osHome)
    expect(settings.hostname).toEqual({ value: '0.0.0.0', source: 'file' })
    expect(listLines(settings).find((line) => line.startsWith('host='))).toBe(
      'host=0.0.0.0 source=file lifetime=startup',
    )
    const cleared = resolveSettings({}, {}, unsetFileKey(written, 'host'), osHome)
    expect(cleared.hostname).toEqual({ value: defaultHost, source: 'default' })
    expect(cleared.home.value).toBe(home)
  })

  it('puts winning pi paths into the env bag the bridge reads', () => {
    const settings = resolveSettings(
      { home: '/srv/oru' },
      { ORU_PI_COMMAND: 'from-env' },
      { pi: { command: 'from-file' } },
      osHome,
    )
    const env = piEnvOf({ ORU_PI_E2E_MODEL: 'keep-me', PATH: '/bin' }, settings)
    expect(env.ORU_PI_HOME).toBe('/srv/oru/data/pi')
    expect(env.ORU_PI_SESSION_DIR).toBe('/srv/oru/data/pi/sessions')
    expect(env.ORU_PI_COMMAND).toBe('from-file')
    expect(env.ORU_PI_E2E_MODEL).toBe('keep-me')
  })
})
