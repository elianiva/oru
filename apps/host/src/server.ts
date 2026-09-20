import { createServer } from 'node:http'
import { Effect, Layer, Predicate, Schema, Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { HttpRouter } from 'effect/unstable/http'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { makeHost, sessionLogLayer, type AnyPlugin, type BootError, type Host } from '@oru/kernel'
import type { PluginId } from '@oru/kernel'
import { sqliteJournalLayer, type JournalOpenError } from '@oru/kernel/sqlite'
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- SAFETY: makePluginStore is a plain Effect-returning factory like makeHost, not a Context.Tag service constructor; there is no Layer to yield instead.
import { makePluginStore, type PluginStore } from './plugin-store.ts'
import { rpcRoutes } from './routes.ts'
import type { UiOverrides } from './ui.ts'

class NotTcpAddress extends Schema.TaggedError<NotTcpAddress>()('NotTcpAddress', {
  address: Schema.String,
}) {}

export interface HostOptions {
  readonly plugins: readonly AnyPlugin[]
  /** Per-plugin config data, keyed by plugin id and decoded against each def's `Config`. */
  readonly configs?: ReadonlyMap<PluginId, unknown> | undefined
  readonly hostname: string
  /** 0 asks the operating system for a free port, which is what a test wants. */
  readonly port: number
  /**
   * The journal file to keep facts in, so they outlive the process. Absent
   * keeps them in memory, which is what a test that starts and stops a host
   * wants.
   */
  readonly journal?: string
  /**
   * The presentation facets to bundle and serve. Absent serves an empty UI
   * snapshot, which is what a test that never touches the view wants.
   */
  readonly ui?: {
    readonly sources: readonly { readonly specifier: string }[]
    readonly overrides?: UiOverrides
    /**
     * The prebuilt facet store to read UI bytes from. Absent resolves
     * `dist/facets` beside the host package, which is what a built or
     * packed host wants; a test stages its own packed layout here.
     */
    readonly facetsDir?: string
  }
}

/** A host that is serving. Releasing the scope stops it. */
export interface RunningHost {
  readonly host: Host
  readonly store: PluginStore
  readonly url: string
  readonly hostname: string
  readonly port: number
}

/**
 * Assemble a kernel and serve its RPC boundary.
 *
 * A caller that names a journal file gets a host whose facts outlive it: the
 * file is opened at startup, so a second host against the same file rebuilds
 * the plugin graph from what the first one wrote and resumes the lanes it left
 * with work (ADR-0010).
 */
export const serveHost = (
  options: HostOptions,
): Effect.Effect<RunningHost, BootError | ServeError | JournalOpenError, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const record: Layer.Layer<EventJournal.EventJournal, JournalOpenError> =
      options.journal === undefined ? EventJournal.layerMemory : sqliteJournalLayer(options.journal)
    // The journal belongs to the caller's scope, not to this function's. A
    // `provide` here would release it as soon as the host is assembled, which a
    // memory journal survives and a file one does not.
    const provided = yield* Layer.buildWithScope(
      sessionLogLayer.pipe(Layer.provideMerge(record)),
      scope,
    )
    const host = yield* makeHost(options.plugins, options.configs).pipe(
      Effect.provideContext(provided),
    )
    const store = yield* makePluginStore({
      host,
      plugins: options.plugins,
      sources: options.ui?.sources ?? [],
      facetsRoot: options.ui?.facetsDir,
      overrides: options.ui?.overrides ?? {},
    })
    const httpEffect = yield* HttpRouter.toHttpEffect(rpcRoutes(host, store)).pipe(
      Effect.provideContext(provided),
    )
    const server = yield* NodeHttpServer.make(() => createServer(), {
      host: options.hostname,
      port: options.port,
    })
    yield* server.serve(httpEffect).pipe(Effect.forkScoped)

    const address = server.address
    if (Predicate.isTagged(address, 'UnixPathAddress')) {
      return yield* Effect.fail(
        new ServeError({ cause: new NotTcpAddress({ address: address._tag }) }),
      )
    }
    const hostname = address.address.toString()
    const hostPart = Predicate.isTagged(address, 'InetAddressV6') ? `[${hostname}]` : hostname
    return {
      host,
      store,
      url: `http://${hostPart}:${address.port}`,
      hostname,
      port: address.port,
    }
  })
