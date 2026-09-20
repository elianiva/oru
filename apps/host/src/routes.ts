import { Effect, Layer } from 'effect'
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

export const rpcRoutes = (
  host: Host,
  store: PluginStore,
  options?: { readonly personalCwd?: string | undefined },
) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: HostRpc, path: hostRpcPath, protocol: 'http' }).pipe(
      Layer.provide(HostRpc.toLayer(hostRpcHandlers(host, store))),
    ),
    RpcServer.layerHttp({ group: ProjectRpc, path: projectRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ProjectRpc.toLayer(projectRpcHandlers(options))),
    ),
    RpcServer.layerHttp({ group: ThreadRpc, path: threadRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
    ),
    RpcServer.layerHttp({ group: UiRpc, path: uiRpcPath, protocol: 'http' }).pipe(
      Layer.provide(UiRpc.toLayer(uiRpcHandlers(host, store))),
    ),
    uiBundleRoutes(store),
  ).pipe(Layer.provide(rpcSerializationLayer))

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
