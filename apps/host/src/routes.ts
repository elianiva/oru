import { Layer } from 'effect'
import { RpcServer } from 'effect/unstable/rpc'
import type { AnyPlugin, Host } from '@oru/kernel'
import { HostRpc, ThreadRpc, hostRpcPath, rpcSerializationLayer, threadRpcPath } from '@oru/rpc'
import { hostRpcHandlers } from './handlers/host.ts'
import { threadRpcHandlers } from './handlers/thread.ts'

/**
 * Both RPC groups, mounted where a client expects them.
 *
 * One server per group, on its own path: the view holds two independent
 * clients, and a group that stops answering cannot take the other down with it.
 */
export const rpcRoutes = (host: Host, plugins: readonly AnyPlugin[]) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: HostRpc, path: hostRpcPath, protocol: 'http' }).pipe(
      Layer.provide(HostRpc.toLayer(hostRpcHandlers(host, plugins))),
    ),
    RpcServer.layerHttp({ group: ThreadRpc, path: threadRpcPath, protocol: 'http' }).pipe(
      Layer.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
    ),
  ).pipe(Layer.provide(rpcSerializationLayer))
