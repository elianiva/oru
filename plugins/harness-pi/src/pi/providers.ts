import { fallbackProviderLabel, type ProviderInfo } from '@oru/harness'

/**
 * The providers pi can sign into, as the model picker shows them.
 *
 * pi reports a provider id per model and nothing else — no display name, no
 * glyph — so the bridge curates both. `icon` is a lowercase Lucide key the
 * app resolves (see `apps/oru/src/lib/provider-icons.ts`); a provider the
 * map does not name keeps its id under a title-cased label and lets the app
 * fall back to its generic glyph. Custom endpoints (`models.json` authors
 * invent ids freely) always take that path, so a new provider renders
 * honestly instead of failing to decode.
 */

// oxlint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: the map is keyed by provider ids pi invents at runtime, so literal evidence cannot type the lookup
const CURATED: Readonly<Record<string, Readonly<{ label: string; icon: string }>>> = {
  anthropic: { label: 'Anthropic', icon: 'brain' },
  azure: { label: 'Azure', icon: 'cloud' },
  bedrock: { label: 'Bedrock', icon: 'mountain' },
  cohere: { label: 'Cohere', icon: 'layers' },
  deepseek: { label: 'DeepSeek', icon: 'waves' },
  fireworks: { label: 'Fireworks', icon: 'sparkles' },
  gemini: { label: 'Gemini', icon: 'sparkle' },
  'github-copilot': { label: 'Muse', icon: 'bot' },
  google: { label: 'Google', icon: 'sparkle' },
  groq: { label: 'Groq', icon: 'gauge' },
  lmstudio: { label: 'LM Studio', icon: 'monitor' },
  mistral: { label: 'Mistral', icon: 'wind' },
  ollama: { label: 'Ollama', icon: 'container' },
  openai: { label: 'OpenAI', icon: 'hexagon' },
  'openai-codex': { label: 'OpenAI Codex', icon: 'code-xml' },
  openrouter: { label: 'OpenRouter', icon: 'network' },
  together: { label: 'Together', icon: 'users' },
  vertex: { label: 'Vertex', icon: 'triangle' },
  xai: { label: 'xAI', icon: 'zap' },
}

/** One provider's tab, curated when known, honest when not. */
export const providerInfoOf = (id: string): ProviderInfo => {
  const known = CURATED[id]
  if (known === undefined) return { id, label: fallbackProviderLabel(id) }
  return { id, label: known.label, icon: known.icon }
}

/** The ids in first-appearance order, each named exactly once. */
export const providerInfosOfIds = (ids: Iterable<string>): ProviderInfo[] => {
  const seen = new Set<string>()
  const infos: ProviderInfo[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    infos.push(providerInfoOf(id))
  }
  return infos
}
