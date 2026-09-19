import { Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { RpcServer } from 'effect/unstable/rpc'
import type { AnyPlugin, Host } from '@oru/kernel'
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
import type { UiBundles, UiOverrides } from './ui.ts'

export const rpcRoutes = (
  host: Host,
  plugins: readonly AnyPlugin[],
  ui: { readonly built: UiBundles; readonly overrides: UiOverrides },
) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: HostRpc, path: hostRpcPath, protocol: 'http' }).pipe(
      Layer.provide(HostRpc.toLayer(hostRpcHandlers(host, plugins))),
    ),
    RpcServer.layerHttp({ group: ProjectRpc, path: projectRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ProjectRpc.toLayer(projectRpcHandlers)),
    ),
    RpcServer.layerHttp({ group: ThreadRpc, path: threadRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
    ),
    RpcServer.layerHttp({ group: UiRpc, path: uiRpcPath, protocol: 'http' }).pipe(
      Layer.provide(UiRpc.toLayer(uiRpcHandlers(host, ui.built, ui.overrides))),
    ),
    uiBundleRoutes(ui.built),
  ).pipe(Layer.provide(rpcSerializationLayer))

/**
 * One exact route per built bundle: no path params to parse, no directory
 * to escape. An address the host did not build is simply no route.
 */
const uiBundleRoutes = (built: UiBundles) =>
  HttpRouter.addAll(
    [...built.values()].map((bundle) =>
      HttpRouter.route(
        'GET',
        `/ui/${bundle.address}.js`,
        HttpServerResponse.text(bundle.js, { contentType: 'text/javascript' }),
      ),
    ),
  )
