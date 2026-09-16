/**
 * The harness a thread runs on, and the model it runs.
 *
 * The harness is a fact: a host registers its own list, and the thread was
 * configured to one of them, so this renders which one and how healthy it is
 * rather than offering a choice. The model is a choice, drawn from that
 * harness's catalogue, which is too large to be a `<select>`. When a harness
 * is not ready its diagnosis and install command are rendered to copy; oru
 * reports that command and never runs it (ADR-0007).
 */
import { Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import { Check } from 'lucide'
import type { ModelInfo } from '@oru/harness'
import { HarnessChoice, ThreadOptions } from '@oru/rpc'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { inputClass } from '@/components/ui/input.ts'
import { icon } from '@/lib/icons.ts'

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

export const init = (): Model => ({
  isOpen: false,
  query: '',
  options: Loading.make({}),
  selection: { harness: undefined, model: undefined, reasoning: undefined },
  copied: false,
})

/** The host's answer, once one has arrived. */
export const loadedOptions = (model: Model): ThreadOptions | undefined =>
  Schema.is(Loaded)(model.options) ? model.options.options : undefined

/** The harness these options describe, with the health it was reported with. */
export const activeHarness = (options: ThreadOptions): HarnessChoice | undefined =>
  options.harnesses.find((choice) => choice.id === options.harness)

const providerOf = (model: ModelInfo): string => model.provider ?? 'unknown'

/** The catalogue narrowed to a search term, matched against id and label. */
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

export type ProviderGroup = Readonly<{
  provider: string
  models: ReadonlyArray<ModelInfo>
}>

/** The catalogue split by provider, in the order each provider first appears. */
export const groupByProvider = (models: ReadonlyArray<ModelInfo>): ReadonlyArray<ProviderGroup> => {
  const grouped = new Map<string, Array<ModelInfo>>()
  for (const model of models) {
    const provider = providerOf(model)
    const bucket = grouped.get(provider)
    if (bucket === undefined) grouped.set(provider, [model])
    else bucket.push(model)
  }
  return [...grouped].map(([provider, choices]) => ({ provider, models: choices }))
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
    OptionsArrived: ({ options }) => ({
      model: evo(model, {
        options: () => Loaded.make({ options }),
        selection: () => ({
          harness: options.harness,
          model: options.config.model,
          reasoning: options.config.reasoning,
        }),
        copied: () => false,
      }),
    }),
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

const modelRow = (choice: ModelInfo, model: Model, h: HtmlBuilder<Message>): Html =>
  button(
    {
      onClick: Message.ChosenModel({ model: choice.id }),
      variant: 'ghost',
      size: 'sm',
      className: 'w-full justify-start gap-2 font-normal',
      attributes: [h.DataAttribute('model-row', choice.id)],
    },
    [
      h.span([h.Class('shrink-0')], [choice.label ?? choice.id]),
      h.span(
        [h.Class('min-w-0 flex-1 truncate text-left font-mono text-xs text-muted-foreground')],
        [choice.id],
      ),
      ...(choice.isDefault === true ? [badge({ variant: 'outline' }, ['Default'], h)] : []),
      ...(choice.id === model.selection.model ? [icon(h, Check, 'size-4 shrink-0')] : []),
    ],
    h,
  )

const groupView = (group: ProviderGroup, model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.DataAttribute('model-group', group.provider), h.Class('flex flex-col py-1')],
    [
      h.div(
        [
          h.DataAttribute('model-group-header', group.provider),
          h.Class(
            'px-3 pt-1 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase',
          ),
        ],
        [group.provider],
      ),
      ...group.models.map((choice) => modelRow(choice, model, h)),
    ],
  )

/**
 * The levels the effective model reports. A model that reports none gets no
 * controls: reasoning is not a vocabulary oru may invent for it.
 */
const reasoningRow = (
  model: Model,
  options: ThreadOptions,
  h: HtmlBuilder<Message>,
): Html | undefined => {
  const levels = effectiveModel(options.models, model.selection)?.reasoningLevels ?? []
  if (levels.length === 0) return undefined
  return h.div(
    [
      h.DataAttribute('model-reasoning', ''),
      h.Class('flex flex-wrap items-center gap-0.5 px-3 py-2'),
    ],
    levels.map((level) => {
      const isChosen = level === model.selection.reasoning
      return button(
        {
          onClick: Message.ChosenReasoning({ level }),
          variant: isChosen ? 'secondary' : 'ghost',
          size: 'sm',
          className: 'font-normal',
          attributes: [
            h.DataAttribute('reasoning', level),
            h.AriaPressed(isChosen ? 'true' : 'false'),
          ],
        },
        level,
        h,
      )
    }),
  )
}

const panel = (model: Model, options: ThreadOptions, h: HtmlBuilder<Message>): Html => {
  const matching = matchingModels(options.models, model.query)
  const groups = groupByProvider(matching)
  const reasoning = reasoningRow(model, options, h)
  return h.div(
    [
      h.DataAttribute('model-panel', ''),
      h.Class('overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg'),
    ],
    [
      h.div(
        [h.Class('p-2')],
        [
          h.input([
            h.DataAttribute('model-search', ''),
            h.Class(inputClass),
            h.AriaLabel('Search models'),
            h.Placeholder('Search models'),
            h.Value(model.query),
            h.OnInput((value) => Message.ChangedQuery({ value })),
          ]),
        ],
      ),
      ...(reasoning === undefined
        ? []
        : [h.div([h.Class('border-y border-border/60')], [reasoning])]),
      h.div(
        [h.Class('max-h-80 overflow-y-auto p-1')],
        matching.length === 0
          ? [
              h.p(
                [
                  h.DataAttribute('model-empty', ''),
                  h.Class('px-3 py-4 text-sm text-muted-foreground'),
                ],
                [
                  options.models.length === 0
                    ? 'This harness reported no models'
                    : 'No model matches',
                ],
              ),
            ]
          : groups.map((group) => groupView(group, model, h)),
      ),
    ],
  )
}

export const view = defineView<Model, Message>((model, h) => {
  const options = loadedOptions(model)
  if (options === undefined) return null
  const choice = activeHarness(options)
  const needsAttention = choice !== undefined && choice.health.status !== 'ready'
  if (!model.isOpen && !needsAttention) return null
  return h.div(
    [h.DataAttribute('model-picker', ''), h.Class('flex w-full max-w-3xl flex-col gap-2 pb-2')],
    [
      harnessFact(options, h),
      ...(needsAttention && choice !== undefined ? [healthNote(choice, model.copied, h)] : []),
      ...(model.isOpen ? [panel(model, options, h)] : []),
    ],
  )
})
