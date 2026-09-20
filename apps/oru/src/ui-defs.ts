import type { LoadedDef, UiSignal } from '@oru/ui'

/**
 * The loaded definitions, outside the Foldkit model the way bb keeps its
 * flattened slot store beside the snapshot. Root's model holds outlet keys
 * (plugin, definition, address, child model); the functions live here, so
 * the model stays plain data and a fresh bundle generation replaces code
 * without migrating state by hand. Tests register stub defs directly,
 * which is also the core-replacement proof: any def can fill a slot.
 */
const defs = new Map<string, LoadedDef>()

/** A def is only usable for the generation it was imported from: same code, new address, refetch. */
const keyOf = (plugin: string, defId: string, address: string): string =>
  `${plugin}/${defId}/${address}`

export const registerDef = <Model, Message, Props, Out>(
  plugin: string,
  defId: string,
  address: string,
  def: {
    readonly init: () => Model
    readonly update: (
      model: Model,
      message: Message,
    ) => {
      readonly model: Model
      readonly outMessage?: Out
    }
    readonly view: unknown
    readonly absorb?: ((model: Model, props: Props) => Model) | undefined
    readonly signal?: ((model: Model, signal: UiSignal) => Model) | undefined
  },
): void => {
  // Superseded generations under the same plugin/defId are dropped: no outlet
  // can hold them anymore (reconcile moves the slot to the new generation first),
  // so the map stays one entry per slot instead of growing per reload.
  for (const key of [...defs.keys()]) {
    if (key.startsWith(`${plugin}/${defId}/`) && key !== keyOf(plugin, defId, address)) {
      defs.delete(key)
    }
  }
  // SAFETY: the app only ever feeds a def its own models and messages — init's output, update's output, and view dispatches of this same def — so erasing the parameters to the shared opaque shape is sound.
  defs.set(keyOf(plugin, defId, address), def as LoadedDef)
}

export const getDef = (plugin: string, defId: string, address: string): LoadedDef | undefined =>
  defs.get(keyOf(plugin, defId, address))

export const resetDefsForTest = (): void => {
  defs.clear()
}
