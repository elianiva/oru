import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  ensureLayout,
  listLines,
  parseFileConfig,
  piEnvOf,
  resolveSettings,
  setFileKey,
  unsetFileKey,
} from '../src/config.ts'

const scratch = () => mkdtempSync(join(tmpdir(), 'oru-config-'))
const osHome = '/Users/someone'
const home = join(osHome, '.oru')

describe('resolveSettings', () => {
  it('defaults the listen address to 127.0.0.1', () => {
    const settings = resolveSettings({}, {}, {}, osHome)
    expect(settings.hostname).toEqual({ value: '127.0.0.1', source: 'default' })
    expect(settings.port).toEqual({ value: 7317, source: 'default' })
    expect(settings.home).toEqual({ value: home, source: 'default' })
    expect(settings.journal).toEqual({
      value: join(home, 'data', 'oru.db'),
      source: 'default',
    })
    expect(settings.dataDir).toBe(join(home, 'data'))
    expect(settings.piHome.value).toBe(join(home, 'data', 'pi'))
    expect(settings.piSessionDir.value).toBe(join(home, 'data', 'pi', 'sessions'))
    expect(settings.piCommand).toEqual({ value: undefined, source: 'default' })
  })

  it('lets a flag win', () => {
    const settings = resolveSettings(
      { hostname: 'flag.example', port: 1, journal: '/flag.db', home: '/flag-home' },
      {},
      {},
      osHome,
    )
    expect(settings.home).toEqual({ value: '/flag-home', source: 'flag' })
    expect(settings.hostname).toEqual({ value: 'flag.example', source: 'flag' })
    expect(settings.port).toEqual({ value: 1, source: 'flag' })
    expect(settings.journal).toEqual({ value: '/flag.db', source: 'flag' })
  })

  it('lets the file win over the environment', () => {
    const settings = resolveSettings(
      {},
      { ORU_HOST: 'env.example', ORU_PORT: '2', ORU_JOURNAL: '/env.db' },
      { host: 'file.example', port: 3, journal: '/file.db' },
      osHome,
    )
    expect(settings.hostname).toEqual({ value: 'file.example', source: 'file' })
    expect(settings.port).toEqual({ value: 3, source: 'file' })
    expect(settings.journal).toEqual({ value: '/file.db', source: 'file' })
  })

  it('lets the environment win over the default', () => {
    const settings = resolveSettings(
      {},
      { ORU_HOME: '/env-home', ORU_HOST: '0.0.0.0', ORU_PORT: '9', ORU_JOURNAL: '/env.db' },
      {},
      osHome,
    )
    expect(settings.home).toEqual({ value: '/env-home', source: 'env' })
    expect(settings.hostname).toEqual({ value: '0.0.0.0', source: 'env' })
    expect(settings.port).toEqual({ value: 9, source: 'env' })
    expect(settings.journal).toEqual({ value: '/env.db', source: 'env' })
  })

  it('lets a flag beat stacked file, environment, and default', () => {
    const settings = resolveSettings(
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
    expect(settings.home).toEqual({ value: '/flag-home', source: 'flag' })
    expect(settings.hostname).toEqual({ value: 'flag.example', source: 'flag' })
    expect(settings.port).toEqual({ value: 1, source: 'flag' })
    expect(settings.journal).toEqual({ value: '/flag.db', source: 'flag' })
  })

  it('rejects an unknown key in the file', () => {
    expect(() => parseFileConfig('{"token":"secret"}')).toThrow(ConfigError)
    expect(() => parseFileConfig('{"token":"secret"}')).toThrow('unknown key token')
  })

  it('rejects a file port that is not 0..65535', () => {
    expect(() => parseFileConfig('{"port":70000}')).toThrow(ConfigError)
    expect(() => parseFileConfig('{"port":1.5}')).toThrow(ConfigError)
  })

  it('creates config.json with mode 0600', () => {
    const dir = scratch()
    ensureLayout(dir)
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600)
  })

  it('records set as source=file and unset as the default', () => {
    const written = setFileKey({}, 'host', '0.0.0.0')
    const settings = resolveSettings({}, {}, written, osHome)
    expect(settings.hostname).toEqual({ value: '0.0.0.0', source: 'file' })
    expect(listLines(settings).find((line) => line.startsWith('host='))).toBe(
      'host=0.0.0.0 source=file lifetime=startup',
    )
    const cleared = resolveSettings({}, {}, unsetFileKey(written, 'host'), osHome)
    expect(cleared.hostname).toEqual({ value: '127.0.0.1', source: 'default' })
  })

  it('widens the listen address only when host is set', () => {
    expect(resolveSettings({}, {}, {}, osHome).hostname.value).toBe('127.0.0.1')
    expect(resolveSettings({ hostname: '0.0.0.0' }, {}, {}, osHome).hostname.value).toBe('0.0.0.0')
    expect(resolveSettings({}, { ORU_HOST: '0.0.0.0' }, {}, osHome).hostname.value).toBe('0.0.0.0')
    expect(resolveSettings({}, {}, { host: '0.0.0.0' }, osHome).hostname.value).toBe('0.0.0.0')
  })

  it('puts winning pi paths into the env bag and leaves unset command off it', () => {
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

    const fromPiHome = resolveSettings({}, {}, { pi: { home: '/custom/pi' } }, osHome)
    expect(fromPiHome.piHome.value).toBe('/custom/pi')
    expect(fromPiHome.piSessionDir).toEqual({
      value: '/custom/pi/sessions',
      source: 'default',
    })

    const unset = piEnvOf(
      { PATH: '/bin', ORU_PI_COMMAND: 'ambient' },
      resolveSettings({}, {}, {}, osHome),
    )
    expect(unset.ORU_PI_COMMAND).toBeUndefined()
  })
})
