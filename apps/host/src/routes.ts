import { Layer } from 'effect'
import { RpcServer } from 'effect/unstable/rpc'
import type { AnyPlugin, Host } from '@oru/kernel'
import {
  HostRpc,
  ProjectRpc,
  ThreadRpc,
  hostRpcPath,
  projectRpcPath,
  rpcSerializationLayer,
  threadRpcPath,
} from '@oru/rpc'
import { hostRpcHandlers } from './handlers/host.ts'
import { projectRpcHandlers } from './handlers/project.ts'
import { threadRpcHandlers } from './handlers/thread.ts'

/**
 * The RPC groups, mounted where a client expects them.
 *
 * One server per group, on its own path: the view holds independent clients,
 * and a group that stops answering cannot take the others down with it.
 */
export const rpcRoutes = (host: Host, plugins: readonly AnyPlugin[]) =>
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
  ).pipe(Layer.provide(rpcSerializationLayer))
