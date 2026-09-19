import { Schema } from 'effect'

/**
 * The intents a composer def announces, as wire data. Root decodes these
 * instead of casting: a def newer than the app may announce tags this union
 * does not know, and those fail closed to an ignored no-op rather than a
 * crash. Additive-only within a major, like the props.
 */
export const UiSubmitted = Schema.TaggedStruct('Submitted', {
  project: Schema.optional(Schema.NonEmptyString),
  harness: Schema.UndefinedOr(Schema.String),
  model: Schema.UndefinedOr(Schema.String),
  reasoning: Schema.UndefinedOr(Schema.String),
  text: Schema.NonEmptyString,
})
export const UiOptionsRequested = Schema.TaggedStruct('OptionsRequested', {
  refresh: Schema.Boolean,
})
export const UiConfigureRequested = Schema.TaggedStruct('ConfigureRequested', {
  harness: Schema.UndefinedOr(Schema.String),
  model: Schema.UndefinedOr(Schema.String),
  reasoning: Schema.UndefinedOr(Schema.String),
})
export const UiCopyRequested = Schema.TaggedStruct('CopyRequested', {
  command: Schema.String,
})
export const UiRequestedCreateDialog = Schema.TaggedStruct('RequestedCreateDialog', {})

export const UiOutMessage = Schema.Union([
  UiSubmitted,
  UiOptionsRequested,
  UiConfigureRequested,
  UiCopyRequested,
  UiRequestedCreateDialog,
])
export type UiOutMessage = typeof UiOutMessage.Type

export const decodeUiOutMessage = Schema.decodeUnknownOption(UiOutMessage)
