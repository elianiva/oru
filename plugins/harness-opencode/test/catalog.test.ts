import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { Model } from '@opencode/schema/model'
import { Provider } from '@opencode/schema/provider'
import { AbsolutePath } from '@opencode/schema/schema'
import type { ModelListOutput } from '@opencode/client/effect/api'
import { OpenCodeCatalog } from '../src/opencode/catalog.ts'
import { stubPort } from './fake.ts'

/**
 * The catalogue mapping, with recorded fixtures.
 *
 * What is proven is the round-trip the picker depends on: an id the bridge
 * hands out parses back into the exact ref `switchModel` needs, a bare name
 * finds its provider, and an unknown name fails as not found instead of
 * guessing. Nothing here opens a session.
 */

const model = (fields: {
  readonly modelID: string
  readonly providerID: string
  readonly name: string
  readonly context: number
}): Model.Info => {
  const base = Model.Info.default(
    Provider.ID.make(fields.providerID),
    Model.ID.make(fields.modelID),
  )
  return { ...base, name: fields.name, limit: { context: fields.context, output: 100 } }
}

const models = [
  model({ modelID: 'opus', providerID: 'acme', name: 'Acme Opus', context: 200_000 }),
  model({ modelID: 'flash', providerID: 'other', name: 'Other Flash', context: 32_000 }),
]

const catalogOf = (defaultModel: Model.Info | undefined = models[0]) => {
  const location: ModelListOutput['location'] = { directory: AbsolutePath.make('/repo') }
  const port = stubPort({
    models: () => Effect.succeed({ location, data: models }),
    defaultModel: () => Effect.succeed(defaultModel),
    providers: () =>
      Effect.succeed({
        location,
        data: [
          {
            id: Provider.ID.make('acme'),
            name: 'Acme',
            activation: 'auto',
            package: '',
          },
          { id: Provider.ID.make('other'), name: '', activation: 'auto', package: '' },
        ],
      }),
  })
  return new OpenCodeCatalog(port)
}

describe('listing', () => {
  it('maps limits and marks the default', async () => {
    expect(await Effect.runPromise(catalogOf().listModels())).toEqual([
      {
        id: 'acme/opus',
        label: 'Acme Opus',
        provider: 'acme',
        contextWindow: 200_000,
        isDefault: true,
      },
      { id: 'other/flash', label: 'Other Flash', provider: 'other', contextWindow: 32_000 },
    ])
  })

  it('names providers, falling back when one names nothing', async () => {
    expect(await Effect.runPromise(catalogOf().providers())).toEqual([
      { id: 'acme', label: 'Acme' },
      { id: 'other', label: 'Other' },
    ])
  })
})

describe('resolving a turn model', () => {
  it('parses a provider-qualified id directly', async () => {
    const ref = await Effect.runPromise(catalogOf().resolveRef('acme/opus'))
    expect({ providerID: ref.providerID, id: ref.id }).toEqual({
      providerID: 'acme',
      id: 'opus',
    })
  })

  it('resolves a bare id against the catalogue', async () => {
    const ref = await Effect.runPromise(catalogOf().resolveRef('flash'))
    expect({ providerID: ref.providerID, id: ref.id }).toEqual({
      providerID: 'other',
      id: 'flash',
    })
  })

  it('fails unknown names instead of guessing a provider', async () => {
    const failure = await Effect.runPromise(Effect.flip(catalogOf().resolveRef('missing')))
    expect(failure.code).toBe('model_not_found')
  })

  it('reads the default and its window for the turn fact', async () => {
    const catalog = catalogOf()
    const ref = await Effect.runPromise(catalog.defaultRef())
    expect(ref === undefined ? undefined : `${ref.providerID}/${ref.id}`).toBe('acme/opus')
    expect(
      await Effect.runPromise(
        catalog.contextWindowFor({
          providerID: Provider.ID.make('other'),
          id: Model.ID.make('flash'),
        }),
      ),
    ).toBe(32_000)
  })
})
