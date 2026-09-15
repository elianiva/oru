import { Context, Effect, Layer, Stream, type Scope } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { RpcClient, RpcClientError } from 'effect/unstable/rpc'
import type { PluginId, SessionEvent, ThreadId } from '@oru/kernel'
import { HostRpc } from './host-rpc.ts'
import { ThreadRpc } from './thread-rpc.ts'
import { hostRpcPath, rpcSerializationLayer, threadRpcPath } from './transport.ts'
import type { ThreadConfig, ThreadOptions } from './thread-options.ts'
import type { ThreadSignal } from './thread-signal.ts'
import type { ViewGraph } from './view-graph.ts'

/** What a panel sees of the kernel graph, and the one command it can send. */
export interface GraphRpcContract {
  readonly watch: Stream.Stream<ViewGraph>
  readonly setLive: (plugin: PluginId, live: boolean) => Effect.Effect<ViewGraph>
}

export class GraphRpc extends Context.Service<GraphRpc, GraphRpcContract>()('oru/GraphRpc') {}

/** What a thread's pane needs from the host: facts, configuration, live signals. */
export interface ThreadClientContract {
  /** A real directory, because a cwd-bound harness resumes by it (ADR-0006). */
  readonly create: (cwd?: string) => Effect.Effect<{ readonly threadId: ThreadId }>
  readonly send: (threadId: ThreadId, text: string) => Effect.Effect<void>
  readonly watch: (threadId: ThreadId) => Stream.Stream<SessionEvent>
  readonly options: (threadId: ThreadId) => Effect.Effect<ThreadOptions>
  readonly configure: (
    threadId: ThreadId,
    configuration: ThreadConfig,
  ) => Effect.Effect<ThreadOptions>
  readonly watchSignals: (threadId: ThreadId) => Stream.Stream<ThreadSignal>
  readonly stop: (threadId: ThreadId) => Effect.Effect<void>
  readonly compact: (threadId: ThreadId, instructions?: string) => Effect.Effect<void>
  readonly fork: (
    sourceThreadId: ThreadId,
    cwd?: string,
  ) => Effect.Effect<{ readonly threadId: ThreadId }>
}

export class ThreadClient extends Context.Service<ThreadClient, ThreadClientContract>()(
  'oru/ThreadClient',
) {}

/** A client protocol for one group, framed the way the host mounts it. */
const protocolFor = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(rpcSerializationLayer),
    Layer.provide(FetchHttpClient.layer),
  )

export const graphRpcOf = (
  client: RpcClient.FromGroup<typeof HostRpc, RpcClientError.RpcClientError>,
): Layer.Layer<GraphRpc> =>
  Layer.succeed(GraphRpc, {
    watch: client.WatchGraph().pipe(Stream.orDie),
    setLive: (plugin, live) => client.SetLive({ plugin, live }).pipe(Effect.orDie),
  })

export const threadClientOf = (
  client: RpcClient.FromGroup<typeof ThreadRpc, RpcClientError.RpcClientError>,
): Layer.Layer<ThreadClient> =>
  Layer.succeed(ThreadClient, {
    create: (cwd) => client.CreateThread({ cwd }).pipe(Effect.orDie),
    send: (threadId, text) => client.SendMessage({ threadId, text }).pipe(Effect.orDie),
    watch: (threadId) => client.WatchThread({ threadId }).pipe(Stream.orDie),
    options: (threadId) => client.ThreadOptions({ threadId }).pipe(Effect.orDie),
    configure: (threadId, configuration) =>
      client
        .ConfigureThread({
          threadId,
          harness: configuration.harness,
          model: configuration.model,
          reasoning: configuration.reasoning,
        })
        .pipe(Effect.orDie),
    watchSignals: (threadId) => client.WatchSignals({ threadId }).pipe(Stream.orDie),
    stop: (threadId) => client.StopThread({ threadId }).pipe(Effect.orDie),
    compact: (threadId, instructions) =>
      client.CompactThread({ threadId, instructions }).pipe(Effect.orDie),
    fork: (sourceThreadId, cwd) => client.ForkThread({ sourceThreadId, cwd }).pipe(Effect.orDie),
  })

/**
 * Both facades, wired to a host over the real transport.
 *
 * The view asks for `GraphRpc` and `ThreadClient` and never sees the URLs, the
 * framing, or the RPC groups. `hostUrl` is a prefix, so `''` targets whatever
 * origin served the app and an absolute URL targets a host somewhere else.
 */
export const clientsFor = (
  hostUrl: string,
): Effect.Effect<Layer.Layer<GraphRpc | ThreadClient>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const host = yield* RpcClient.make(HostRpc).pipe(
      Effect.provide(protocolFor(`${hostUrl}${hostRpcPath}`)),
    )
    const thread = yield* RpcClient.make(ThreadRpc).pipe(
      Effect.provide(protocolFor(`${hostUrl}${threadRpcPath}`)),
    )
    return Layer.mergeAll(graphRpcOf(host), threadClientOf(thread))
  })
