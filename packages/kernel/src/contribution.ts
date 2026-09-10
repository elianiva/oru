import { Data, Predicate } from "effect"
import type { AnyServiceToken, ServiceShape } from "./service.ts"

export interface ContributionKind<C> {
  readonly id: string
  readonly _C?: (c: C) => C
}

export const defineContributionKind = <C>(id: string): ContributionKind<C> => ({ id })

export class ServiceContribution<T extends AnyServiceToken = AnyServiceToken> extends Data.TaggedClass("Service")<{
  readonly token: T
}> {}

export class DataContribution<C = any> extends Data.TaggedClass("Data")<{
  readonly kind: ContributionKind<C>
  readonly value: C
}> {}

export type Contribution = ServiceContribution<any> | DataContribution<any>

export const provide = <T extends AnyServiceToken>(token: T): ServiceContribution<T> =>
  new ServiceContribution({ token })

export const contribute = <C>(kind: ContributionKind<C>, value: C): DataContribution<C> =>
  new DataContribution({ kind, value })

export const isServiceContribution = (c: Contribution): c is ServiceContribution => Predicate.isTagged(c, "Service")

export const isDataContribution = (c: Contribution): c is DataContribution => Predicate.isTagged(c, "Data")

type TokenOf<C> = C extends ServiceContribution<infer T> ? T : never

export type ServiceProvisions<P extends readonly Contribution[]> = ServiceShape<TokenOf<P[number]>>

export const serviceTokensOf = (contributions: readonly Contribution[]): readonly AnyServiceToken[] =>
  contributions.filter(isServiceContribution).map((c) => c.token)

export const dataContributionsOf = (contributions: readonly Contribution[]): readonly DataContribution<any>[] =>
  contributions.filter(isDataContribution)
