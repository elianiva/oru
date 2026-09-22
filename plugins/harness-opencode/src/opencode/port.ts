import type { OpenCodeEvent } from '@opencode/client/effect'
import { Session } from '@opencode/schema/session'
import type { Model } from '@opencode/schema/model'
import type { Provider } from '@opencode/schema/provider'
import type { SessionInbox } from '@opencode/schema/session-inbox'
import type { SessionMessage } from '@opencode/schema/session-message'
import type { Plugin } from '@opencode/plugin/effect/plugin'
import { InstructionEntry } from '@opencode/schema/instruction-entry'
import { AbsolutePath } from '@opencode/schema/schema'
import { Event } from '@opencode/schema/event'
import { OpenCode } from '@opencode/sdk/effect'
import { Effect, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import type {
  AgentListOutput,
  MessageListOutput,
  ModelListOutput,
  ProviderListOutput,
  SessionExportOutput,
  SessionImportInput,
  SessionLogOutput,
} from '@opencode/client/effect/api'
import { bridgeError, hostOpenFailed } from './errors.ts'
import { HarnessError } from '@oru/harness'

/**
 * The narrow OpenCode surface the bridge speaks. Every operation fails with
 * the contract's own error, so no OpenCode SDK type leaks past this module
 * into the harness; callers name sessions by oru thread id and the port owns
 * the thread-to-session identity.
 *
 * A thread's session id IS its thread id: `sessions.create` accepts an explicit
 * id, so get-or-create is one lookup with creation on `Session.NotFoundError`.
 * That also restores across restarts for free, with no map to keep in sync.
 */
export interface OpenCodePort {
  /**
   * The thread's session, or `undefined` when the thread has never run here.
   * A miss is a value, not a failure: the caller seeds (import) or creates,
   * because `session.import` conflicts with an id that already exists.
   */
  readonly getSession: (threadId: string) => Effect.Effect<Session.Info | undefined, HarnessError>
  readonly createSession: (input: {
    readonly threadId: string
    readonly cwd: string
    readonly model?: Model.Ref | undefined
  }) => Effect.Effect<Session.Info, HarnessError>
  readonly prompt: (input: {
    readonly threadId: string
    readonly text: string
    readonly messageID: SessionMessage.ID
    readonly delivery?: SessionInbox.Delivery | undefined
  }) => Effect.Effect<void, HarnessError>
  /** Durable session log, optionally resumed after a cursor; `follow` always set. */
  readonly log: (input: {
    readonly threadId: string
    readonly after?: number | undefined
  }) => Stream.Stream<SessionLogOutput, HarnessError>
  /** Ephemeral per-turn bus, subscribed fresh for each turn. */
  readonly subscribe: () => Stream.Stream<OpenCodeEvent, HarnessError>
  readonly messages: (threadId: string) => Effect.Effect<MessageListOutput, HarnessError>
  readonly interrupt: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly switchModel: (input: {
    readonly threadId: string
    readonly model: Model.Ref
  }) => Effect.Effect<void, HarnessError>
  readonly moveSession: (input: {
    readonly threadId: string
    readonly directory: string
  }) => Effect.Effect<void, HarnessError>
  readonly removeSession: (threadId: string) => Effect.Effect<void, HarnessError>
  readonly forkSession: (input: {
    readonly threadId: string
    readonly targetThreadId: string
    readonly before?: SessionMessage.ID | undefined
  }) => Effect.Effect<void, HarnessError>
  readonly exportSession: (threadId: string) => Effect.Effect<SessionExportOutput, HarnessError>
  readonly importSession: (input: SessionImportInput) => Effect.Effect<Session.Info, HarnessError>
  readonly compact: (input: {
    readonly threadId: string
    readonly messageID?: SessionMessage.ID | undefined
  }) => Effect.Effect<void, HarnessError>
  readonly putInstruction: (input: {
    readonly threadId: string
    readonly key: string
    readonly content: string
  }) => Effect.Effect<void, HarnessError>
  readonly removeInstruction: (input: {
    readonly threadId: string
    readonly key: string
  }) => Effect.Effect<void, HarnessError>
  readonly models: () => Effect.Effect<ModelListOutput, HarnessError>
  readonly defaultModel: () => Effect.Effect<Model.Info | undefined, HarnessError>
  readonly providers: () => Effect.Effect<ProviderListOutput, HarnessError>
  /** Built-in agents, to name the session's agent on messages the seed writes. */
  readonly agents: () => Effect.Effect<AgentListOutput, HarnessError>
  /** Register oru tools as an OpenCode plugin, once per host boot. */
  readonly registerPlugin: (plugin: Plugin) => Effect.Effect<void, HarnessError>
}

export interface OpenPortOptions {
  /** The bridge's whole environment; applied around every host call. */
  readonly env: NodeJS.ProcessEnv
  readonly createOptions?: OpenCode.CreateOptions | undefined
}

/**
 * Open the embedded host and narrow it to the port. Scoped: closing the scope
 * closes the host. A host that fails to open fails retryable, so the runtime
 * backs off and the next call boots again.
 */
export const openPort = (
  options: OpenPortOptions,
): Effect.Effect<OpenCodePort, HarnessError, Scope.Scope> => {
  const host =
    options.createOptions === undefined ? OpenCode.create() : OpenCode.create(options.createOptions)
  return host.pipe(
    Effect.mapError((cause) => hostOpenFailed(cause)),
    Effect.catchDefect((defect) => Effect.fail(hostOpenFailed(defect))),
    Effect.map((client) => portOf(client, options.env)),
  )
}

// `.make` would validate the `ses` prefix, but a thread id is an opaque oru
// key the bridge equates with the session id by convention, so the brand is
// attached without parsing.
// SAFETY: the port owns the thread-to-session identity, and every call site passes an oru thread id through here, so the brand only records that convention.
const sessionIDOf = (threadId: string): Session.ID => threadId as Session.ID

const portOf = (client: OpenCode.Interface, env: NodeJS.ProcessEnv): OpenCodePort => {
  const run = <A, E>(effect: Effect.Effect<A, E>, op: string): Effect.Effect<A, HarnessError> =>
    withEnv(env, effect).pipe(
      Effect.mapError((cause) => opFailed(op, cause)),
      Effect.catchDefect((defect) => Effect.fail(opFailed(op, defect))),
    )
  const stream = <A, E>(stream: Stream.Stream<A, E>, op: string): Stream.Stream<A, HarnessError> =>
    stream.pipe(
      Stream.mapError((cause) => opFailed(op, cause)),
      Stream.catchDefect((defect) => Stream.fail(opFailed(op, defect))),
    )
  return {
    getSession: (threadId) =>
      run(
        client.sessions
          .get({ sessionID: sessionIDOf(threadId) })
          .pipe(Effect.catchTag('Session.NotFoundError', () => Effect.succeed(undefined))),
        'session.get',
      ),
    createSession: (input) => {
      const directory = AbsolutePath.make(input.cwd)
      const id = sessionIDOf(input.threadId)
      return run(
        input.model === undefined
          ? client.sessions.create({ id, location: { directory } })
          : client.sessions.create({ id, location: { directory }, model: input.model }),
        'session.create',
      )
    },
    prompt: (input) => {
      const sessionID = sessionIDOf(input.threadId)
      return run(
        input.delivery === undefined
          ? client.session.prompt({ sessionID, id: input.messageID, text: input.text })
          : client.session.prompt({
              sessionID,
              id: input.messageID,
              text: input.text,
              delivery: input.delivery,
            }),
        'session.prompt',
      ).pipe(Effect.asVoid)
    },
    log: (input) => {
      const sessionID = sessionIDOf(input.threadId)
      return stream(
        input.after === undefined
          ? client.session.log({ sessionID, follow: true })
          : client.session.log({ sessionID, follow: true, after: Event.Seq.make(input.after) }),
        'session.log',
      )
    },
    subscribe: () => stream(client.events.subscribe(), 'event.subscribe'),
    messages: (threadId) =>
      run(
        client.message.list({ sessionID: sessionIDOf(threadId), limit: 500, order: 'asc' }),
        'message.list',
      ),
    interrupt: (threadId) =>
      run(client.session.interrupt({ sessionID: sessionIDOf(threadId) }), 'session.interrupt').pipe(
        Effect.asVoid,
      ),
    switchModel: (input) =>
      run(
        client.session.switchModel({
          sessionID: sessionIDOf(input.threadId),
          model: input.model,
        }),
        'session.switchModel',
      ),
    moveSession: (input) =>
      run(
        client.sessions.move({
          sessionID: sessionIDOf(input.threadId),
          directory: AbsolutePath.make(input.directory),
        }),
        'session.move',
      ).pipe(Effect.asVoid),
    removeSession: (threadId) =>
      run(
        client.session
          .remove({ sessionID: sessionIDOf(threadId) })
          .pipe(Effect.catchTag('SessionNotFoundError', () => Effect.void)),
        'session.remove',
      ),
    forkSession: (input) => {
      const sessionID = sessionIDOf(input.threadId)
      const targetID = sessionIDOf(input.targetThreadId)
      const fork =
        input.before === undefined
          ? client.session.fork({ sessionID })
          : client.session.fork({ sessionID, before: input.before })
      return run(
        fork.pipe(
          Effect.flatMap((forked) =>
            client.session.export({ sessionID: forked.id }).pipe(
              Effect.flatMap((snapshot) =>
                client.session.import({
                  info: Object.assign({}, snapshot.info, {
                    id: targetID,
                  }),
                  messages: snapshot.messages,
                }),
              ),
            ),
          ),
        ),
        'session.fork',
      ).pipe(Effect.asVoid)
    },
    exportSession: (threadId) =>
      run(client.session.export({ sessionID: sessionIDOf(threadId) }), 'session.export'),
    importSession: (input) => run(client.session.import(input), 'session.import'),
    compact: (input) => {
      const sessionID = sessionIDOf(input.threadId)
      return run(
        input.messageID === undefined
          ? client.session.compact({ sessionID })
          : client.session.compact({ sessionID, id: input.messageID }),
        'session.compact',
      ).pipe(Effect.asVoid)
    },
    putInstruction: (input) =>
      run(
        client.session.instructions.entry.put({
          sessionID: sessionIDOf(input.threadId),
          key: InstructionEntry.Key.make(input.key),
          value: input.content,
        }),
        'session.instructions.put',
      ),
    removeInstruction: (input) =>
      run(
        client.session.instructions.entry.remove({
          sessionID: sessionIDOf(input.threadId),
          key: InstructionEntry.Key.make(input.key),
        }),
        'session.instructions.remove',
      ),
    models: () => run(client.model.list(), 'model.list'),
    agents: () => run(client.agent.list(), 'agent.list'),
    defaultModel: () =>
      run(client.model.default(), 'model.default').pipe(Effect.map((out) => out.data)),
    providers: () => run(client.provider.list(), 'provider.list'),
    registerPlugin: (plugin) => run(client.plugin(plugin), 'plugin.register'),
  }
}

const opFailed = (op: string, cause: unknown): HarnessError =>
  cause instanceof HarnessError
    ? cause
    : bridgeError('execution_failed', `${op}: ${describe(cause)}`, { cause })

const describe = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  if (Predicate.isString(cause)) return cause
  return JSON.stringify(cause) ?? 'an unknown failure was reported'
}

/**
 * The bridge's whole environment, applied around one host call and restored
 * after: the embedded host reads the process environment, so a configured env
 * replaces it wholesale for the call's duration and an absent one leaves it
 * untouched. Synchronous swap with async restore is safe because Effect
 * acquireRelease guarantees the release runs even when the use is interrupted.
 */
const withEnv = <A, E>(env: NodeJS.ProcessEnv, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.sync(() => swapEnv(env)),
    () => effect,
    (restore) => Effect.sync(restore),
  )

const swapEnv = (env: NodeJS.ProcessEnv): (() => void) => {
  const previous = { ...process.env }
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, env)
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
  }
}

export type { SessionExportOutput, SessionImportInput, ModelListOutput, ProviderListOutput }
export type { Provider }
