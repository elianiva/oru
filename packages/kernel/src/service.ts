import { Context } from 'effect'
import type { TokenId } from './primitives.ts'

export type ServiceToken<S> = Context.Service<S, S>

// oxlint-disable-next-line typescript/no-explicit-any -- mixed plugin graphs erase the service instance parameter
export type AnyServiceToken = ServiceToken<any>

export type ServiceOf<T> =
  T extends Context.Service<infer _Identifier, infer Instance> ? Instance : never

export const defineService = <S>(id: string): ServiceToken<S> => Context.Service<S>(id)

export const serviceId = (token: AnyServiceToken): TokenId => token.key
