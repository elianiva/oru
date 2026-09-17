import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { RpcClient, RpcClientError } from 'effect/unstable/rpc'
import type {
  DirectoryMissing,
  NotDirectory,
  PluginId,
  ProjectId,
  RelativeCwd,
  SessionEvent,
  ThreadId,
  UnknownProject,
  UnknownThread,
} from '@oru/kernel'
import { HostRpc } from './host-rpc.ts'
import { ProjectRpc } from './project-rpc.ts'
import { ThreadRpc } from './thread-rpc.ts'
import { hostRpcPath, projectRpcPath, rpcSerializationLayer, threadRpcPath } from './transport.ts'
import type { DirectoryListing } from './project-rpc.ts'
import type { Project } from './project.ts'
import type { ThreadConfig, ThreadConfiguration, ThreadOptions } from './thread-options.ts'
import type { ThreadSignal } from './thread-signal.ts'
import type { ViewGraph } from './view-graph.ts'

/**
 * The host did not answer a call: the transport failed, or the answer could not
 * be framed. That is a state a client renders, not a broken invariant, so a
 * facade call fails with this error instead of dying. A bug in this process is
 * still a defect, and still dies.
 */
export class HostUnreachable extends Schema.TaggedError<HostUnreachable>()('HostUnreachable', {
  operation: Schema.String,
  reason: Schema.String,
}) {}

/** What a panel sees of the kernel graph, and the one command it can send. */
export interface GraphRpcContract {
  readonly watch: Stream.Stream<ViewGraph, HostUnreachable>
  readonly setLive: (plugin: PluginId, live: boolean) => Effect.Effect<ViewGraph, HostUnreachable>
}

export class GraphRpc extends Context.Service<GraphRpc, GraphRpcContract>()('oru/GraphRpc') {}

export interface ProjectClientContract {
  readonly create: (
    name: string,
    cwd: string,
    icon?: string | undefined,
  ) => Effect.Effect<Project, RelativeCwd | HostUnreachable>
  readonly list: () => Effect.Effect<readonly Project[], HostUnreachable>
  readonly get: (project: ProjectId) => Effect.Effect<Project, UnknownProject | HostUnreachable>
  readonly update: (
    project: ProjectId,
    change: { readonly name: string; readonly cwd: string; readonly icon?: string | undefined },
  ) => Effect.Effect<Project, RelativeCwd | UnknownProject | HostUnreachable>
  readonly remove: (
    project: ProjectId,
  ) => Effect.Effect<{ readonly project: ProjectId }, UnknownProject | HostUnreachable>
  readonly listDirectory: (
    path?: string | undefined,
  ) => Effect.Effect<DirectoryListing, DirectoryMissing | NotDirectory | HostUnreachable>
}

export class ProjectClient extends Context.Service<ProjectClient, ProjectClientContract>()(
  'oru/ProjectClient',
) {}

/** What a thread's pane needs from the host: facts, configuration, live signals. */
export interface ThreadClientContract {
  readonly create: (
    project: ProjectId,
    configuration?: ThreadConfiguration,
  ) => Effect.Effect<
    { readonly threadId: ThreadId; readonly project: Project },
    UnknownProject | HostUnreachable
  >
  readonly send: (threadId: ThreadId, text: string) => Effect.Effect<void, HostUnreachable>
  readonly watch: (threadId: ThreadId) => Stream.Stream<SessionEvent, HostUnreachable>
  readonly options: (
    threadId: ThreadId | undefined,
    options?: { readonly refresh?: boolean },
  ) => Effect.Effect<ThreadOptions, HostUnreachable>
  readonly configure: (
    threadId: ThreadId,
    configuration: ThreadConfig,
  ) => Effect.Effect<ThreadOptions, HostUnreachable>
  readonly watchSignals: (threadId: ThreadId) => Stream.Stream<ThreadSignal, HostUnreachable>
  readonly stop: (threadId: ThreadId) => Effect.Effect<void, HostUnreachable>
  readonly compact: (
    threadId: ThreadId,
    instructions?: string,
  ) => Effect.Effect<void, HostUnreachable>
  readonly fork: (
    sourceThreadId: ThreadId,
    cwd?: string,
  ) => Effect.Effect<
    { readonly threadId: ThreadId },
    UnknownThread | UnknownProject | HostUnreachable
  >
  readonly decide: (
    threadId: ThreadId,
    request: string,
    decision: 'approve' | 'deny',
  ) => Effect.Effect<void, HostUnreachable>
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

/**
 * The host's own refusal travels with its tag; only the transport failure is
 * renamed, so a caller reads the refusals its call actually declares.
 */
const lostHost = (operation: string, error: RpcClientError.RpcClientError): HostUnreachable =>
  new HostUnreachable({ operation, reason: error.message })

const isTransportError = Schema.is(RpcClientError.RpcClientError)

const reachable = <A>(
  operation: string,
  effect: Effect.Effect<A, RpcClientError.RpcClientError>,
): Effect.Effect<A, HostUnreachable> =>
  effect.pipe(Effect.mapError((error): HostUnreachable => lostHost(operation, error)))

const reachableCwd = <A>(
  operation: string,
  effect: Effect.Effect<A, RelativeCwd | RpcClientError.RpcClientError>,
): Effect.Effect<A, RelativeCwd | HostUnreachable> =>
  effect.pipe(
    Effect.mapError((error): RelativeCwd | HostUnreachable =>
      isTransportError(error) ? lostHost(operation, error) : error,
    ),
  )

const reachableProject = <A>(
  operation: string,
  effect: Effect.Effect<A, RelativeCwd | UnknownProject | RpcClientError.RpcClientError>,
): Effect.Effect<A, RelativeCwd | UnknownProject | HostUnreachable> =>
  effect.pipe(
    Effect.mapError((error): RelativeCwd | UnknownProject | HostUnreachable =>
      isTransportError(error) ? lostHost(operation, error) : error,
    ),
  )

const reachableNew = <A>(
  operation: string,
  effect: Effect.Effect<A, UnknownProject | RpcClientError.RpcClientError>,
): Effect.Effect<A, UnknownProject | HostUnreachable> =>
  effect.pipe(
    Effect.mapError((error): UnknownProject | HostUnreachable =>
      isTransportError(error) ? lostHost(operation, error) : error,
    ),
  )

const reachableFork = <A>(
  operation: string,
  effect: Effect.Effect<A, UnknownThread | UnknownProject | RpcClientError.RpcClientError>,
): Effect.Effect<A, UnknownThread | UnknownProject | HostUnreachable> =>
  effect.pipe(
    Effect.mapError((error): UnknownThread | UnknownProject | HostUnreachable =>
      isTransportError(error) ? lostHost(operation, error) : error,
    ),
  )

const reachableStream = <A>(
  operation: string,
  stream: Stream.Stream<A, RpcClientError.RpcClientError>,
): Stream.Stream<A, HostUnreachable> =>
  stream.pipe(Stream.mapError((error): HostUnreachable => lostHost(operation, error)))

export const graphRpcOf = (
  client: RpcClient.FromGroup<typeof HostRpc, RpcClientError.RpcClientError>,
): Layer.Layer<GraphRpc> =>
  Layer.succeed(GraphRpc, {
    watch: reachableStream('WatchGraph', client.WatchGraph()),
    setLive: (plugin, live) => reachable('SetLive', client.SetLive({ plugin, live })),
  })

const reachableDirectory = <A>(
  operation: string,
  effect: Effect.Effect<A, DirectoryMissing | NotDirectory | RpcClientError.RpcClientError>,
): Effect.Effect<A, DirectoryMissing | NotDirectory | HostUnreachable> =>
  effect.pipe(
    Effect.mapError((error): DirectoryMissing | NotDirectory | HostUnreachable =>
      isTransportError(error) ? lostHost(operation, error) : error,
    ),
  )

export const projectClientOf = (
  client: RpcClient.FromGroup<typeof ProjectRpc, RpcClientError.RpcClientError>,
): Layer.Layer<ProjectClient> =>
  Layer.succeed(ProjectClient, {
    create: (name, cwd, icon) =>
      reachableCwd('CreateProject', client.CreateProject({ name, cwd, icon })),
    list: () => reachable('ListProjects', client.ListProjects()),
    get: (project) => reachableNew('GetProject', client.GetProject({ project })),
    update: (project, change) =>
      reachableProject(
        'UpdateProject',
        client.UpdateProject({
          project,
          name: change.name,
          cwd: change.cwd,
          icon: change.icon,
        }),
      ),
    remove: (project) => reachableNew('DeleteProject', client.DeleteProject({ project })),
    listDirectory: (path) => reachableDirectory('ListDirectory', client.ListDirectory({ path })),
  })

export const threadClientOf = (
  client: RpcClient.FromGroup<typeof ThreadRpc, RpcClientError.RpcClientError>,
): Layer.Layer<ThreadClient> =>
  Layer.succeed(ThreadClient, {
    create: (project, configuration) =>
      reachableNew(
        'CreateThread',
        client.CreateThread({
          project,
          harness: configuration?.harness,
          model: configuration?.model,
          reasoning: configuration?.reasoning,
        }),
      ),
    send: (threadId, text) => reachable('SendMessage', client.SendMessage({ threadId, text })),
    watch: (threadId) => reachableStream('WatchThread', client.WatchThread({ threadId })),
    options: (threadId, options) =>
      reachable(
        'ThreadOptions',
        client.ThreadOptions(
          options?.refresh === true ? { threadId, refresh: true } : { threadId },
        ),
      ),
    configure: (threadId, configuration) =>
      reachable(
        'ConfigureThread',
        client.ConfigureThread({
          threadId,
          harness: configuration.harness,
          model: configuration.model,
          reasoning: configuration.reasoning,
        }),
      ),
    watchSignals: (threadId) => reachableStream('WatchSignals', client.WatchSignals({ threadId })),
    stop: (threadId) => reachable('StopThread', client.StopThread({ threadId })),
    compact: (threadId, instructions) =>
      reachable('CompactThread', client.CompactThread({ threadId, instructions })),
    fork: (sourceThreadId, cwd) =>
      reachableFork('ForkThread', client.ForkThread({ sourceThreadId, cwd })),
    decide: (threadId, request, decision) =>
      reachable('DecideApproval', client.DecideApproval({ threadId, request, decision })),
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
