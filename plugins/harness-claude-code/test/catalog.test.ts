import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ClaudeCodeCatalog,
  DEFAULT_CLAUDE_CODE_MODEL,
  hasUsableOauth,
} from '../src/claude/catalog.ts'
import { resolveClaudeCodeLaunch } from '../src/claude/launch.ts'

/**
 * The catalogue and its health, against local probes only.
 *
 * The models are static, so listing them never spawns anything; health is a
 * `claude --version` probe plus credentials, both read locally. The fake
 * `claude` scripts below print a version and exit, so no test spends money or
 * touches the user's own login.
 */

const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const dir = (): string => {
  const created = mkdtempSync(join(tmpdir(), 'oru-claude-catalog-'))
  cleanups.push(created)
  return created
}

/** A fake `claude` that reports one version and exits. */
const fakeClaude = (home: string, version: string): string => {
  const script = join(home, 'claude')
  writeFileSync(script, `#!/bin/sh\necho ${JSON.stringify(version)}\n`, 'utf8')
  chmodSync(script, 0o755)
  return script
}

const catalog = (env: NodeJS.ProcessEnv): ClaudeCodeCatalog =>
  new ClaudeCodeCatalog({ env, launch: resolveClaudeCodeLaunch(env), log: () => undefined })

const envWith = (
  home: string,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv => ({
  PATH: process.env['PATH'] ?? '',
  HOME: home,
  ORU_CLAUDE_SESSION_DIR: join(home, 'sessions'),
  ...extra,
})

describe('Claude launch', () => {
  it('sends extras to the default command when no command is named', () => {
    const launch = resolveClaudeCodeLaunch({ ORU_CLAUDE_ARGS: '["--foo"]' })
    expect(launch).toEqual({ command: 'claude', args: ['--foo'] })
  })

  it('rejects extras that are not a JSON array of strings', () => {
    expect(() => resolveClaudeCodeLaunch({ ORU_CLAUDE_ARGS: 'not json' })).toThrow(
      'ORU_CLAUDE_ARGS must be a JSON array of strings',
    )
    expect(() => resolveClaudeCodeLaunch({ ORU_CLAUDE_ARGS: '{"foo":1}' })).toThrow(
      'ORU_CLAUDE_ARGS must be a JSON array of strings',
    )
  })
})

describe('Claude models', () => {
  it('lists the curated catalogue with exactly one default, and no uncertain fields', async () => {
    const home = dir()
    const models = await catalog(envWith(home)).models()
    expect(models.map((model) => model.id)).toEqual([
      'claude-fable-5-1',
      DEFAULT_CLAUDE_CODE_MODEL,
      'claude-opus-4-8[1m]',
      'claude-opus-4-7[1m]',
      'claude-sonnet-5',
    ])
    for (const model of models) {
      expect(model.provider).toBe('anthropic')
      expect('contextWindow' in model).toBe(false)
      expect('reasoningLevels' in model).toBe(false)
    }
    expect(models.filter((model) => model.isDefault === true).map((model) => model.id)).toEqual([
      DEFAULT_CLAUDE_CODE_MODEL,
    ])
  })

  it('names the one provider behind the catalogue', async () => {
    const home = dir()
    expect(await catalog(envWith(home)).providers()).toEqual([
      { id: 'anthropic', label: 'Anthropic' },
    ])
  })
})

describe('Claude health', () => {
  it('reports a missing CLI instead of failing the thread', async () => {
    const home = dir()
    const health = await catalog(
      envWith(home, { ORU_CLAUDE_COMMAND: join(home, 'no-such-Muse') }),
    ).health()
    expect(health.status).toBe('not_installed')
    expect(health.installCommand).toBe('npm i -g @anthropic-ai/claude-code')
    expect(health.minimumSupportedVersion).toBe('2.0.0')
  })

  it('reports an old CLI as unsupported', async () => {
    const home = dir()
    const command = fakeClaude(home, '1.9.9')
    const health = await catalog(envWith(home, { ORU_CLAUDE_COMMAND: command })).health()
    expect(health.status).toBe('unsupported_version')
    expect(health.installedVersion).toBe('1.9.9')
  })

  it('reports a current CLI without credentials as unauthenticated', async () => {
    const home = dir()
    const command = fakeClaude(home, '2.5.0 (Claude Code)')
    const health = await catalog(envWith(home, { ORU_CLAUDE_COMMAND: command })).health()
    expect(health.status).toBe('unauthenticated')
    expect(health.installedVersion).toBe('2.5.0 (Claude Code)')
  })

  it('is ready with an API key, without touching the disk login', async () => {
    const home = dir()
    const command = fakeClaude(home, '2.5.0')
    const health = await catalog(
      envWith(home, { ORU_CLAUDE_COMMAND: command, ANTHROPIC_API_KEY: 'test-key' }),
    ).health()
    expect(health.status).toBe('ready')
    expect(health.installedVersion).toBe('2.5.0')
  })

  it('is ready with an unexpired OAuth login on disk', async () => {
    const home = dir()
    const command = fakeClaude(home, '2.1.0')
    const credentialsDir = join(home, '.claude')
    mkdirSync(credentialsDir, { recursive: true })
    writeFileSync(
      join(credentialsDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'token',
          expiresAt: Date.now() + 3_600_000,
        },
      }),
      'utf8',
    )
    const health = await catalog(envWith(home, { ORU_CLAUDE_COMMAND: command })).health()
    expect(health.status).toBe('ready')
  })
})

describe('OAuth credentials', () => {
  const oauth = (expiresAt: number | null): string =>
    JSON.stringify({ claudeAiOauth: { accessToken: 'token', expiresAt } })

  it('accepts an unexpired login and one that states no expiry', () => {
    expect(hasUsableOauth(oauth(Date.now() + 3_600_000))).toBe(true)
    expect(hasUsableOauth(oauth(null))).toBe(true)
  })

  it('rejects an expired login, a missing token, and garbage', () => {
    expect(hasUsableOauth(oauth(Date.now() - 1_000))).toBe(false)
    expect(hasUsableOauth(JSON.stringify({ claudeAiOauth: {} }))).toBe(false)
    expect(hasUsableOauth('not json')).toBe(false)
  })
})
