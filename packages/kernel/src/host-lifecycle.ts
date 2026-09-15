import { Effect, Match, Ref, Schema, Semaphore } from 'effect'
import type { HostEvent } from './event.ts'
import { PluginId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'
import { foldActivePlugins } from './session-fold.ts'
import { appendHostEvent, type SessionLogContract, type SessionLogError } from './session-log.ts'

export interface LifecycleState {
  readonly desired: ReadonlySet<PluginId>
  readonly journalActive: ReadonlySet<PluginId>
}

const PluginIds = Schema.declare((u): u is ReadonlySet<PluginId> => u instanceof Set)

export const Skip = Schema.TaggedStruct('Skip', {
  next: PluginIds,
})
export const Append = Schema.TaggedStruct('Append', {
  next: PluginIds,
})
export const RecordDecision = Schema.Union([Skip, Append])
export type RecordDecision = typeof RecordDecision.Type

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

export const decideHostFact = (
  journalActive: ReadonlySet<PluginId>,
  event: HostEvent,
): RecordDecision =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      PluginActivated: (event) => {
        if (event.scope === 'thread') return Skip.make({ next: journalActive })
        if (journalActive.has(event.plugin)) return Skip.make({ next: journalActive })
        return Append.make({ next: new Set(journalActive).add(event.plugin) })
      },
      PluginDeactivated: (event) => {
        if (event.scope === 'thread') return Skip.make({ next: journalActive })
        if (!journalActive.has(event.plugin)) return Skip.make({ next: journalActive })
        const next = new Set(journalActive)
        next.delete(event.plugin)
        return Append.make({ next })
      },
      ProviderRemoved: () => Skip.make({ next: journalActive }),
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
