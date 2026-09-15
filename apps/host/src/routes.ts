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
