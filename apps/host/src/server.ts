import { createServer, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Effect, Layer, Predicate, Schema, Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { HttpRouter } from 'effect/unstable/http'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import {
  makeHost,
  sessionLogLayer,
  SessionLog,
  type AnyPlugin,
  type BootError,
  type Host,
} from '@oru/kernel'
import type { PluginId } from '@oru/kernel'
import { sqliteJournalLayer, type JournalOpenError } from '@oru/kernel/sqlite'
import { encodeError, fromZigpty, type SpawnFn } from '@oru/pty'
import { spawn as zigptySpawn } from 'zigpty'
import nodeAdapter from 'crossws/adapters/node'
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- SAFETY: makePluginStore is a plain Effect-returning factory like makeHost, not a Context.Tag service constructor; there is no Layer to yield instead.
import { makePluginStore, type PluginStore } from './plugin-store.ts'
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- SAFETY: makePtyStore is a plain function returning the store record (like makePluginStore above), not a Context.Tag service constructor; there is no Layer to yield instead.
import { makePtyStore } from './pty.ts'
import { closePtySession, isPtyUpgrade, openPtySession, routePtyMessage } from './pty.ts'
import type { PtyStore } from './pty.ts'
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
   * The working directory the Personal project points at. The host seeds the
   * singleton on the project paths that name it; absent seeds nothing, which
   * is what a test that asserts an exact project list wants.
   */
  readonly personalCwd?: string | undefined
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
  readonly pty: PtyStore
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
    const rawSpawn: SpawnFn = (cmd, args, spawnOptions) =>
      fromZigpty(
        zigptySpawn(cmd, [...args], {
          cols: spawnOptions.cols,
          rows: spawnOptions.rows,
          cwd: spawnOptions.cwd,
          env: { ...spawnOptions.env },
        }),
      )
    const pty = yield* Effect.map(SessionLog, (log) =>
      makePtyStore(rawSpawn, () => log.entries),
    ).pipe(Effect.provideContext(provided))
    const frameText = (read: () => string): string | undefined => {
      try {
        return read()
      } catch {
        return undefined
      }
    }
    const adapter = nodeAdapter({
      hooks: {
        open: (peer) => {
          openPtySession(
            pty,
            peer.request.url,
            peer.id,
            (data) => {
              try {
                peer.send(data)
              } catch {
                void 0
              }
            },
            () => {
              try {
                peer.close()
              } catch {
                void 0
              }
            },
          )
        },
        message: (peer, message) => {
          const send = (data: string): void => {
            try {
              peer.send(data)
            } catch {
              void 0
            }
          }
          const close = (): void => {
            try {
              peer.close()
            } catch {
              void 0
            }
          }
          const text = frameText(() => message.text())
          if (text === undefined) {
            send(encodeError('unreadable frame'))
            return
          }
          routePtyMessage(pty, peer.request.url, text, send, close)
        },
        close: (peer) => {
          closePtySession(pty, peer.request.url, peer.id)
        },
      },
    })
    const raw = createServer()
    // Exclusive `/pty/*` upgrade dispatch. Effect's NodeHttpServer routes
    // every upgrade through the HTTP app (which 404s it on the same
    // socket, racing crossws's 101), so the host claims pty upgrades here
    // and only passes the rest through. Non-pty upgrades — and Effect's
    // own upgrade listener lifecycle — are untouched.
    const emitUpgrade = raw.emit.bind(raw)
    const emitPtyFirst = (event: string, ...args: Array<unknown>): boolean => {
      if (event === 'upgrade') {
        // SAFETY: Node guarantees upgrade listeners receive (request, socket, head); this wrapper only re-routes them.
        const [req, socket, head] = args as [IncomingMessage, Duplex, Buffer]
        if (isPtyUpgrade(req.url)) {
          void adapter.handleUpgrade(req, socket, head).catch(() => {
            try {
              socket.destroy()
            } catch {
              void 0
            }
          })
          return true
        }
      }
      // SAFETY: every other event forwards to the bound original with identical arguments.
      return (emitUpgrade as (...emitArgs: Array<unknown>) => boolean)(event, ...args)
    }
    // SAFETY: the wrapper accepts (event, ...args) for every overload Node declares; the cast restores emit's static overloads.
    raw.emit = emitPtyFirst as typeof raw.emit
    const httpEffect = yield* HttpRouter.toHttpEffect(
      rpcRoutes(host, store, { personalCwd: options.personalCwd, pty }),
    ).pipe(Effect.provideContext(provided))
    const server = yield* NodeHttpServer.make(() => raw, {
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
      pty,
      url: `http://${hostPart}:${address.port}`,
      hostname,
      port: address.port,
    }
  })
