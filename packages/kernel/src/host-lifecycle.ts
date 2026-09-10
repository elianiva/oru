import { Effect, Ref, Semaphore } from 'effect'
import type { HostEvent } from './event.ts'
import type { PluginId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'
import { foldActivePlugins } from './session-fold.ts'
import { appendHostEvent, type SessionLog, type SessionLogError } from './session-log.ts'

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

export const decideHostFact = (
  journalActive: ReadonlySet<PluginId>,
  event: HostEvent,
): RecordDecision => {
  switch (event._tag) {
    case 'PluginActivated': {
      if (journalActive.has(event.plugin)) return { _tag: 'Skip', next: journalActive }
      const next = new Set(journalActive)
      next.add(event.plugin)
      return { _tag: 'Append', next }
    }
    case 'PluginDeactivated': {
      if (!journalActive.has(event.plugin)) return { _tag: 'Skip', next: journalActive }
      const next = new Set(journalActive)
      next.delete(event.plugin)
      return { _tag: 'Append', next }
    }
    case 'ProviderRemoved':
      return { _tag: 'Skip', next: journalActive }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export interface HostFactRecorder {
  readonly record: (event: HostEvent) => Effect.Effect<void, SessionLogError>
}

export const openHostFactRecorder = (
  log: SessionLog,
  initial: ReadonlySet<PluginId>,
): Effect.Effect<HostFactRecorder> =>
  Effect.gen(function* () {
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
    }
  })
