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

const keyOf = (plugin: string, defId: string): string => `${plugin}/${defId}`

export const registerDef = <Model, Message, Props, Out>(
  plugin: string,
  defId: string,
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
  // SAFETY: the app only ever feeds a def its own models and messages — init's output, update's output, and view dispatches of this same def — so erasing the parameters to the shared opaque shape is sound.
  defs.set(keyOf(plugin, defId), def as LoadedDef)
}

export const getDef = (plugin: string, defId: string): LoadedDef | undefined =>
  defs.get(keyOf(plugin, defId))

export const resetDefsForTest = (): void => {
  defs.clear()
}
