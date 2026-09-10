import { Data, Predicate } from 'effect'
import type { PluginId } from './primitives.ts'
import type { AnyServiceToken, ServiceOf } from './service.ts'

export interface ContributionEntry<C> {
  readonly plugin: PluginId
  readonly value: C
}

export interface ContributionKind<C> {
  readonly id: string
  readonly _C?: (c: C) => C
}

export const defineContributionKind = <C>(id: string): ContributionKind<C> => ({ id })

export class ServiceContribution<
  T extends AnyServiceToken = AnyServiceToken,
> extends Data.TaggedClass('Service')<{
  readonly token: T
}> {}

export class DataContribution<
  // oxlint-disable-next-line typescript/no-explicit-any -- contribution lists mix kinds
  C = any,
> extends Data.TaggedClass('Data')<{
  readonly kind: ContributionKind<C>
  readonly value: C
}> {}

// oxlint-disable-next-line typescript/no-explicit-any -- contribution lists mix service tokens and data kinds
export type Contribution = ServiceContribution<any> | DataContribution<any>

export const provide = <T extends AnyServiceToken>(token: T): ServiceContribution<T> =>
  new ServiceContribution({ token })

export const contribute = <C>(kind: ContributionKind<C>, value: C): DataContribution<C> =>
  new DataContribution({ kind, value })

export const isServiceContribution = (c: Contribution): c is ServiceContribution =>
  Predicate.isTagged(c, 'Service')

export const isDataContribution = (c: Contribution): c is DataContribution =>
  Predicate.isTagged(c, 'Data')

type TokenOf<C> = C extends ServiceContribution<infer T> ? T : never

export type ServiceProvisions<P extends readonly Contribution[]> = ServiceOf<TokenOf<P[number]>>

export const serviceTokensOf = (
  contributions: readonly Contribution[],
): readonly AnyServiceToken[] =>
  contributions.flatMap((c) => (isServiceContribution(c) ? [c.token] : []))

export const dataContributionsOf = (
  contributions: readonly Contribution[],
  // oxlint-disable-next-line typescript/no-explicit-any -- callers recover C from ContributionKind
): readonly DataContribution<any>[] => contributions.filter(isDataContribution)
