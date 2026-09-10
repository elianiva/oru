import { Effect, Match, Ref, Semaphore } from 'effect'
import type { HostEvent } from './event.ts'
import type { PluginId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'
import { foldActivePlugins } from './session-fold.ts'
import { appendHostEvent, type SessionLogContract, type SessionLogError } from './session-log.ts'

export interface LifecycleState {
  readonly desired: ReadonlySet<PluginId>
  readonly journalActive: ReadonlySet<PluginId>
}

export type RecordDecision =
  | { readonly _tag: 'Skip'; readonly next: ReadonlySet<PluginId> }
  | { readonly _tag: 'Append'; readonly next: ReadonlySet<PluginId> }

export const recoverLifecycle = (
  entries: readonly SessionEvent[],
  known: ReadonlySet<PluginId>,
): LifecycleState => {
  const journalActive = foldActivePlugins(entries)
  const replaying = entries.some(
    (event) => event._tag === 'plugin/activated' || event._tag === 'plugin/deactivated',
  )
  if (replaying) return { desired: journalActive, journalActive }
  return { desired: known, journalActive }
}

const skip = (next: ReadonlySet<PluginId>): RecordDecision => ({ _tag: 'Skip', next })
const append = (next: ReadonlySet<PluginId>): RecordDecision => ({ _tag: 'Append', next })

export const decideHostFact = (
  journalActive: ReadonlySet<PluginId>,
  event: HostEvent,
): RecordDecision =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      PluginActivated: (event) => {
        if (journalActive.has(event.plugin)) return skip(journalActive)
        return append(new Set(journalActive).add(event.plugin))
      },
      PluginDeactivated: (event) => {
        if (!journalActive.has(event.plugin)) return skip(journalActive)
        const next = new Set(journalActive)
        next.delete(event.plugin)
        return append(next)
      },
      ProviderRemoved: () => skip(journalActive),
    }),
  )

export interface HostFactRecorder {
  readonly record: (event: HostEvent) => Effect.Effect<void, SessionLogError>
}

export const openHostFactRecorder = Effect.fnUntraced(function* (
  log: SessionLogContract,
  initial: ReadonlySet<PluginId>,
) {
  const active = yield* Ref.make(initial)
  const lock = Semaphore.makeUnsafe(1)
  return {
    record: (event: HostEvent) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(active)
          const decision = decideHostFact(current, event)
          if (decision._tag === 'Append') yield* appendHostEvent(log, event)
          yield* Ref.set(active, decision.next)
        }),
      ),
  } satisfies HostFactRecorder
})
