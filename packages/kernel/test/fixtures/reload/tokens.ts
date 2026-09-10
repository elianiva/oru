import type { Effect } from 'effect'
import { defineContributionKind, defineService } from '../../../src/index.ts'

export interface EchoService {
  readonly echo: (value: string) => Effect.Effect<string>
}

export const Echo = defineService<EchoService>('oru/facet-echo')

export const Banner = defineContributionKind<{ readonly text: string }>('oru/facet-banner')
