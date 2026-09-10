import { Context } from "effect"
import type { TokenId } from "./primitives.ts"

export type ServiceToken<S> = Context.Service<S, S>

export type AnyServiceToken = ServiceToken<any>

export type ServiceShape<T> = Context.Service.Shape<T>

export const defineService = <S>(id: string): ServiceToken<S> => Context.Service<S>(id)

export const serviceId = (token: AnyServiceToken): TokenId => token.key
