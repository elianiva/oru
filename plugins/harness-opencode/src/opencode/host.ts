import { Cause, Effect, Exit, Option, Scope, Stream } from 'effect'
import type { JsonSchema } from 'effect'
import type { Plugin } from '@opencode/plugin/effect/plugin'
import type { ToolEditor } from '@opencode/plugin/effect/tool'
import { Tool } from '@opencode/schema/tool'
import {
  defineHarness,
  type HarnessError,
  type HarnessForkRequest,
  type HarnessHealth,
  type HarnessService,
  type HarnessTurnRequest,
  type ToolContributionLike,
} from '@oru/harness'
import { OpenCodeCatalog } from './catalog.ts'
import { executionFailed, hostOpenFailed } from './errors.ts'
import { openPort, type OpenCodePort } from './port.ts'
import { compactThread, discardThread, forkThread } from './sessions.ts'
import { abortThread, runTurn, steerThread, type BoundTurn, type TurnHost } from './turn.ts'

/**
 * The factory: one embedded host per plugin activation, opened lazily on
 * first use into its own scope, which the activation Scope extends — so
 * deactivation closes the host and nothing else tears it down. An open
 * failure is captured once: every operation then fails fast with it, health
 * reports unknown, until `invalidateHealth` closes the scope and the next
 * call boots again.
 *
 * oru's tools reach the model as proxied OpenCode tools: the host registers
 * one plugin whose executors route by `context.sessionID` to the turn bound
 * there. OpenCode dispatches, oru executes, and the durable tool events are
 * the single source of every `ToolResult`.
 */

export interface OpenOpencodeHarnessInput {
  readonly env?: NodeJS.ProcessEnv | undefined
  /** A scripted port for tests; the real host is never opened. */
  readonly port?: OpenCodePort | undefined
}

export interface OpenedHarness {
  readonly service: HarnessService
}

export interface ToolSyncDeps {
  readonly editor: () => ToolEditor | undefined
  readonly bound: Map<string, BoundTurn>
}

/**
 * Diff one OpenCode tool editor to the turn's oru tools. Built-ins are never
 * touched: only names this function added (tracked in `managed`) are removed
 * or replaced, so two harnesses sharing a host cannot delete each other's.
 */
export const syncToolsOf = (
  deps: ToolSyncDeps,
  managed: Map<string, string>,
  tools: readonly ToolContributionLike[] | undefined,
): Effect.Effect<void, HarnessError> =>
  Effect.gen(function* () {
    const editor = deps.editor()
    const desired = tools ?? []
    if (editor === undefined) {
      if (desired.length > 0) {
        return yield* Effect.fail(executionFailed('the tool registry is not registered yet', true))
      }
      return
    }
    const wanted = new Map(desired.map((tool) => [tool.name, tool]))
    for (const name of managed.keys()) {
      if (!wanted.has(name)) {
        editor.remove(name)
        managed.delete(name)
      }
    }
    for (const [name, tool] of wanted) {
      const signature = JSON.stringify({
        description: tool.description,
        parameters: tool.parameters,
      })
      if (managed.get(name) === signature) continue
      if (managed.has(name)) editor.remove(name)
      // SAFETY: ToolContributionLike.parameters is a JSON Schema document by contract, and JsonSchema.JsonSchema is the Effect vale of that same document, so the narrowing only recovers the static shape.
      editor.add({
        name,
        description: tool.description,
        input: tool.parameters as JsonSchema.JsonSchema,
        execute: (parameters, context) =>
          Effect.gen(function* () {
            const holder = deps.bound.get(context.sessionID)
            if (holder === undefined) {
              return yield* Effect.fail(
                new Tool.Error({ message: `no active turn for session ${context.sessionID}` }),
              )
            }
            if (!holder.toolNames.has(name)) {
              return yield* Effect.fail(new Tool.Error({ message: `unknown tool "${name}"` }))
            }
            const argumentsJson = JSON.stringify(parameters)
            const approval = holder.awaitToolApproval
            if (approval !== undefined) {
              const decision = yield* Effect.promise(() =>
                approval({
                  request: context.id,
                  call: context.id,
                  name,
                  arguments: argumentsJson,
                }),
              )
              if (decision === 'deny') {
                return yield* Effect.fail(
                  new Tool.Error({ message: 'the user denied this tool call' }),
                )
              }
            }
            const outcome = yield* Effect.promise(() => holder.executeTool({ name, argumentsJson }))
            if (!outcome.ok) {
              return yield* Effect.fail(new Tool.Error({ message: outcome.result }))
            }
            return { content: outcome.result }
          }),
      })
      managed.set(name, signature)
    }
  })

export const openOpencodeHarness = (
  input: OpenOpencodeHarnessInput = {},
): Effect.Effect<OpenedHarness, never, Scope.Scope> =>
  Effect.gen(function* () {
    const env = input.env ?? process.env
    const fake = input.port
    const activationScope = yield* Effect.scope
    const cursors = new Map<string, number | undefined>()
    const active = new Map<string, { readonly promptMessageID: string }>()
    const bound = new Map<string, BoundTurn>()
    const managed = new Map<string, string>()
    let editor: ToolEditor | undefined
    let own: Scope.Scope | undefined
    let live: OpenCodePort | undefined
    let openFailure: HarnessError | undefined

    const oruPlugin: Plugin = {
      id: 'oru-tools',
      effect: (context) =>
        context.tool
          .transform((toolEditor) => {
            editor = toolEditor
          })
          .pipe(Effect.asVoid),
    }

    const loadPort = (): Effect.Effect<OpenCodePort, HarnessError> =>
      Effect.gen(function* () {
        if (fake !== undefined) return fake
        if (live !== undefined) return live
        if (openFailure !== undefined) return yield* Effect.fail(openFailure)
        const scope = yield* Scope.make()
        yield* Scope.addFinalizerExit(activationScope, (exit) => Scope.close(scope, exit))
        const result = yield* openPort({ env }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.tap((opened) => opened.registerPlugin(oruPlugin)),
          Effect.exit,
        )
        if (Exit.isFailure(result)) {
          yield* Scope.close(scope, Exit.void)
          const failure = Option.getOrElse(Cause.findErrorOption(result.cause), () =>
            hostOpenFailed(result.cause),
          )
          openFailure = failure
          return yield* Effect.fail(failure)
        }
        live = result.value
        own = scope
        return result.value
      })

    // The port every module speaks: same operations, loaded on first use.
    const port: OpenCodePort = {
      getSession: (threadId) => loadPort().pipe(Effect.flatMap((p) => p.getSession(threadId))),
      createSession: (create) => loadPort().pipe(Effect.flatMap((p) => p.createSession(create))),
      prompt: (prompt) => loadPort().pipe(Effect.flatMap((p) => p.prompt(prompt))),
      log: (follow) => Stream.unwrap(Effect.map(loadPort(), (p) => p.log(follow))),
      subscribe: () => Stream.unwrap(Effect.map(loadPort(), (p) => p.subscribe())),
      messages: (threadId) => loadPort().pipe(Effect.flatMap((p) => p.messages(threadId))),
      interrupt: (threadId) => loadPort().pipe(Effect.flatMap((p) => p.interrupt(threadId))),
      switchModel: (switchModel) =>
        loadPort().pipe(Effect.flatMap((p) => p.switchModel(switchModel))),
      moveSession: (move) => loadPort().pipe(Effect.flatMap((p) => p.moveSession(move))),
      removeSession: (threadId) =>
        loadPort().pipe(Effect.flatMap((p) => p.removeSession(threadId))),
      forkSession: (fork) => loadPort().pipe(Effect.flatMap((p) => p.forkSession(fork))),
      exportSession: (threadId) =>
        loadPort().pipe(Effect.flatMap((p) => p.exportSession(threadId))),
      importSession: (snapshot) =>
        loadPort().pipe(Effect.flatMap((p) => p.importSession(snapshot))),
      compact: (compact) => loadPort().pipe(Effect.flatMap((p) => p.compact(compact))),
      putInstruction: (put) => loadPort().pipe(Effect.flatMap((p) => p.putInstruction(put))),
      removeInstruction: (remove) =>
        loadPort().pipe(Effect.flatMap((p) => p.removeInstruction(remove))),
      models: () => loadPort().pipe(Effect.flatMap((p) => p.models())),
      defaultModel: () => loadPort().pipe(Effect.flatMap((p) => p.defaultModel())),
      providers: () => loadPort().pipe(Effect.flatMap((p) => p.providers())),
      agents: () => loadPort().pipe(Effect.flatMap((p) => p.agents())),
      registerPlugin: (plugin) => loadPort().pipe(Effect.flatMap((p) => p.registerPlugin(plugin))),
    }
    const catalog = new OpenCodeCatalog(port)
    const host: TurnHost = {
      port,
      catalog,
      cursors,
      active,
      bound,
      syncTools: (tools) => syncToolsOf({ editor: () => editor, bound }, managed, tools),
    }

    const stopThread = (threadId: string): Effect.Effect<void, HarnessError> =>
      Effect.gen(function* () {
        const wasActive = active.has(threadId)
        active.delete(threadId)
        bound.delete(threadId)
        if (wasActive) yield* port.interrupt(threadId)
      })

    const fork = (request: HarnessForkRequest): Effect.Effect<void, HarnessError> =>
      Effect.gen(function* () {
        active.delete(request.targetThreadId)
        bound.delete(request.targetThreadId)
        cursors.delete(request.targetThreadId)
        yield* port.removeSession(request.targetThreadId)
        yield* forkThread(port, request)
      })

    const health = (): Effect.Effect<HarnessHealth, HarnessError> =>
      Effect.matchEffect(loadPort(), {
        onFailure: (cause) => Effect.succeed({ status: 'unknown', message: cause.message }),
        onSuccess: () => catalog.health(),
      })

    const service = defineHarness({
      meta: { id: 'opencode', label: 'OpenCode', icon: 'sparkles' },
      capabilities: {
        modelListing: true,
        streaming: true,
        tools: true,
        images: false,
        reasoning: false,
        // The embedded store outlives the host process, so a restarted oru
        // resumes the thread where it was; the first turn replays one log.
        sessionRestore: true,
        // OpenCode's session is the model's memory after a single seed.
        ownsHistory: true,
        steering: 'inject',
        interruption: true,
      },
      listModels: () => catalog.listModels(),
      providers: () => catalog.providers(),
      streamTurn: (request: HarnessTurnRequest) => runTurn(host, request),
      steer: (threadId, text) => steerThread(host, threadId, text),
      abort: (threadId) => abortThread(host, threadId),
      stop: (threadId) => stopThread(threadId),
      discard: (threadId) =>
        discardThread(port, threadId).pipe(
          Effect.andThen(
            Effect.sync(() => {
              active.delete(threadId)
              bound.delete(threadId)
              cursors.delete(threadId)
            }),
          ),
        ),
      fork,
      compact: (request) => compactThread(port, cursors, request),
      health,
      invalidateHealth: () =>
        Effect.gen(function* () {
          if (own !== undefined) {
            yield* Scope.close(own, Exit.void)
            own = undefined
          }
          live = undefined
          openFailure = undefined
          catalog.invalidate()
        }),
    })

    return { service }
  })
