import { Match, Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import * as Update from 'foldkit/update'
import type { HtmlBuilder } from 'foldkit/html'
import { ModelInfo } from '@oru/harness'
import { ThreadId } from '@oru/kernel'
import { HarnessChoice, ThreadConfig, ThreadOptions, ThreadSignal } from '@oru/rpc'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { Empty } from '@/components/ui/empty.ts'
import { inputClass } from '@/components/ui/input.ts'
import { Item } from '@/components/ui/item.ts'
import { labelOf, TranscriptLine, UsageLine } from './transcript.ts'

const UsageTotals = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cost: Schema.UndefinedOr(Schema.Number),
})

const emptyUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cost: undefined,
} satisfies typeof UsageTotals.Type

export const Model = Schema.Struct({
  threadId: Schema.UndefinedOr(ThreadId),
  draft: Schema.String,
  lines: Schema.Array(TranscriptLine),
  /** The turn happening right now, as the harness reports it. */
  live: Schema.Array(ThreadSignal),
  /** Totals folded from `turn/usage` facts the watch stream already delivered. */
  usage: UsageTotals,
  sawUsage: Schema.Boolean,
  context: Schema.UndefinedOr(
    Schema.Struct({
      tokens: Schema.Number,
      contextWindow: Schema.Number,
    }),
  ),
  config: ThreadConfig,
  harnesses: Schema.Array(HarnessChoice),
  models: Schema.Array(ModelInfo),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Opened: { threadId: ThreadId, options: ThreadOptions },
  OptionsArrived: ThreadOptions.fields,
  ChangedDraft: { value: Schema.String },
  ClickedSend: {},
  ClickedStop: {},
  ClickedCompact: {},
  LineArrived: { line: TranscriptLine },
  SignalArrived: { signal: ThreadSignal },
  ChangedHarness: { value: Schema.String },
  ChangedModel: { value: Schema.String },
  ChangedReasoning: { value: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedSend: { text: Schema.String },
  RequestedConfigure: { config: ThreadConfig },
  RequestedStop: {},
  RequestedCompact: {},
})
export type OutMessage = typeof OutMessage.Type

/** No thinking level is not the same as thinking off: absent means unset. */
export const thinkingOff = 'off'

export const init = (): Model => ({
  threadId: undefined,
  draft: '',
  lines: [],
  live: [],
  usage: emptyUsage,
  sawUsage: false,
  context: undefined,
  config: { harness: undefined, model: undefined, reasoning: undefined },
  harnesses: [],
  models: [],
})

/**
 * A harness that reasons but lists no levels has not said which ones it takes,
 * so the picker offers only "off" rather than guessing a vocabulary.
 */
const levelsOf = (model: ModelInfo | undefined): readonly string[] =>
  model?.reasoning === true ? (model.reasoningLevels ?? []) : []

/**
 * A reasoning level the chosen model does not offer is not a level, so it is
 * dropped on arrival rather than sent to a harness that would have to refuse it.
 */
const applied = (model: Model, options: ThreadOptions): Model => {
  const levels = levelsOf(options.models.find((choice) => choice.id === options.config.model))
  const reasoning =
    options.config.reasoning === undefined || levels.includes(options.config.reasoning)
      ? options.config.reasoning
      : undefined
  return {
    ...model,
    config: { ...options.config, reasoning },
    harnesses: options.harnesses,
    models: options.models,
  }
}

const optionsFor = (
  h: HtmlBuilder<Message>,
  choices: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  current: string | undefined,
) =>
  choices.map((choice) =>
    h.option([h.Value(choice.value), h.Selected(choice.value === current)], [choice.label]),
  )

export const update = (model: Model, message: Message) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    Opened: ({ threadId, options }) => ({
      model: {
        ...applied(model, options),
        threadId,
        live: [],
        lines: [],
        usage: emptyUsage,
        sawUsage: false,
        context: undefined,
      },
    }),
    OptionsArrived: (options) => ({ model: applied(model, options) }),
    ChangedDraft: ({ value }) => ({ model: { ...model, draft: value } }),
    ClickedSend: () => {
      if (model.threadId === undefined || model.draft.length === 0) return { model }
      return {
        model: { ...model, draft: '' },
        outMessage: OutMessage.RequestedSend({ text: model.draft }),
      }
    },
    ClickedStop: () => ({ model, outMessage: OutMessage.RequestedStop() }),
    ClickedCompact: () => ({ model, outMessage: OutMessage.RequestedCompact() }),
    LineArrived: ({ line }) => {
      if (line._tag === 'turn/usage') {
        return {
          model: {
            ...model,
            sawUsage: true,
            usage: {
              inputTokens: model.usage.inputTokens + line.inputTokens,
              outputTokens: model.usage.outputTokens + line.outputTokens,
              cost:
                line.cost === undefined && model.usage.cost === undefined
                  ? undefined
                  : (model.usage.cost ?? 0) + (line.cost ?? 0),
            },
          },
        }
      }
      if (line._tag === 'context-window') {
        return {
          model: {
            ...model,
            context: { tokens: line.tokens, contextWindow: line.contextWindow },
          },
        }
      }
      return {
        // The facts of a turn replace what the live stream drew while it ran.
        model:
          line._tag === 'turn' || line._tag === 'turn/failed'
            ? { ...model, live: [], lines: [...model.lines, line] }
            : { ...model, lines: [...model.lines, line] },
      }
    },
    SignalArrived: ({ signal }) => ({
      // The live stream ends before that turn's facts are written, so settling
      // is what clears it. A turn that fails clears it on its failed line.
      model:
        signal._tag === 'settled'
          ? { ...model, live: [] }
          : { ...model, live: [...model.live, signal] },
    }),
    ChangedHarness: ({ value }) => ({
      model,
      outMessage: OutMessage.RequestedConfigure({
        config: { harness: value, model: undefined, reasoning: undefined },
      }),
    }),
    ChangedModel: ({ value }) => ({
      model,
      outMessage: OutMessage.RequestedConfigure({
        config: { ...model.config, model: value, reasoning: undefined },
      }),
    }),
    ChangedReasoning: ({ value }) => ({
      model,
      outMessage: OutMessage.RequestedConfigure({
        config: {
          ...model.config,
          reasoning: value === thinkingOff ? undefined : value,
        },
      }),
    }),
  })

/**
 * How a live signal reads as one line. The vocabulary is the host's; only the
 * wording is the pane's.
 */
const liveLabelOf = (signal: ThreadSignal): string =>
  Match.value(signal).pipe(
    Match.tagsExhaustive({
      text: (signal) => signal.delta,
      thinking: (signal) => `thinking: ${signal.delta}`,
      'tool-start': (signal) => `tool ${signal.name} running`,
      'tool-args': () => '',
      'tool-end': (signal) => `tool ${signal.name} ${signal.ok ? 'done' : 'failed'}`,
      compacting: (signal) => (signal.automatic ? 'compacting' : 'compacting (requested)'),
      compacted: (signal) => `compacted ${signal.tokensBefore} tokens`,
      'context-window': (signal) => `context ${signal.tokens}/${signal.contextWindow}`,
      'session-replaced': (signal) => `session replaced: ${signal.reason}`,
      warning: (signal) => `warning: ${signal.message}`,
      error: (signal) => `error: ${signal.message}`,
      unhandled: (signal) => `unhandled: ${signal.type}`,
      settled: () => 'turn settled',
    }),
  )

export const view = defineView<Model, Message>((model, h) => {
  const levels = levelsOf(model.models.find((choice) => choice.id === model.config.model))
  return h.section(
    [h.Attribute('data-thread-panel', ''), h.Class('flex h-full min-h-0 flex-col')],
    [
      h.div(
        [h.Class('flex shrink-0 flex-wrap gap-2 border-b border-border-seam p-3')],
        [
          h.select(
            [
              h.Attribute('data-harness-select', ''),
              h.Class(inputClass),
              h.OnChange((value) => Message.ChangedHarness({ value })),
            ],
            optionsFor(
              h,
              model.harnesses.map((choice) => ({
                value: choice.id,
                label: `${choice.label} (${choice.health.status})`,
              })),
              model.config.harness,
            ),
          ),
          h.select(
            [
              h.Attribute('data-model-select', ''),
              h.Class(inputClass),
              h.OnChange((value) => Message.ChangedModel({ value })),
            ],
            optionsFor(
              h,
              model.models.map((choice) => ({
                value: choice.id,
                label: choice.label ?? choice.id,
              })),
              model.config.model,
            ),
          ),
          h.select(
            [
              h.Attribute('data-reasoning-select', ''),
              h.Class(inputClass),
              h.OnChange((value) => Message.ChangedReasoning({ value })),
            ],
            optionsFor(
              h,
              [
                { value: thinkingOff, label: 'thinking off' },
                ...levels.map((level) => ({ value: level, label: `thinking ${level}` })),
              ],
              model.config.reasoning ?? thinkingOff,
            ),
          ),
          button(
            {
              onClick: Message.ClickedStop(),
              variant: 'outline',
              size: 'sm',
              attributes: [h.Attribute('data-thread-stop', '')],
            },
            'Stop',
            h,
          ),
          button(
            {
              onClick: Message.ClickedCompact(),
              variant: 'outline',
              size: 'sm',
              attributes: [h.Attribute('data-thread-compact', '')],
            },
            'Compact',
            h,
          ),
          ...(model.sawUsage
            ? [
                h.span(
                  [h.Attribute('data-thread-usage', ''), h.Class('text-sm text-muted-foreground')],
                  [
                    labelOf(
                      UsageLine.make({
                        inputTokens: model.usage.inputTokens,
                        outputTokens: model.usage.outputTokens,
                        cost: model.usage.cost,
                      }),
                    ),
                  ],
                ),
              ]
            : []),
          ...(model.context !== undefined
            ? [
                h.span(
                  [
                    h.Attribute('data-thread-context', ''),
                    h.Class('text-sm text-muted-foreground'),
                  ],
                  [`context ${model.context.tokens}/${model.context.contextWindow}`],
                ),
              ]
            : []),
        ],
      ),
      h.div(
        [h.Class('flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3')],
        model.lines.length === 0 && model.live.length === 0
          ? [Empty({}, [Empty.header({}, [Empty.title({}, ['No messages yet'], h)], h)], h)]
          : [
              Item.group(
                { className: 'gap-2' },
                [
                  ...model.lines.map((line) =>
                    Item(
                      { variant: 'muted', size: 'sm' },
                      [
                        Item.content(
                          {},
                          [
                            badge({ variant: 'outline' }, [line._tag], h),
                            Item.title(
                              { className: 'line-clamp-none font-normal' },
                              [labelOf(line)],
                              h,
                            ),
                          ],
                          h,
                        ),
                      ],
                      h,
                    ),
                  ),
                  ...model.live
                    // Argument deltas arrive per token and are not a line of their own.
                    .filter((signal) => signal._tag !== 'tool-args')
                    .map((signal) =>
                      Item(
                        { variant: 'muted', size: 'sm' },
                        [
                          Item.content(
                            {},
                            [
                              badge({ variant: 'secondary' }, [signal._tag], h),
                              Item.title(
                                { className: 'line-clamp-none font-normal' },
                                [liveLabelOf(signal)],
                                h,
                              ),
                            ],
                            h,
                          ),
                        ],
                        h,
                      ),
                    ),
                ],
                h,
              ),
            ],
      ),
      h.div(
        [h.Class('flex shrink-0 gap-2 border-t border-border-seam bg-background p-3')],
        [
          h.input([
            h.Attribute('data-thread-draft', ''),
            h.Class(inputClass),
            h.Value(model.draft),
            h.OnInput((value) => Message.ChangedDraft({ value })),
          ]),
          button(
            {
              onClick: Message.ClickedSend(),
              variant: 'outline',
              attributes: [h.Attribute('data-thread-send', '')],
            },
            'Send',
            h,
          ),
        ],
      ),
    ],
  )
})
