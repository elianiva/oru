import { Effect, Schema } from 'effect'
import { BundleAddress, NamedProject, PluginId, SessionEvent, ThreadConfig } from '@oru/kernel'
import { HarnessHealth, ModelInfo, ProviderInfo } from '@oru/harness'
import type { SlotId } from './slots.ts'

/** A harness a thread can pick, with the state it is in (ADR-0007). */
export const HarnessChoice = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.String,
  /** The harness's glyph: a lowercase Lucide key the app resolves. */
  icon: Schema.optionalKey(Schema.String),
  health: HarnessHealth,
})
export type HarnessChoice = typeof HarnessChoice.Type

export const ThreadOptions = Schema.Struct({
  config: ThreadConfig,
  /**
   * The harness these options describe: the configured one, or the host's
   * default for a thread that names none. Absent means no active harness.
   */
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  harnesses: Schema.Array(HarnessChoice),
  /**
   * The active harness's providers, in catalogue order; empty when it names none.
   *
   * Decoded with a default because a host predating provider metadata answers
   * without the key, and the picker must read that answer rather than fail it
   * (`Missing key at ["value"]["providers"]` on first open). The host always
   * encodes the key, so the seam stays exact going forward.
   */
  providers: Schema.Array(ProviderInfo).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** The catalogue of that harness, empty when it cannot answer for one. */
  models: Schema.Array(ModelInfo),
})
export type ThreadOptions = typeof ThreadOptions.Type

/**
 * One built UI bundle, as the host serves it: which definition it carries,
 * where the app fetches the code, and which SDK major built it. The app
 * skips a bundle whose major is not `UI_SDK_MAJOR` with a note.
 */
export const UiBundleDescriptor = Schema.Struct({
  plugin: PluginId,
  defId: Schema.NonEmptyString,
  slot: Schema.String,
  address: BundleAddress,
  jsUrl: Schema.String,
  sdkMajor: Schema.Number,
})
export type UiBundleDescriptor = typeof UiBundleDescriptor.Type

export const UiAssignmentState = Schema.Struct({
  slot: Schema.String,
  plugin: PluginId,
  defId: Schema.NonEmptyString,
})
export type UiAssignmentState = typeof UiAssignmentState.Type

/**
 * What a presentation facet mirrors: the bundles it can fetch and the
 * resolved assignments it renders. A snapshot to start from, a stream that
 * keeps it current — the same shape as the graph seam (ADR-0004).
 */
export const UiSnapshot = Schema.Struct({
  bundles: Schema.Array(UiBundleDescriptor),
  assignments: Schema.Array(UiAssignmentState),
})
export type UiSnapshot = typeof UiSnapshot.Type

export const emptyUiSnapshot: UiSnapshot = { bundles: [], assignments: [] }

/**
 * The submit intent chat-ui owns end to end (ADR-0020 Q15). The composer's
 * picks travel with the text, so root executes the command without reading
 * picker submodels it no longer holds. Plain data across the boundary.
 */
export const WorkspaceChoice = Schema.Struct({
  path: Schema.NonEmptyString,
  branch: Schema.UndefinedOr(Schema.String),
  isCurrent: Schema.Boolean,
  provider: Schema.NonEmptyString,
})
export type WorkspaceChoice = typeof WorkspaceChoice.Type

export const SubmitIntent = Schema.Struct({
  project: Schema.optional(Schema.NonEmptyString),
  harness: Schema.UndefinedOr(Schema.String),
  model: Schema.UndefinedOr(Schema.String),
  reasoning: Schema.UndefinedOr(Schema.String),
  cwd: Schema.optional(Schema.String),
  text: Schema.NonEmptyString,
})
export type SubmitIntent = typeof SubmitIntent.Type

export const ComposerOptionsLoading = Schema.TaggedStruct('Loading', {})
export const ComposerOptionsLoaded = Schema.TaggedStruct('Loaded', {
  options: ThreadOptions,
})
export const ComposerOptionsUnreachable = Schema.TaggedStruct('Unreachable', {
  reason: Schema.String,
})
export const ComposerOptions = Schema.Union([
  ComposerOptionsLoading,
  ComposerOptionsLoaded,
  ComposerOptionsUnreachable,
])
export type ComposerOptions = typeof ComposerOptions.Type

/**
 * Per-slot props, versioned additive-only within a major (bb's rule from
 * Q8). Plain data only: `viewInputs` rejects handler-carrying vnodes
 * across the boundary, so everything a def renders arrives as facts.
 */
export const ComposerProps = Schema.Struct({
  headline: Schema.optional(Schema.String),
  placeholder: Schema.String,
  threadId: Schema.optional(Schema.String),
  projects: Schema.Array(NamedProject),
  projectsLoading: Schema.Boolean,
  options: ComposerOptions,
  workspaces: Schema.Array(WorkspaceChoice),
})
export type ComposerProps = typeof ComposerProps.Type

export const ConversationProps = Schema.Struct({
  threadId: Schema.optional(Schema.String),
  events: Schema.Array(SessionEvent),
  pending: Schema.Boolean,
})
export type ConversationProps = typeof ConversationProps.Type

/**
 * Props for the additive `panel` slot (terminal-ghostty first).
 * One def (`terminal`) renders N tab instances: root instantiates one
 * outlet per open tab with distinct `sessionId`/`projectId` props.
 * Flush layout: the tab owns the full content region (definite height,
 * no host scroll), like bb's `threadPanelAction` flush tabs.
 */
export const PanelProps = Schema.Struct({
  sessionId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  /**
   * The session's advertised WS path (`/pty/<id>`) or full URL. The tab
   * prefers it over deriving one, so one construction site owns the URL.
   */
  wsUrl: Schema.optional(Schema.String),
})
export type PanelProps = typeof PanelProps.Type

export const propsOfSlot = (
  slot: SlotId,
): typeof ComposerProps | typeof ConversationProps | typeof PanelProps =>
  slot === 'composer' ? ComposerProps : slot === 'panel' ? PanelProps : ConversationProps
