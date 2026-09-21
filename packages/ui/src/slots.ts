import { Effect, Schema } from 'effect'
import { defineContributionKind, type PluginContext, type PluginId } from '@oru/kernel'

/**
 * The UI SDK major the host and the app agree on. A bundle built against
 * another major is skipped with a note, the way the server facet loader
 * runs without a source it cannot load.
 */
export const UI_SDK_MAJOR = 1

/**
 * The v1 slot inventory (ADR-0020). `composer` and `conversation` are
 * exclusive: one submodel owns the surface. The `composer*` chip slots and
 * `panel` are additive: every contribution renders in deterministic order.
 * The thread list stays host-owned; the right panel tab strip is host-owned
 * while panel tabs are plugin submodels (terminal-ghostty first).
 */
export const SlotId = Schema.Literals([
  'composer',
  'conversation',
  'composerLeading',
  'composerChipsLeft',
  'composerChipsRight',
  'panel',
])
export type SlotId = typeof SlotId.Type

export const EXCLUSIVE_SLOTS: readonly SlotId[] = ['composer', 'conversation']

export const isExclusiveSlot = (slot: SlotId): boolean => EXCLUSIVE_SLOTS.includes(slot)

/**
 * What a presentation facet contributes under `UiKind`: which slot it fills
 * and which definition it names. The bundle that carries the code is joined
 * later by address, so the declaration stays portable across generations.
 */
export const UiDef = Schema.Struct({
  slot: SlotId,
  defId: Schema.NonEmptyString,
  title: Schema.optional(Schema.String),
})
export type UiDef = typeof UiDef.Type

export const UiKind = defineContributionKind<UiDef>('oru/ui-submodel')

/**
 * Claim a slot from inside `apply`: the effect-disposed successor to the old
 * static `provides`. Deactivating the plugin reverses the claim, so the
 * snapshot drops its defs the way services vanish from the graph.
 */
export const slot = (ctx: PluginContext, def: UiDef): Effect.Effect<void> =>
  ctx.contribute(UiKind.of(def))

export interface UiClaim {
  readonly plugin: PluginId
  readonly def: UiDef
}

export interface UiAssignment {
  readonly slot: SlotId
  readonly plugin: PluginId
  readonly defId: string
}

const refOf = (plugin: PluginId, defId: string): string => `${plugin}/${defId}`

/**
 * Resolve every claim to its rendered assignment. Claims sort by plugin then
 * definition, so the order is deterministic across hosts. An exclusive slot
 * renders its override when the override names a claim, otherwise its first
 * claim; a second claim for one is a programmer error, so it warns loud and
 * keeps the first (backend `DuplicateProvider` spirit, full user-pinning
 * resolution is the recorded follow-up). Additive slots render every claim
 * in order.
 */
export const resolveUiAssignments = (
  claims: readonly UiClaim[],
  overrides: Readonly<{ composer?: string | undefined; conversation?: string | undefined }>,
  warn: (message: string) => void = () => {},
): readonly UiAssignment[] => {
  const ordered = [...claims].sort(
    (left, right) =>
      left.plugin.localeCompare(right.plugin) || left.def.defId.localeCompare(right.def.defId),
  )
  const bySlot = new Map<SlotId, UiClaim[]>()
  for (const claim of ordered) {
    const group = bySlot.get(claim.def.slot)
    if (group === undefined) bySlot.set(claim.def.slot, [claim])
    else group.push(claim)
  }
  const assignments: UiAssignment[] = []
  for (const [slot, group] of bySlot) {
    if (!isExclusiveSlot(slot)) {
      for (const claim of group) {
        assignments.push({ slot, plugin: claim.plugin, defId: claim.def.defId })
      }
      continue
    }
    const override = slot === 'composer' ? overrides.composer : overrides.conversation
    if (override !== undefined) {
      const pinned = group.find((claim) => refOf(claim.plugin, claim.def.defId) === override)
      if (pinned !== undefined) {
        assignments.push({ slot, plugin: pinned.plugin, defId: pinned.def.defId })
        continue
      }
      warn(`oru ui: override ${override} names no ${slot} claim, using the first claim`)
    }
    const first = group[0]
    if (first === undefined) continue
    if (group.length > 1) {
      warn(
        `oru ui: ${group.length} plugins claim exclusive slot ${slot} (${group.map((claim) => refOf(claim.plugin, claim.def.defId)).join(', ')}), rendering ${refOf(first.plugin, first.def.defId)}`,
      )
    }
    assignments.push({ slot, plugin: first.plugin, defId: first.def.defId })
  }
  return assignments.sort(
    (left, right) =>
      left.slot.localeCompare(right.slot) ||
      left.plugin.localeCompare(right.plugin) ||
      left.defId.localeCompare(right.defId),
  )
}
