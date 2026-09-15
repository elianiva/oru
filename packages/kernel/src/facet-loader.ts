import { Effect, Option, Schema } from 'effect'
import {
  FacetImportFailed,
  FacetInvalid,
  type ActivationError,
  type FacetLoadError,
} from './errors.ts'
import type { Activation, Host } from './host.ts'
import type { AnyPlugin } from './plugin.ts'
import { BundleAddress, PluginId } from './primitives.ts'

export interface FacetLoader {
  readonly load: (address: BundleAddress) => Effect.Effect<AnyPlugin, FacetLoadError>
  readonly reload: (
    address: BundleAddress,
  ) => Effect.Effect<Activation, FacetLoadError | ActivationError>
}

const FacetId = Schema.Struct({ id: PluginId })
const FacetEnvelope = Schema.Struct({
  default: Schema.optional(FacetId),
  plugin: Schema.optional(FacetId),
})
const decodeFacetId = Schema.decodeUnknownOption(FacetId)
const decodeEnvelope = Schema.decodeUnknownOption(FacetEnvelope)
const decodeAddress = Schema.decodeUnknownOption(BundleAddress)

export const loadFacet = (
  address: string,
  urlOf: (address: BundleAddress) => string,
): Effect.Effect<AnyPlugin, FacetLoadError> => {
  const parsed = decodeAddress(address)
  if (Option.isNone(parsed)) return Effect.fail(new FacetInvalid({ url: address }))
  const url = urlOf(parsed.value)
  return Effect.tryPromise({
    try: () => import(url),
    catch: (cause) => new FacetImportFailed({ url, cause }),
  }).pipe(
    Effect.flatMap((loaded) => {
      if (Option.isSome(decodeFacetId(loaded))) {
        // SAFETY: FacetId decoded id on this module; the live export is the plugin record
        return Effect.succeed(loaded as AnyPlugin)
      }
      const envelope = decodeEnvelope(loaded)
      if (Option.isNone(envelope)) return Effect.fail(new FacetInvalid({ url }))
      // SAFETY: FacetEnvelope decoded default or plugin as a FacetId; keep the live export
      const nested = loaded as { readonly default?: AnyPlugin; readonly plugin?: AnyPlugin }
      if (envelope.value.default !== undefined && nested.default !== undefined) {
        return Effect.succeed(nested.default)
      }
      if (envelope.value.plugin !== undefined && nested.plugin !== undefined) {
        return Effect.succeed(nested.plugin)
      }
      return Effect.fail(new FacetInvalid({ url }))
    }),
  )
}

export const makeFacetLoader = (
  host: Host,
  urlOf: (address: BundleAddress) => string,
): FacetLoader => ({
  load: (address) => loadFacet(address, urlOf),
  reload: (address) =>
    loadFacet(address, urlOf).pipe(Effect.flatMap((plugin) => host.replace(plugin, address))),
})
