import { Predicate, Schema } from 'effect'
import type { PluginId } from './primitives.ts'
import type { AnyServiceToken, IdentifierOf } from './service.ts'

export interface ContributionEntry<C> {
  readonly plugin: PluginId
  readonly value: C
}

/**
 * A named family of contribution payloads. The kind owns construction, so a payload
 * can never be paired with a kind it does not belong to.
 */
export interface ContributionKind<C> {
  readonly id: string
  readonly of: (value: C) => DataContribution
}

/** A payload a plugin adds under a kind id. The payload stays opaque. The kind that reads it owns its type, and the kernel never interprets it. */
export const DataContribution = Schema.TaggedStruct('Data', {
  kind: Schema.String,
  value: Schema.Unknown,
})
export type DataContribution = typeof DataContribution.Type

export const defineContributionKind = <C>(id: string): ContributionKind<C> => ({
  id,
  of: (value) => DataContribution.make({ kind: id, value }),
})

/**
 * What a plugin declares in `provides`: a service token whose value its setup returns,
 * or a data payload registered under a kind.
 */
export type Contribution = AnyServiceToken | DataContribution

export type ServiceProvisions<P extends readonly Contribution[]> = IdentifierOf<P[number]>

export const serviceTokensOf = (
  contributions: readonly Contribution[],
): readonly AnyServiceToken[] =>
  contributions.flatMap((contribution) =>
    Predicate.isTagged(contribution, 'Data') ? [] : [contribution],
  )

export const dataContributionsOf = (
  contributions: readonly Contribution[],
): readonly DataContribution[] =>
  contributions.flatMap((contribution) =>
    Predicate.isTagged(contribution, 'Data') ? [contribution] : [],
  )
