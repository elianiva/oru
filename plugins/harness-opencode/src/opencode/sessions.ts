import { DateTime, Effect, Predicate, Stream } from 'effect'
import { Agent } from '@opencode/schema/agent'
import { Model } from '@opencode/schema/model'
import { Money } from '@opencode/schema/money'
import { Project } from '@opencode/schema/project'
import { Session } from '@opencode/schema/session'
import { SessionMessage } from '@opencode/schema/session-message'
import type { TokenUsage } from '@opencode/schema/token-usage'
import { AbsolutePath } from '@opencode/schema/schema'
import { Provider } from '@opencode/schema/provider'
import {
  type HarnessCompactRequest,
  type HarnessCompaction,
  type HarnessError,
  type HarnessForkRequest,
  type HistoryItem,
} from '@oru/harness'
import { executionFailed, malformedHistory, unsupportedOperation } from './errors.ts'
import type { OpenCodePort } from './port.ts'
import { seedMessages } from './seed.ts'
import { TurnTranslator } from './translate.ts'

/**
 * Identity and lifecycle over the port: one OpenCode session per oru thread,
 * seeded exactly once from the runtime's history, then authoritative.
 *
 * The seed goes through `session.import`, which conflicts with an id that
 * already exists, so a miss imports first and never creates-then-imports. An
 * empty seed (a fresh thread, or a history holding only the prompt being sent)
 * creates instead: there is nothing to import and no reason to write a copy.
 */

export interface EnsureInput {
  readonly threadId: string
  readonly cwd: string
  readonly history: readonly HistoryItem[]
  readonly model?: Model.Ref | undefined
  readonly agent?: Agent.ID | undefined
}

export interface EnsuredSession {
  readonly info: Session.Info
  /** True when this call imported or created the session. */
  readonly fresh: boolean
}

export const ensureSession = (
  port: OpenCodePort,
  input: EnsureInput,
): Effect.Effect<EnsuredSession, HarnessError> =>
  Effect.gen(function* () {
    const existing = yield* port.getSession(input.threadId)
    if (existing !== undefined) return { info: existing, fresh: false }
    const trailing = input.history[input.history.length - 1]
    if (trailing === undefined || trailing.type !== 'user_message')
      return yield* Effect.fail(malformedHistory())
    const seed = seedMessages(input.history.slice(0, -1), yield* seedContext(port, input.model))
    if (seed.length === 0) {
      const threadId = input.threadId
      const cwd = input.cwd
      return {
        info: yield* input.model === undefined
          ? port.createSession({ threadId, cwd })
          : port.createSession({ threadId, cwd, model: input.model }),
        fresh: true,
      }
    }
    const now = DateTime.makeUnsafe(Date.now())
    const directory = AbsolutePath.make(input.cwd)
    // SAFETY: the seed writes a fresh session under the thread's own id; the brand records the thread-to-session identity without parsing the oru key.
    const seedID = input.threadId as Session.ID
    const seedInfo = {
      id: seedID,
      // Resolved from the import location, never read from here; the
      // schema keeps the key, so the seed carries a marked placeholder.
      projectID: Project.ID.make('oru'),
      cost: Money.USD.make(0),
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      } satisfies TokenUsage.Info,
      time: { created: now, updated: now },
      location: { directory },
    }
    const seedLocation = { directory }
    return {
      info: yield* input.model === undefined
        ? port.importSession({ info: seedInfo, messages: seed, location: seedLocation })
        : port.importSession({
            info: { ...seedInfo, model: input.model },
            messages: seed,
            location: seedLocation,
          }),
      fresh: true,
    }
  })

/**
 * The agent a seeded message claims. The session has no agent yet, so the
 * seed names the workspace's builder when it has one, else its first agent:
 * the value is provenance on replayed messages, not a selection.
 */
const seedContext = (
  port: OpenCodePort,
  model: Model.Ref | undefined,
): Effect.Effect<{ readonly agent: Agent.ID; readonly model: Model.Ref }, HarnessError> =>
  Effect.gen(function* () {
    const agents = yield* port.agents()
    const found = agents.data.find((candidate) => candidate.id === 'build') ?? agents.data[0]
    const agent = found === undefined ? Agent.ID.make('build') : found.id
    const fallback: Model.Ref = {
      id: Model.ID.make('seed'),
      providerID: Provider.ID.make('seed'),
    }
    return {
      agent,
      model: model ?? fallback,
    }
  })

/** Move the session when the thread's directory changed underneath it. */
export const syncDirectory = (
  port: OpenCodePort,
  info: Session.Info,
  cwd: string,
): Effect.Effect<void, HarnessError> =>
  info.location.directory === cwd
    ? Effect.void
    : port.moveSession({ threadId: info.id, directory: cwd })

/** Point the session at the turn's model when it names a different one. */
export const syncModel = (
  port: OpenCodePort,
  info: Session.Info,
  model: Model.Ref | undefined,
): Effect.Effect<void, HarnessError> => {
  if (model === undefined) return Effect.void
  const current = info.model
  if (
    current !== undefined &&
    current.providerID === model.providerID &&
    current.id === model.id &&
    current.variant === model.variant
  ) {
    return Effect.void
  }
  return port.switchModel({ threadId: info.id, model })
}

/**
 * Thread instructions ride one stable entry: written when the turn carries
 * them, removed when it does not, so a cleared instruction cannot linger.
 */
export const syncInstructions = (
  port: OpenCodePort,
  threadId: string,
  instructions: string | undefined,
): Effect.Effect<void, HarnessError> =>
  instructions === undefined
    ? port.removeInstruction({ threadId, key: 'oru' })
    : port.putInstruction({ threadId, key: 'oru', content: instructions })

/** Release a thread's session and forget it; missing is already gone. */
export const discardThread = (
  port: OpenCodePort,
  threadId: string,
): Effect.Effect<void, HarnessError> => port.removeSession(threadId)

/**
 * Copy the source thread's session into the target thread at a checkpoint: a
 * `msg_…` id, our opaque checkpoint format, or the newest message when absent.
 * The target keeps lineage through `info.fork` and takes the request's cwd
 * when it names one; `parentID` is dropped because the parent may be gone and
 * the import would fail on a dangling pointer.
 */
export const forkThread = (
  port: OpenCodePort,
  request: HarnessForkRequest,
): Effect.Effect<void, HarnessError> =>
  Effect.gen(function* () {
    const source = yield* port.getSession(request.sourceThreadId)
    if (source === undefined) {
      return yield* Effect.fail(
        executionFailed(`no session for thread ${request.sourceThreadId}`, false),
      )
    }
    const snapshot = yield* port.exportSession(request.sourceThreadId)
    const messages = snapshot.messages
    const checkpoint = request.checkpoint
    const kept =
      checkpoint === undefined
        ? messages
        : messages.slice(0, messages.findIndex((message) => message.id === checkpoint) + 1)
    if (kept.length === 0) {
      return yield* Effect.fail(
        executionFailed(
          checkpoint === undefined
            ? `thread ${request.sourceThreadId} is empty, so there is nothing to fork`
            : `checkpoint ${checkpoint} is not in thread ${request.sourceThreadId}`,
          false,
        ),
      )
    }
    const { parentID: _dropped, ...info } = snapshot.info
    const last = kept[kept.length - 1]
    if (last === undefined) {
      return yield* Effect.fail(executionFailed('unreachable: kept is non-empty', false))
    }
    const boundary =
      // SAFETY: a checkpoint is the runtime's opaque cursor into this session's messages; when present it names a message, so the brand records that without re-parsing.
      checkpoint === undefined ? last.id : (checkpoint as SessionMessage.ID)
    const forked = {
      ...info,
      // SAFETY: the target thread's session is created under the target thread's own id; the brand records the thread-to-session identity.
      id: request.targetThreadId as Session.ID,
      fork: {
        sessionID: source.id,
        boundary: {
          type: 'before' as const,
          messageID: boundary,
        },
      },
    }
    if (request.cwd === undefined) {
      yield* port.importSession({ info: forked, messages: kept })
      return
    }
    const directory = AbsolutePath.make(request.cwd)
    yield* port.importSession({
      info: { ...forked, location: { directory } },
      messages: kept,
      location: { directory },
    })
  })

/**
 * Compact the thread's session and read back what it did. Compaction events
 * are durable, so admitting first and following from the cursor still replays
 * the turn's own `compaction.ended`; instructions ride no field on the compact
 * input, and an admitted message would pretend otherwise, so they fail.
 */
export const compactThread = (
  port: OpenCodePort,
  cursors: Map<string, number | undefined>,
  request: HarnessCompactRequest,
): Effect.Effect<HarnessCompaction, HarnessError> =>
  Effect.gen(function* () {
    if (request.instructions !== undefined) {
      return yield* Effect.fail(
        unsupportedOperation('compact instructions have no OpenCode counterpart'),
      )
    }
    const existing = yield* port.getSession(request.threadId)
    if (existing === undefined) {
      return yield* Effect.fail(executionFailed(`no session for thread ${request.threadId}`, false))
    }
    yield* port.compact({ threadId: request.threadId })
    const translator = new TurnTranslator()
    let compaction: HarnessCompaction | undefined
    // The terminal is known only after feeding, so the feed runs in the map
    // and the take ends the stream: the final event is already observed.
    yield* port.log({ threadId: request.threadId, after: cursors.get(request.threadId) }).pipe(
      Stream.mapEffect((event) =>
        Effect.sync(() => {
          if (event.type === 'log.synced') {
            if (event.seq !== undefined) cursors.set(request.threadId, event.seq)
            return false
          }
          for (const out of translator.durable(event)) {
            if (Predicate.isTagged(out, 'CompactionEnded')) {
              compaction = {
                summary: out.summary,
                tokensBefore: out.tokensBefore,
                readFiles: out.readFiles,
                modifiedFiles: out.modifiedFiles,
              }
            }
          }
          return translator.terminal !== undefined || compaction !== undefined
        }),
      ),
      Stream.takeWhile((finished) => !finished),
      Stream.runDrain,
    )
    if (compaction === undefined) {
      return yield* Effect.fail(
        executionFailed(`compacting thread ${request.threadId} reported nothing`, true),
      )
    }
    return compaction
  })
