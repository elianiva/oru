import { Context, Effect, Layer, Stream } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { RpcClient, RpcClientError } from 'effect/unstable/rpc'
import type { PluginId, ProjectId, SessionEvent, ThreadId } from '@oru/kernel'
import { HostRpc } from './host-rpc.ts'
import { ProjectRpc } from './project-rpc.ts'
import { ThreadRpc } from './thread-rpc.ts'
import { hostRpcPath, projectRpcPath, rpcSerializationLayer, threadRpcPath } from './transport.ts'
import type { Project } from './project.ts'
import type { ThreadConfig, ThreadOptions } from './thread-options.ts'
import type { ThreadSignal } from './thread-signal.ts'
import type { ViewGraph } from './view-graph.ts'

/** What a panel sees of the kernel graph, and the one command it can send. */
export interface GraphRpcContract {
  readonly watch: Stream.Stream<ViewGraph>
  readonly setLive: (plugin: PluginId, live: boolean) => Effect.Effect<ViewGraph>
}

export class GraphRpc extends Context.Service<GraphRpc, GraphRpcContract>()('oru/GraphRpc') {}

export interface ProjectClientContract {
  readonly create: (name: string, cwd: string) => Effect.Effect<Project>
  readonly list: () => Effect.Effect<readonly Project[]>
  readonly get: (project: ProjectId) => Effect.Effect<Project>
}

export class ProjectClient extends Context.Service<ProjectClient, ProjectClientContract>()(
  'oru/ProjectClient',
) {}

/** What a thread's pane needs from the host: facts, configuration, live signals. */
export interface ThreadClientContract {
  readonly create: (
    project: ProjectId,
  ) => Effect.Effect<{ readonly threadId: ThreadId; readonly project: Project }>
  readonly send: (threadId: ThreadId, text: string) => Effect.Effect<void>
  readonly watch: (threadId: ThreadId) => Stream.Stream<SessionEvent>
  readonly options: (
    threadId: ThreadId,
    options?: { readonly refresh?: boolean },
  ) => Effect.Effect<ThreadOptions>
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
  readonly decide: (
    threadId: ThreadId,
    request: string,
    decision: 'approve' | 'deny',
  ) => Effect.Effect<void>
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

export const projectClientOf = (
  client: RpcClient.FromGroup<typeof ProjectRpc, RpcClientError.RpcClientError>,
): Layer.Layer<ProjectClient> =>
  Layer.succeed(ProjectClient, {
    create: (name, cwd) => client.CreateProject({ name, cwd }).pipe(Effect.orDie),
    list: () => client.ListProjects().pipe(Effect.orDie),
    get: (project) => client.GetProject({ project }).pipe(Effect.orDie),
  })

export const threadClientOf = (
  client: RpcClient.FromGroup<typeof ThreadRpc, RpcClientError.RpcClientError>,
): Layer.Layer<ThreadClient> =>
  Layer.succeed(ThreadClient, {
    create: (project) => client.CreateThread({ project }).pipe(Effect.orDie),
    send: (threadId, text) => client.SendMessage({ threadId, text }).pipe(Effect.orDie),
    watch: (threadId) => client.WatchThread({ threadId }).pipe(Stream.orDie),
    options: (threadId, options) =>
      client
        .ThreadOptions(options?.refresh === true ? { threadId, refresh: true } : { threadId })
        .pipe(Effect.orDie),
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
    decide: (threadId, request, decision) =>
      client.DecideApproval({ threadId, request, decision }).pipe(Effect.orDie),
  })

/**
 * The three facades, wired to a host over the real transport.
 *
 * The view asks for `GraphRpc`, `ProjectClient`, and `ThreadClient` and never
 * sees the URLs, the framing, or the RPC groups. It is a layer because that is
 * what a caller wants: the runtime's resources, or an `Effect.provide`.
 *
 * `hostUrl` is a prefix, so `''` targets whatever origin served the app and an
 * absolute URL targets a host somewhere else.
 */
export const clientsFor = (hostUrl: string): Layer.Layer<GraphRpc | ProjectClient | ThreadClient> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const host = yield* RpcClient.make(HostRpc).pipe(
        Effect.provide(protocolFor(`${hostUrl}${hostRpcPath}`)),
      )
      const projects = yield* RpcClient.make(ProjectRpc).pipe(
        Effect.provide(protocolFor(`${hostUrl}${projectRpcPath}`)),
      )
      const thread = yield* RpcClient.make(ThreadRpc).pipe(
        Effect.provide(protocolFor(`${hostUrl}${threadRpcPath}`)),
      )
      return Layer.mergeAll(graphRpcOf(host), projectClientOf(projects), threadClientOf(thread))
    }),
  )
