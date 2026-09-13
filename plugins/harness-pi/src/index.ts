import { Context, Effect, Stream } from 'effect'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import { definePlugin, type PluginContext } from '@oru/kernel'
import { defineHarness, Harness, type HarnessService } from '@oru/harness'

/**
 * `harness-pi` — bridge for the pi coding agent.
 *
 * Mirrors `bb`'s provider-bridge pattern but effect-native:
 * - The bridge knows the dialect (pi's `StreamFn` / `AgentEvent` / `AgentContext`)
 * - The runtime (inference) owns the timeline (SessionLog, tool execution)
 *
 * Pi's core primitive (from `~/Development/repos/pi/packages/agent`):
 *   `StreamFn = (model, context) => AssistantMessageEventStream`
 *   `AgentEvent` is the wire protocol; `TurnEvent` is the normalized oru protocol.
 * This harness maps:
 *   HarnessTurnRequest.history (HistoryItem[]) -> pi Context/Message[]
 *   pi AssistantMessageEvent stream          -> Stream<TurnEvent>
 *   harness.steer()                          -> pi getSteeringMessages() injection
 *   harness.abort()                          -> pi AbortSignal / `thread/stop { interrupt }`
 *
 * Like bb's `plugins/provider-pi`, the bridge is a `bb.host`-style export
 * (`experimental_defineProviderBridge`) that the daemon runs in a child process.
 * Here it is a normal oru plugin providing `Harness`.
 *
 * Replace the stubbed `streamTurn` body with a real pi runtime:
 * ```ts
 * import { Agent, StreamFn } from '@earendil-works/pi-agent'
 * const agent = new Agent({ model, context, streamFn })
 * return Stream.fromAsyncIterable(agent.stream(), ...)
 * ```
 */
const makeHarnessPiService = (): HarnessService => {
  const active = new Set<string>()
  const textToTurn = (text: string): Turn.Turn => ({
    items: [Items.assistantText(text)],
    usage: {},
    stop_reason: 'stop',
  })

  return defineHarness({
    meta: { id: 'pi', label: 'Pi (pi coding agent)', icon: 'pi' },
    capabilities: {
      modelListing: true,
      streaming: true,
      tools: true,
      images: false,
      reasoning: false,
      sessionRestore: false,
      // pi's AgentLoopConfig.getSteeringMessages supports mid-turn injection -> 'inject'
      steering: 'inject',
      interruption: true,
    },
    listModels: () =>
      Effect.succeed([
        { id: 'pi-default', label: 'Pi default', provider: 'pi', contextWindow: 200_000 },
      ]),
    streamTurn: (request) => {
      active.add(request.threadId)
      // TODO: wire to pi's real StreamFn / Agent. This stub demonstrates the
      // shape: HistoryItem -> pi Context conversion happens here, and the pi
      // AssistantMessageEvent stream is mapped to TurnEvent.
      return Stream.make(
        Turn.TurnEvent.TextDelta({ text: `[pi:${request.model}] stub response` }),
        Turn.TurnEvent.TurnComplete({ turn: textToTurn(`[pi:${request.model}] stub response`) }),
      ).pipe(Stream.ensuring(Effect.sync(() => active.delete(request.threadId))))
    },
    steer: (threadId, text) =>
      Effect.sync(() => {
        void threadId
        void text
        // Forward to pi's steering queue (Agent.getSteeringMessages)
      }),
    abort: (threadId) => Effect.sync(() => active.delete(threadId)),
    health: () => Effect.succeed({ ok: true }),
  })
}

const setup = (_ctx: PluginContext<readonly []>) =>
  Effect.succeed(Context.make(Harness, makeHarnessPiService()))

export const harnessPiPlugin = definePlugin({
  id: 'oru/harness-pi',
  provides: [Harness],
  server: { setup },
})

export const makeHarnessPiServiceFactory = makeHarnessPiService
