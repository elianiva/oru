import { Schema } from 'effect'

// The same runtime shape the kernel's DataContribution builds
// (Schema.TaggedStruct('Data', ...)), written with effect directly so the
// fixture imports nothing outside this package's own dependencies. Real
// kernel records are covered by the host's prebuilt-facets test.
const DataContribution = Schema.TaggedStruct('Data', {
  kind: Schema.String,
  value: Schema.Unknown,
})

export const plugin = {
  id: 'fixture',
  provides: [
    DataContribution.make({
      kind: 'oru/ui-submodel',
      value: { slot: 'composer', defId: 'composer', title: 'Composer' },
    }),
    DataContribution.make({
      kind: 'oru/ui-submodel',
      value: { slot: 'conversation', defId: 'conversation', title: 'Conversation' },
    }),
  ],
}

export default plugin
