import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Option, Schema } from 'effect'
import { HarnessHealth, type Mutable, type ProviderInfo, type ModelInfo } from '@oru/harness'
import {
  isSupportedVersion,
  MINIMUM_CLAUDE_VERSION,
  parseClaudeVersion,
  probeClaudeVersion,
  type ClaudeLaunch,
} from './launch.ts'

/**
 * Muse's catalogue and its health, from local probes only (ADR-0007).
 *
 * The models are a static list curated from bb's provider catalogue: the ids
 * are what the CLI accepts on `--model`, and the one default is what the CLI
 * picks when no model is named. No probe lists them because listing through
 * the CLI would spend a turn. Health is `claude --version` plus credentials,
 * both read locally, so asking never spends money or signs anything in.
 */

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5[1m]'

const INSTALL_COMMAND = 'npm i -g @anthropic-ai/claude-code'

const CLAUDE_MODELS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: DEFAULT_CLAUDE_MODEL, label: 'Opus 5 (1M)' },
  { id: 'claude-opus-4-8[1m]', label: 'Opus 4.8 (1M)' },
  { id: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
]

const CACHE_TTL_MS = 30_000

export interface ClaudeCatalogDeps {
  readonly env: NodeJS.ProcessEnv
  readonly launch: ClaudeLaunch
  readonly log: (message: string) => void
}

const credentialsFileOf = (env: NodeJS.ProcessEnv): string => {
  const home = env['HOME'] ?? homedir()
  return join(home, '.claude', '.credentials.json')
}

const decodeOption = Schema.decodeUnknownOption

const OauthFile = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Schema.NonEmptyString,
    expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
})

/**
 * Whether the OAuth credentials file carries a usable login: an access token
 * whose expiry, when stated, is still in the future. Anything unreadable or
 * expired is unauthenticated, never an error: health reports, it does not fix.
 */
export const hasUsableOauth = (raw: string): boolean => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return false
  }
  const oauth = decodeOption(OauthFile)(parsed)
  if (Option.isNone(oauth)) return false
  const expiresAt = oauth.value.claudeAiOauth.expiresAt
  if (expiresAt === undefined || expiresAt === null) return true
  return Date.now() < expiresAt
}

export class ClaudeCatalog {
  private version: { readonly at: number; readonly raw: string | undefined } | null = null
  private readonly deps: ClaudeCatalogDeps

  constructor(deps: ClaudeCatalogDeps) {
    this.deps = deps
  }

  /** The static catalogue, with exactly one default. */
  async models(): Promise<readonly ModelInfo[]> {
    return CLAUDE_MODELS.map((model): ModelInfo => ({
      id: model.id,
      label: model.label,
      provider: 'anthropic',
      isDefault: model.id === DEFAULT_CLAUDE_MODEL,
    }))
  }

  /** The one provider behind the catalogue, for the picker's tabs. */
  async providers(): Promise<readonly ProviderInfo[]> {
    return [{ id: 'anthropic', label: 'Anthropic' }]
  }

  async health(): Promise<HarnessHealth> {
    const base = {
      minimumSupportedVersion: MINIMUM_CLAUDE_VERSION,
      installCommand: INSTALL_COMMAND,
    }
    const version = await this.installedVersion()
    if (version === undefined || version === '') {
      return HarnessHealth.make({
        ...base,
        status: 'not_installed',
        message: 'Muse is not on PATH',
      })
    }
    const parsed = parseClaudeVersion(version)
    if (parsed === undefined) {
      return HarnessHealth.make({
        ...base,
        status: 'unknown',
        message: `Muse reported an unrecognized version: ${version}`,
        installedVersion: version,
      })
    }
    if (!isSupportedVersion(parsed)) {
      return HarnessHealth.make({
        ...base,
        status: 'unsupported_version',
        message: `Muse ${parsed.raw} is older than ${MINIMUM_CLAUDE_VERSION}`,
        installedVersion: parsed.raw,
      })
    }
    const health: Mutable<HarnessHealth> = {
      ...base,
      status: 'ready',
      installedVersion: parsed.raw,
    }
    if (this.authenticated()) return HarnessHealth.make(health)
    return HarnessHealth.make({
      ...base,
      status: 'unauthenticated',
      message: 'Muse has no credentials; sign in with `Muse` before oru can run a turn',
      installedVersion: parsed.raw,
    })
  }

  invalidate(): void {
    this.version = null
  }

  private async installedVersion(): Promise<string | undefined> {
    const now = Date.now()
    if (this.version !== null && now - this.version.at < CACHE_TTL_MS) return this.version.raw
    const raw = probeClaudeVersion(this.deps.launch, this.deps.env)
    this.version = { at: now, raw }
    return raw
  }

  /** An API key in the environment, or an unexpired OAuth login on disk. */
  private authenticated(): boolean {
    const key = this.deps.env['ANTHROPIC_API_KEY']
    if (key !== undefined && key !== '') return true
    try {
      return hasUsableOauth(readFileSync(credentialsFileOf(this.deps.env), 'utf8'))
    } catch {
      return false
    }
  }
}
