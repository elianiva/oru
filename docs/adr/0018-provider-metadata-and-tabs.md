# Harness plugins name their providers, and the picker tabs by them

`HarnessMeta` carried an `icon` no one read, and the catalogue named providers
only inside each model id. The picker grouped by that raw string, so a second
provider rendered as another heading and the harness itself as bare text. The
plugin knew what it offered; the app could not show it.

## Decision

**A harness names its providers as metadata.** `ProviderInfo` (`id`, `label`,
`icon`) joins `@oru/harness`, and `HarnessService` gains an optional
`providers()` beside `listModels()`. `icon` is a lowercase Lucide key on both
`ProviderInfo` and `HarnessMeta`: a key, never a component, because it crosses
the RPC seam as JSON and the app resolves it, falling back to a generic glyph
for a key it does not know. `ThreadOptions` gains `providers` and
`HarnessChoice` gains `icon`; the host fills both, defaulting to empty and
absent when a harness names nothing. `harness-pi` curates the providers pi can
sign into (`plugins/harness-pi/src/pi/providers.ts`) and reports the ones
behind its probe; `harness-oru` reports its three. Unknown ids — a custom
`models.json` invents them freely — render under a title-cased label
(`fallbackProviderLabel`) with the generic glyph, so a new provider is honest
rather than invisible.

**The picker tabs by provider.** The panel shows one icon tab per provider
above the search, through a presentational `tabs` component
(`apps/oru/src/components/ui/tabs.ts`); behaviour stays in the picker's
submodel the way `picker-panel.ts` holds geometry. Selecting a tab filters the
catalogue to that provider, selecting it again returns to every provider, and
the search narrows within the tab. A tabbed catalogue renders its rows flat —
the group header would repeat the tab — while every provider keeps its header,
now wearing the provider's glyph. One provider needs no tabs. The tab
survives a reload while its provider is still offered and falls back to every
provider when it is not. The harness fact wears the harness's glyph, and the
composer trigger wears the chosen model's provider glyph.

## Considered options

- **The `@foldkit/ui` Tabs submodel**: full roving-tabindex behaviour, but a
  child submodel with its own messages and commands for a single-selection
  filter the picker already owns. Rejected; the presentational tabs match how
  the reasoning segmented control and `picker-panel.ts` already work.
- **A text All tab beside the icons**: explicit, but the reference picker is
  icons-only and toggling the active tab says the same thing with one less
  control. Rejected; tabs toggle.
- **Brand SVGs per provider**: accurate glyphs, but binary art in harness
  metadata, a seam that carries JSON, and a map that rots with every provider
  rebrand. Rejected; Lucide approximations behind the same icon-key contract,
  so real art can arrive later without changing the seam.
- **`Schema.optionalKey` with an explicit `undefined` on new message fields**:
  rejected the way ADR-0016 rejects it; the provider tab rides
  `Schema.UndefinedOr`, where absent and `undefined` already read the same.

## Consequences

- Adding a provider is a curated map entry in the harness that signs into it;
  the tabs, the headers, the trigger glyph, and the fallback all follow with
  no app change.
- `ThreadOptions` decodes `providers` with an empty default, so a host
  predating provider metadata still answers the picker instead of failing it
  (`Missing key at ["value"]["providers"]` on first open); the host always
  encodes the key, so the seam stays exact going forward. Every fixture that
  builds one names it; the browser suite asserts a single-provider catalogue
  renders no tabs row.
- The picker's `Model` gains `activeProvider`, preserved across reloads while
  offered; a provider that signs out resets the tab rather than showing an
  empty catalogue. The tab and the chosen model with its reasoning level are
  also mirrored to a versioned `oru.model-picker` document in `localStorage`
  (bb's promptbox-preference pattern: sanitized on read, never overwriting a
  newer writer), restored by `init` and kept by `OptionsArrived` while the
  host names no thread choice, so a page refresh lands on the last choice
  rather than no choice. The host stays the source of truth: a thread that
  names a choice overwrites the stored one.
