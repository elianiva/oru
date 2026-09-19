import { Schema } from 'effect'
import type { UiSignal } from './signals.ts'

/**
 * One function position of the slot protocol, checked with `instanceof`
 * rather than `typeof`: schemas cannot name function-ness any other way.
 * Each position below carries its own predicate so the decoded record
 * already has the loader's and root's shapes — no casts downstream.
 * `unknown` below is the foreign def's own state and messages, which the
 * app stores and forwards without parsing; every occurrence is justified
 * where it stands.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: declare predicates receive untrusted input by contract; init builds foreign state the app never parses
const InitFn = Schema.declare((input: unknown): input is () => unknown => input instanceof Function)
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: update folds foreign state the app never parses; its out-message half is decoded by UiOutMessage at the fold
const UpdateFn = Schema.declare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see InitFn; the result's model is foreign state and its out-message is validated before use
  (input: unknown): input is (model: unknown, message: unknown) => UpdateResult =>
    input instanceof Function,
)
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: views render through the app's own builder; the brand is type-level-only per foldkit's docs
const ViewFn = Schema.declare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see InitFn
  (input: unknown): input is (...args: readonly never[]) => unknown => input instanceof Function,
)
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: props are versioned plain data the def decodes itself; the app forwards them unparsed
const AbsorbFn = Schema.declare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see InitFn
  (input: unknown): input is (model: unknown, props: unknown) => unknown =>
    input instanceof Function,
)
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: signals are the versioned UiSignal union; the app forwards them unparsed
const SignalFn = Schema.declare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see InitFn
  (input: unknown): input is (model: unknown, signal: UiSignal) => unknown =>
    input instanceof Function,
)

export interface UpdateResult {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- SAFETY: the model is foreign state; the fold stores it and decodes only the out-message half
  readonly model: unknown
  readonly outMessage?: unknown
}

/**
 * One validated slot definition from a bundle's `defs` array. The loader
 * decodes this instead of narrowing with `typeof` chains: a record that
 * fails here is a failed outlet, never a broken app. `absorb` and `signal`
 * stay optional so a def that needs neither ships neither.
 */
export const UiDefRecord = Schema.Struct({
  slot: Schema.String,
  defId: Schema.NonEmptyString,
  init: InitFn,
  update: UpdateFn,
  view: ViewFn,
  absorb: Schema.optional(AbsorbFn),
  signal: Schema.optional(SignalFn),
})
export type UiDefRecord = typeof UiDefRecord.Type

export const decodeUiDefRecord = Schema.decodeUnknownOption(UiDefRecord)

/**
 * The functions a loaded def carries, with the slot boundary types the
 * loader and root share.
 */
export interface LoadedDef {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- SAFETY: see InitFn
  readonly init: () => unknown
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see UpdateFn
  readonly update: (model: unknown, message: unknown) => UpdateResult
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- SAFETY: see ViewFn
  readonly view: (...args: readonly never[]) => unknown
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see AbsorbFn
  readonly absorb?: ((model: unknown, props: unknown) => unknown) | undefined
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: see SignalFn
  readonly signal?: ((model: unknown, signal: UiSignal) => unknown) | undefined
}
