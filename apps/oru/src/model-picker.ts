/**
 * The harness a thread runs on, and the model it runs.
 *
 * The harness is a fact: a host registers its own list, and the thread was
 * configured to one of them, so this renders which one and how healthy it is
 * rather than offering a choice. The model is a choice, drawn from that
 * harness's catalogue as one flat list, which is too large to be a `<select>`.
 * When a harness is not ready its diagnosis and install command are rendered
 * to copy; oru reports that command and never runs it (ADR-0007).
 */
import { Effect, Option, Predicate, Schema, Stream } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import { Check, Terminal } from 'lucide'
import type { ModelInfo } from '@oru/harness'
import { HarnessChoice, ThreadOptions } from '@oru/rpc'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { Command } from '@/components/ui/command.ts'
import { icon, resolveIcon } from '@/lib/icons.ts'
import { providerDisplayOf } from '@/lib/provider-icons.ts'
import { pickerAnchor, pickerPanel, pickerTrigger } from './picker-panel.ts'

export const Loading = Schema.TaggedStruct('Loading', {})
export const Loaded = Schema.TaggedStruct('Loaded', { options: ThreadOptions })
export const Unreachable = Schema.TaggedStruct('Unreachable', { reason: Schema.String })

export const Options = Schema.Union([Loading, Loaded, Unreachable])
export type Options = typeof Options.Type

export const Model = Schema.Struct({
  isOpen: Schema.Boolean,
  query: Schema.String,
  options: Options,
  selection: Schema.Struct({
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  }),
  copied: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Opened: {},
  Closed: {},
  ChangedQuery: { value: Schema.String },
  OptionsArrived: { options: ThreadOptions },
  OptionsFailed: { reason: Schema.String },
  ChosenModel: { model: Schema.String },
  ChosenReasoning: { level: Schema.String },
  RequestedRefresh: {},
  RequestedCopy: { command: Schema.String },
  CopiedCommand: {},
  CopyFailed: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  OptionsRequested: { refresh: Schema.Boolean },
  ConfigureRequested: {
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  },
  CopyRequested: { command: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

/**
 * What survives a page refresh: the chosen model with its reasoning level.
 * Open state, search text, and copy feedback are transient and always
 * restart closed and empty.
 * The harness itself is a host fact, never a stored choice.
 *
 * Stored the way bb stores its promptbox preferences (`bb.promptbox.provider`,
 * per-provider `bb.promptbox.model-*` / `bb.promptbox.reasoning-*`): one
 * versioned JSON document in `localStorage`, decoded through a schema the
 * way the shell reads `oru.shell.layout`, so a hand-edited value falls back
 * to unset. A document from a newer writer is never overwritten. A denied
 * or full storage never breaks the picker; the host remains the source of
 * truth.
 */
export const PICKER_STORAGE_KEY = 'oru.model-picker'
export const PICKER_STORAGE_VERSION = 1

export type StoredPickerPreferences = Readonly<{
  model: string | undefined
  reasoning: string | undefined
}>

/**
 * The versioned document in storage; absent members read as unset. Older
 * documents may still carry an `activeProvider` tab, which now reads as
 * unset: the catalogue is one flat list.
 */
const StoredDocument = Schema.Struct({
  version: Schema.Literal(PICKER_STORAGE_VERSION),
  activeProvider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  reasoning: Schema.optionalKey(Schema.String),
})

/** A newer writer's document reads only as a version, never as preferences. */
const VersionProbe = Schema.Struct({ version: Schema.Number })

const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(StoredDocument))
const decodeVersion = Schema.decodeUnknownOption(Schema.fromJsonString(VersionProbe))

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value

export const readStoredPreferences = (): StoredPickerPreferences | null => {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(PICKER_STORAGE_KEY)
  if (raw === null) return null
  const decoded = decodeStored(raw)
  if (Option.isNone(decoded)) return null
  return {
    model: nonEmpty(decoded.value.model),
    reasoning: nonEmpty(decoded.value.reasoning),
  }
}

const writeStoredPreferences = (prefs: StoredPickerPreferences): Effect.Effect<void> =>
  Effect.sync(() => {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(PICKER_STORAGE_KEY)
    const probed = raw === null ? Option.none() : decodeVersion(raw)
    // A document from a newer writer keeps its shape; overwriting it would
    // drop preferences this version does not know.
    if (Option.isSome(probed) && probed.value.version > PICKER_STORAGE_VERSION) return
    localStorage.setItem(
      PICKER_STORAGE_KEY,
      JSON.stringify({
        version: PICKER_STORAGE_VERSION,
        model: prefs.model,
        reasoning: prefs.reasoning,
      }),
    )
    // A denied or full storage throws; the catcher below turns it into a
    // no-op so persistence never breaks the picker.
  }).pipe(Effect.catchDefect(() => Effect.void))

/**
 * The picker state worth keeping, or `None` while nothing is set so an
 * untouched picker writes nothing over a document it never read.
 */
export const storablePreferences = (model: Model): Option.Option<StoredPickerPreferences> => {
  const prefs: StoredPickerPreferences = {
    model: model.selection.model,
    reasoning: model.selection.reasoning,
  }
  return prefs.model === undefined && prefs.reasoning === undefined
    ? Option.none()
    : Option.some(prefs)
}

const StoredPreferencesSchema = Schema.Struct({
  model: Schema.UndefinedOr(Schema.String),
  reasoning: Schema.UndefinedOr(Schema.String),
})

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  preferencesMirror: entry(
    { storable: Schema.Option(StoredPreferencesSchema) },
    {
      modelToDependencies: (model) => ({ storable: storablePreferences(model) }),
      dependenciesToStream: ({ storable }) =>
        Stream.callback<Message>(() =>
          Option.match(storable, {
            onNone: () => Effect.void,
            onSome: (prefs) => writeStoredPreferences(prefs),
          }).pipe(Effect.flatMap(() => Effect.never)),
        ),
    },
  ),
}))

export const init = (): Model => {
  const stored = readStoredPreferences()
  return {
    isOpen: false,
    query: '',
    options: Loading.make({}),
    selection: {
      harness: undefined,
      model: stored?.model,
      reasoning: stored?.reasoning,
    },
    copied: false,
  }
}

/** The host's answer, once one has arrived. */
export const loadedOptions = (model: Model): ThreadOptions | undefined =>
  Schema.is(Loaded)(model.options) ? model.options.options : undefined

/** The harness these options describe, with the health it was reported with. */
export const activeHarness = (options: ThreadOptions): HarnessChoice | undefined =>
  options.harnesses.find((choice) => choice.id === options.harness)

/** The catalogue narrowed to a search term matched against id and label. */
export const matchingModels = (
  models: ReadonlyArray<ModelInfo>,
  query: string,
): ReadonlyArray<ModelInfo> => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return models
  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(needle) || (model.label ?? '').toLowerCase().includes(needle),
  )
}

/**
 * The model the reasoning levels belong to: the chosen one, or the harness's
 * own default while nothing is chosen.
 */
export const effectiveModel = (
  models: ReadonlyArray<ModelInfo>,
  selection: Model['selection'],
): ModelInfo | undefined =>
  models.find((model) => model.id === selection.model) ??
  models.find((model) => model.isDefault === true) ??
  models[0]

/** What the composer calls the chosen model, once a catalogue names it. */
export const selectionLabel = (model: Model): string | undefined => {
  const id = model.selection.model
  if (id === undefined) return undefined
  const chosen = loadedOptions(model)?.models.find((choice) => choice.id === id)
  return chosen === undefined ? undefined : (chosen.label ?? chosen.id)
}

export const update = (
  model: Model,
  message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    Opened: () => {
      const opened = evo(model, { isOpen: () => true })
      if (!Predicate.isTagged(model.options, 'Loading')) return { model: opened }
      return {
        model: opened,
        outMessage: OutMessage.OptionsRequested({ refresh: false }),
      }
    },
    Closed: () => ({ model: evo(model, { isOpen: () => false, query: () => '' }) }),
    ChangedQuery: ({ value }) => ({ model: evo(model, { query: () => value }) }),
    OptionsArrived: ({ options }) => {
      return {
        model: evo(model, {
          options: () => Loaded.make({ options }),
          selection: () => ({
            harness: options.harness,
            // The host names the thread's own choice; a thread that names
            // none (home) keeps the stored one instead of clearing it, so a
            // refresh lands on the last choice rather than no choice.
            model: options.config.model ?? model.selection.model,
            // Reasoning follows the model it belongs to: a host choice
            // carries its own level, a stored choice keeps its own.
            reasoning:
              options.config.model !== undefined
                ? options.config.reasoning
                : model.selection.reasoning,
          }),
          copied: () => false,
        }),
      }
    },
    OptionsFailed: ({ reason }) => ({
      model: evo(model, { options: () => Unreachable.make({ reason }) }),
    }),
    ChosenModel: ({ model: chosen }) => ({
      model: evo(model, {
        selection: () => ({ ...model.selection, model: chosen }),
        isOpen: () => false,
        query: () => '',
      }),
      outMessage: OutMessage.ConfigureRequested({
        harness: model.selection.harness,
        model: chosen,
        reasoning: model.selection.reasoning,
      }),
    }),
    ChosenReasoning: ({ level }) => ({
      model: evo(model, { selection: () => ({ ...model.selection, reasoning: level }) }),
      outMessage: OutMessage.ConfigureRequested({
        harness: model.selection.harness,
        model: model.selection.model,
        reasoning: level,
      }),
    }),
    RequestedRefresh: () => ({
      model: evo(model, { options: () => Loading.make({}) }),
      outMessage: OutMessage.OptionsRequested({ refresh: true }),
    }),
    RequestedCopy: ({ command }) => ({
      model,
      outMessage: OutMessage.CopyRequested({ command }),
    }),
    CopiedCommand: () => ({ model: evo(model, { copied: () => true }) }),
    CopyFailed: () => ({ model }),
  })

const harnessFact = (options: ThreadOptions, h: HtmlBuilder<Message>): Html => {
  const choice = activeHarness(options)
  return h.div(
    [h.DataAttribute('harness-fact', ''), h.Class('flex items-center gap-2')],
    [
      icon(h, resolveIcon(choice?.icon) ?? Terminal, 'size-4 shrink-0 text-muted-foreground'),
      h.span(
        [h.DataAttribute('harness-label', ''), h.Class('text-sm text-muted-foreground')],
        [choice?.label ?? options.harness ?? 'No harness'],
      ),
      ...(choice === undefined
        ? []
        : [
            h.span(
              [h.DataAttribute('harness-status', choice.health.status)],
              [
                badge(
                  { variant: choice.health.status === 'ready' ? 'secondary' : 'destructive' },
                  [choice.health.status],
                  h,
                ),
              ],
            ),
          ]),
    ],
  )
}

const healthNote = (choice: HarnessChoice, copied: boolean, h: HtmlBuilder<Message>): Html => {
  const { health } = choice
  return h.div(
    [
      h.DataAttribute('harness-note', ''),
      h.Class('flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3'),
    ],
    [
      h.div(
        [h.Class('flex flex-wrap items-center gap-2')],
        [
          h.span(
            [h.DataAttribute('harness-note-status', ''), h.Class('text-sm font-medium')],
            [health.status],
          ),
          ...(health.message === undefined
            ? []
            : [
                h.span(
                  [h.DataAttribute('harness-message', ''), h.Class('text-sm')],
                  [health.message],
                ),
              ]),
          button(
            {
              onClick: Message.RequestedRefresh(),
              variant: 'outline',
              size: 'sm',
              attributes: [h.DataAttribute('harness-refresh', '')],
            },
            'Re-check',
            h,
          ),
        ],
      ),
      ...(health.installCommand === undefined
        ? []
        : [
            h.div(
              [h.Class('flex min-w-0 items-center gap-2')],
              [
                h.code(
                  [
                    h.DataAttribute('harness-install', ''),
                    h.Class('min-w-0 flex-1 font-mono text-xs break-all'),
                  ],
                  [health.installCommand],
                ),
                button(
                  {
                    onClick: Message.RequestedCopy({ command: health.installCommand }),
                    variant: 'outline',
                    size: 'sm',
                    attributes: [h.DataAttribute('harness-copy', '')],
                  },
                  copied ? 'Copied' : 'Copy',
                  h,
                ),
              ],
            ),
          ]),
    ],
  )
}

/** Section headings (`Model` groups, `Reasoning`): quiet labels, not pills. */
const sectionHeadingClass =
  'px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'

const modelRow = (choice: ModelInfo, model: Model, h: HtmlBuilder<Message>): Html => {
  const isChosen = choice.id === model.selection.model
  return Command.item(
    {
      isSelected: isChosen,
      isChecked: isChosen,
      className: 'cursor-pointer rounded-md px-2 py-2 hover:bg-accent hover:text-accent-foreground',
      attributes: [
        h.DataAttribute('model-row', choice.id),
        h.OnClick(Message.ChosenModel({ model: choice.id })),
      ],
    },
    [
      h.div(
        [h.Class('flex min-w-0 flex-1 flex-col gap-0.5')],
        [
          h.span(
            [h.Class('truncate text-sm leading-tight font-medium')],
            [choice.label ?? choice.id],
          ),
          h.span(
            [h.Class('truncate font-mono text-[11px] leading-tight text-muted-foreground')],
            [choice.id],
          ),
        ],
      ),
      ...(choice.isDefault === true
        ? [badge({ variant: 'outline', className: 'shrink-0' }, ['Default'], h)]
        : []),
      ...(isChosen ? [icon(h, Check, 'size-4 shrink-0 text-primary')] : []),
    ],
    h,
  )
}

/**
 * The levels the effective model reports. A model that reports none gets no
 * controls: reasoning is not a vocabulary oru may invent for it. Rendered as
 * a segmented control so the active level reads as selected, not as plain
 * text.
 */
const reasoningRow = (
  model: Model,
  options: ThreadOptions,
  h: HtmlBuilder<Message>,
): Html | undefined => {
  const levels = effectiveModel(options.models, model.selection)?.reasoningLevels ?? []
  if (levels.length === 0) return undefined
  return h.div(
    [h.DataAttribute('model-reasoning', ''), h.Class('mt-1 border-t border-border/60 pt-1')],
    [
      h.div(
        [
          h.Attribute('cmdk-group-heading', ''),
          h.DataAttribute('slot', 'command-group-heading'),
          h.Class(sectionHeadingClass),
        ],
        ['Reasoning'],
      ),
      h.div(
        [
          h.Role('group'),
          h.AriaLabel('Reasoning'),
          h.Class('mx-1 mb-1 flex gap-1 rounded-lg bg-muted p-1'),
        ],
        levels.map((level) => {
          const isChosen = level === model.selection.reasoning
          return h.button(
            [
              h.DataAttribute('reasoning', level),
              h.AriaPressed(isChosen ? 'true' : 'false'),
              h.OnClick(Message.ChosenReasoning({ level })),
              h.Class(
                isChosen
                  ? 'flex-1 rounded-md bg-background px-2 py-1 text-xs font-medium text-foreground shadow-sm outline-none'
                  : 'flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-background/60 hover:text-foreground',
              ),
            ],
            [level],
          )
        }),
      ),
    ],
  )
}

const panel = (model: Model, options: ThreadOptions, h: HtmlBuilder<Message>): Html => {
  const matching = matchingModels(options.models, model.query)
  const reasoning = reasoningRow(model, options, h)
  const rows =
    matching.length === 0
      ? [
          Command.empty(
            {},
            [
              h.p(
                [
                  h.DataAttribute('model-empty', ''),
                  h.Class('px-3 py-8 text-center text-sm text-muted-foreground'),
                ],
                [
                  options.models.length === 0
                    ? 'This harness reported no models'
                    : 'No model matches',
                ],
              ),
            ],
            h,
          ),
        ]
      : matching.map((choice) => modelRow(choice, model, h))
  return h.div(
    [h.DataAttribute('model-panel', ''), h.Class('overflow-hidden text-popover-foreground')],
    [
      Command(
        { className: 'rounded-none border-0 bg-transparent p-0 shadow-none' },
        [
          Command.input(
            {
              placeholder: 'Search models',
              ariaLabel: 'Search models',
              value: model.query,
              onInput: (value) => Message.ChangedQuery({ value }),
              attributes: [h.DataAttribute('model-search', '')],
            },
            h,
          ),
          Command.list({ className: 'max-h-80' }, rows, h),
          ...(reasoning === undefined ? [] : [reasoning]),
        ],
        h,
      ),
    ],
  )
}

/**
 * The harness's health, on its own row above the composer. The picker's
 * panel lives in the composer's `leading` slot; a harness that is not ready
 * still needs to be seen without opening anything, so its diagnosis stays
 * here while the catalogue moves into the trigger's popover.
 */
export const view = defineView<Model, Message>((model, h) => {
  const options = loadedOptions(model)
  if (options === undefined) return null
  const choice = activeHarness(options)
  const needsAttention = choice !== undefined && choice.health.status !== 'ready'
  if (!needsAttention) return null
  return h.div(
    [h.DataAttribute('model-picker', ''), h.Class('flex w-full max-w-3xl flex-col gap-2 pb-2')],
    [
      harnessFact(options, h),
      ...(choice === undefined ? [] : [healthNote(choice, model.copied, h)]),
    ],
  )
})

/**
 * The composer's `leading` slot: the trigger naming the chosen model and the
 * catalogue popover anchored to it. Open state, search, and selection all
 * stay in this submodel; the composer only places the slot.
 */
export const triggerView = defineView<Model, Message>((model, h) => {
  const options = loadedOptions(model)
  const choice = options === undefined ? undefined : activeHarness(options)
  const needsAttention = choice !== undefined && choice.health.status !== 'ready'
  // The trigger names the model and wears its provider's glyph, so the
  // choice reads at a glance without opening the catalogue.
  const effective =
    options === undefined ? undefined : effectiveModel(options.models, model.selection)
  const triggerIcon =
    effective === undefined
      ? undefined
      : providerDisplayOf(options?.providers ?? [], effective.provider ?? 'unknown').icon
  return pickerAnchor(
    pickerTrigger(
      {
        label: selectionLabel(model) ?? 'Model',
        icon: triggerIcon,
        isOpen: model.isOpen,
        isAttention: needsAttention,
        hook: 'model-picker-trigger',
        message: model.isOpen ? Message.Closed() : Message.Opened(),
      },
      h,
    ),
    model.isOpen && options !== undefined
      ? pickerPanel(
          {
            label: 'Model',
            hook: 'model-picker-panel',
            onClose: Message.Closed(),
            widthClass: 'w-[440px] max-w-[90vw]',
            // Which harness the catalogue belongs to, as a footer: the
            // diagnosis and its install command stay in the status banner,
            // so their hooks never render twice.
            children: [
              panel(model, options, h),
              h.div(
                [h.Class('mt-1 flex items-center border-t border-border/60 px-3 py-2')],
                [harnessFact(options, h)],
              ),
            ],
          },
          h,
        )
      : undefined,
    h,
  )
})
