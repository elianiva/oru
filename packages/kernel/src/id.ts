import { Clock, Effect, Random } from 'effect'

/** A unique id from the clock and a random draw, for facts that need a name. */
export const newId = Effect.fnUntraced(function* () {
  const now = yield* Clock.currentTimeMillis
  const n = yield* Random.next
  return `${now.toString(36)}-${n.toString(36).slice(2, 10)}`
})
