import { Effect, Layer, Option, Predicate, Schema } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { RpcServer } from 'effect/unstable/rpc'
import type { Host } from '@oru/kernel'
import {
  HostRpc,
  ProjectRpc,
  ThreadRpc,
  UiRpc,
  hostRpcPath,
  projectRpcPath,
  rpcSerializationLayer,
  threadRpcPath,
  uiRpcPath,
} from '@oru/rpc'
import { hostRpcHandlers } from './handlers/host.ts'
import { projectRpcHandlers } from './handlers/project.ts'
import { threadRpcHandlers } from './handlers/thread.ts'
import { uiRpcHandlers } from './handlers/ui.ts'
import type { PluginStore } from './plugin-store.ts'
import type { PtyStore } from './pty.ts'

export const rpcRoutes = (
  host: Host,
  store: PluginStore,
  options?: { readonly personalCwd?: string | undefined; readonly pty?: PtyStore | undefined },
) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: HostRpc, path: hostRpcPath, protocol: 'http' }).pipe(
      Layer.provide(HostRpc.toLayer(hostRpcHandlers(host, store))),
    ),
    RpcServer.layerHttp({ group: ProjectRpc, path: projectRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ProjectRpc.toLayer(projectRpcHandlers(host, options))),
    ),
    RpcServer.layerHttp({ group: ThreadRpc, path: threadRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
    ),
    RpcServer.layerHttp({ group: UiRpc, path: uiRpcPath, protocol: 'http' }).pipe(
      Layer.provide(UiRpc.toLayer(uiRpcHandlers(host, store))),
    ),
    uiBundleRoutes(store),
    ptyRoutes(options?.pty),
  ).pipe(Layer.provide(rpcSerializationLayer))

/**
 * Reusable PTY sessions (`POST /pty`, `GET /pty`, `DELETE /pty/:id`).
 * `POST` resolves the cwd from `projectId` via the session log and
 * rejects unknown projects; the client never supplies `cwd`. WS lives on
 * the same origin at `/pty/:sessionId` (upgrade, attached in `server.ts`).
 */
const PtyCreateInput = Schema.Struct({
  projectId: Schema.optional(Schema.String),
  cols: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
})
const decodePtyCreateInput = Schema.decodeUnknownOption(PtyCreateInput)

const PtyCreated = Schema.TaggedStruct('PtyCreated', { session: Schema.Any })
const PtyFailed = Schema.TaggedStruct('PtyFailed', { error: Schema.Unknown })
export const ptyRoutes = (pty: PtyStore | undefined) =>
  pty === undefined
    ? HttpRouter.addAll([])
    : HttpRouter.addAll([
        HttpRouter.route(
          'GET',
          '/pty',
          Effect.gen(function* () {
            return yield* HttpServerResponse.json({ sessions: pty.list() })
          }),
        ),
        HttpRouter.route('POST', '/pty', (req) =>
          Effect.gen(function* () {
            // A body that is not JSON can never decode: `cols` must be a number.
            const body = yield* Effect.orElseSucceed(req.json, () => ({ cols: 'INVALID' }))
            const decoded = decodePtyCreateInput(body)
            if (Option.isNone(decoded)) {
              return HttpServerResponse.text('invalid pty request', { status: 400 })
            }
            const fields = decoded.value
            const created = yield* pty
              .create({
                projectId: fields.projectId,
                cols: fields.cols,
                rows: fields.rows,
              })
              .pipe(
                Effect.map((session) => PtyCreated.make({ session })),
                Effect.catch((error) => Effect.succeed(PtyFailed.make({ error }))),
              )
            if (Predicate.isTagged(created, 'PtyFailed')) {
              if (Predicate.isTagged(created.error, 'SessionsExhausted')) {
                return HttpServerResponse.text('too many terminals', { status: 429 })
              }
              return HttpServerResponse.text('terminal unavailable', { status: 500 })
            }
            const session = created.session
            if (session === undefined) {
              return HttpServerResponse.text('unknown project', { status: 404 })
            }
            return yield* HttpServerResponse.json({
              sessionId: session.id,
              wsUrl: `/pty/${session.id}`,
              projectId: session.projectId ?? null,
            })
          }),
        ),
        HttpRouter.route(
          'DELETE',
          '/pty/:id',
          Effect.gen(function* () {
            const params = yield* HttpRouter.params
            const killed = pty.kill(params['id'] ?? '')
            if (!killed) {
              return HttpServerResponse.text('unknown pty session', { status: 404 })
            }
            return yield* HttpServerResponse.json({ killed: true })
          }),
        ),
      ])

/**
 * One parameterized route over the store's address index: the lookup key
 * space is exactly the set of addresses the store built, never a filesystem
 * path. An address the host did not build is a 404.
 */
const uiBundleRoutes = (store: PluginStore) =>
  HttpRouter.addAll([
    HttpRouter.route(
      'GET',
      '/ui/:address',
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const js = yield* store.bundleJs(params['address'] ?? '')
        if (js === undefined) {
          return HttpServerResponse.text('not found', { status: 404 })
        }
        return HttpServerResponse.text(js, { contentType: 'text/javascript' })
      }),
    ),
  ])
