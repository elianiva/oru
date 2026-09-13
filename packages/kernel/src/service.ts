import { Context } from 'effect'
import type { TokenId } from './primitives.ts'

// oxlint-disable-next-line typescript/no-explicit-any -- Context.Service identifiers differ from instance types on class tags
export type ServiceToken<S> = Context.Service<any, S>

// oxlint-disable-next-line typescript/no-explicit-any -- mixed plugin graphs erase the service instance parameter
export type AnyServiceToken = ServiceToken<any>

export type ServiceOf<T> =
  T extends Context.Service<infer _Identifier, infer Instance> ? Instance : never

export type IdentifierOf<T> =
  T extends Context.Service<infer Identifier, infer _Instance> ? Identifier : never

export const defineService = <S>(id: string): Context.Service<S, S> => Context.Service<S>(id)

export const serviceId = (token: AnyServiceToken): TokenId => token.key
