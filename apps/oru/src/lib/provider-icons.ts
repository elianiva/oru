import type { IconNode } from 'lucide'
import { fallbackProviderLabel, type ModelInfo, type ProviderInfo } from '@oru/harness'
import { fallbackIcon, resolveIcon } from './icons.ts'

/**
 * What the model picker shows per provider: a label and a glyph.
 *
 * The harness's reported metadata wins — it knows its providers — and the
 * app's own map covers harnesses that name providers only inside their
 * models. Anything else renders under a title-cased label with the generic
 * glyph, so an unknown provider is honest rather than invisible.
 */

export type ProviderDisplay = Readonly<{
  id: string
  label: string
  icon: IconNode
}>

/** Icon keys for providers no harness metadata names, mirroring the harness maps. */
// oxlint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: the map is keyed by provider ids harnesses invent at runtime, so literal evidence cannot type the lookup
const FALLBACK_ICON_KEYS: Readonly<Record<string, string>> = {
  anthropic: 'brain',
  azure: 'cloud',
  bedrock: 'mountain',
  cohere: 'layers',
  deepseek: 'waves',
  fireworks: 'sparkles',
  gemini: 'sparkle',
  'github-copilot': 'bot',
  google: 'sparkle',
  groq: 'gauge',
  lmstudio: 'monitor',
  mistral: 'wind',
  mock: 'flask-conical',
  ollama: 'container',
  openai: 'hexagon',
  'openai-codex': 'code-xml',
  openrouter: 'network',
  scripted: 'flask-conical',
  together: 'users',
  vertex: 'triangle',
  xai: 'zap',
}

/** One provider's tab, from reported metadata or the app's fallback. */
export const providerDisplayOf = (
  providers: ReadonlyArray<ProviderInfo>,
  id: string,
): ProviderDisplay => {
  const reported = providers.find((provider) => provider.id === id)
  const key = reported?.icon ?? FALLBACK_ICON_KEYS[id]
  return {
    id,
    label: reported?.label ?? fallbackProviderLabel(id),
    icon: resolveIcon(key) ?? fallbackIcon,
  }
}

/**
 * The picker's provider tabs in catalogue order: every provider behind the
 * models, each named once. The metadata rides along for labels and glyphs,
 * but the catalogue decides the order and the membership.
 */
export const providerTabsOf = (
  models: ReadonlyArray<ModelInfo>,
  providers: ReadonlyArray<ProviderInfo>,
): ReadonlyArray<ProviderDisplay> => {
  const seen = new Set<string>()
  const tabs: Array<ProviderDisplay> = []
  for (const model of models) {
    const id = model.provider ?? 'unknown'
    if (seen.has(id)) continue
    seen.add(id)
    tabs.push(providerDisplayOf(providers, id))
  }
  return tabs
}
