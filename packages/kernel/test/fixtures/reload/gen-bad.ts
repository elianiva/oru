import { Effect, Schema } from 'effect'
import { definePlugin } from '../../../src/index.ts'

class BadGeneration extends Schema.TaggedError<BadGeneration>()('BadGeneration', {
  message: Schema.String,
}) {}

export default definePlugin({
  id: 'facet-echo',
  apply: () => Effect.fail(new BadGeneration({ message: 'bad generation' })),
})
