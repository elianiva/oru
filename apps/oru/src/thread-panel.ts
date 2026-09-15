import { Match, Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import * as Update from 'foldkit/update'
import type { HtmlBuilder } from 'foldkit/html'
import { ModelInfo } from '@oru/harness'
import { ProjectId, ThreadId } from '@oru/kernel'
import { HarnessChoice, Project, ThreadConfig, ThreadOptions, ThreadSignal } from '@oru/rpc'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { Empty } from '@/components/ui/empty.ts'
import { inputClass } from '@/components/ui/input.ts'
import { Item } from '@/components/ui/item.ts'
import { labelOf, TranscriptLine } from './transcript.ts'

export const Model = Schema.Struct({
  threadId: Schema.UndefinedOr(ThreadId),
  draft: Schema.String,
  lines: Schema.Array(TranscriptLine),
  /** The turn happening right now, as the harness reports it. */
  live: Schema.Array(ThreadSignal),
  config: ThreadConfig,
  harnesses: Schema.Array(HarnessChoice),
  models: Schema.Array(ModelInfo),
  projects: Schema.Array(Project),
  selected: Schema.UndefinedOr(ProjectId),
  project: Schema.UndefinedOr(Project),
  newName: Schema.String,
  newCwd: Schema.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Opened: { threadId: ThreadId, options: ThreadOptions, project: Project },
  OptionsArrived: ThreadOptions.fields,
  ProjectsArrived: { projects: Schema.Array(Project) },
  ProjectRecorded: { project: Project },
  ChangedDraft: { value: Schema.String },
  ChangedNewName: { value: Schema.String },
  ChangedNewCwd: { value: Schema.String },
  ClickedCreateProject: {},
  ClickedSend: {},
  ClickedStop: {},
  ClickedCompact: {},
  LineArrived: { line: TranscriptLine },
  SignalArrived: { signal: ThreadSignal },
  ChangedProject: { value: Schema.String },
  ChangedHarness: { value: Schema.String },
  ChangedModel: { value: Schema.String },
  ChangedReasoning: { value: Schema.String },
  ClickedRecheck: {},
  ClickedCopyInstall: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedSend: { text: Schema.String },
  RequestedConfigure: { config: ThreadConfig },
  RequestedStop: {},
  RequestedCompact: {},
  RequestedCreateThread: { project: ProjectId },
  RequestedCreateProject: { name: Schema.NonEmptyString, cwd: Schema.NonEmptyString },
  RequestedRefresh: {},
  RequestedCopy: { text: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

/** No thinking level is not the same as thinking off: absent means unset. */
export const thinkingOff = 'off'

export const init = (): Model => ({
  threadId: undefined,
  draft: '',
  lines: [],
  live: [],
  config: { harness: undefined, model: undefined, reasoning: undefined },
  harnesses: [],
  models: [],
  projects: [],
  selected: undefined,
  project: undefined,
  newName: '',
  newCwd: '',
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

const configuredChoice = (
  harnesses: ReadonlyArray<HarnessChoice>,
  harness: string | undefined,
): HarnessChoice | undefined =>
  harness === undefined ? harnesses[0] : harnesses.find((choice) => choice.id === harness)

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
    Opened: ({ threadId, options, project }) => ({
      model: {
        ...applied(model, options),
        threadId,
        live: [],
        project,
        selected: project.id,
        projects: model.projects.some((entry) => entry.id === project.id)
          ? model.projects
          : [...model.projects, project],
      },
    }),
    OptionsArrived: (options) => ({ model: applied(model, options) }),
    ProjectsArrived: ({ projects }) => ({ model: { ...model, projects } }),
    ProjectRecorded: ({ project }) => ({
      model: {
        ...model,
        project,
        selected: project.id,
        newName: '',
        newCwd: '',
        projects: model.projects.some((entry) => entry.id === project.id)
          ? model.projects
          : [...model.projects, project],
      },
      outMessage: OutMessage.RequestedCreateThread({ project: project.id }),
    }),
    ChangedDraft: ({ value }) => ({ model: { ...model, draft: value } }),
    ChangedNewName: ({ value }) => ({ model: { ...model, newName: value } }),
    ChangedNewCwd: ({ value }) => ({ model: { ...model, newCwd: value } }),
    ClickedCreateProject: () => {
      if (model.newName.length === 0 || model.newCwd.length === 0) return { model }
      return {
        model,
        outMessage: OutMessage.RequestedCreateProject({
          name: model.newName,
          cwd: model.newCwd,
        }),
      }
    },
    ClickedSend: () => {
      if (model.threadId === undefined || model.draft.length === 0) return { model }
      return {
        model: { ...model, draft: '' },
        outMessage: OutMessage.RequestedSend({ text: model.draft }),
      }
    },
    ClickedStop: () => ({ model, outMessage: OutMessage.RequestedStop() }),
    ClickedCompact: () => ({ model, outMessage: OutMessage.RequestedCompact() }),
    LineArrived: ({ line }) => ({
      // The facts of a turn replace what the live stream drew while it ran.
      model:
        line._tag === 'turn' || line._tag === 'turn/failed'
          ? { ...model, live: [], lines: [...model.lines, line] }
          : { ...model, lines: [...model.lines, line] },
    }),
    SignalArrived: ({ signal }) => ({
      // The live stream ends before that turn's facts are written, so settling
      // is what clears it. A turn that fails clears it on its failed line.
      model:
        signal._tag === 'settled'
          ? { ...model, live: [] }
          : { ...model, live: [...model.live, signal] },
    }),
    ChangedProject: ({ value }) => {
      const selected = value.length === 0 ? undefined : value
      if (selected === undefined) return { model: { ...model, selected } }
      if (model.threadId !== undefined) return { model: { ...model, selected } }
      return {
        model: { ...model, selected },
        outMessage: OutMessage.RequestedCreateThread({ project: selected }),
      }
    },
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
    ClickedRecheck: () => ({ model, outMessage: OutMessage.RequestedRefresh() }),
    ClickedCopyInstall: () => {
      const command = configuredChoice(model.harnesses, model.config.harness)?.health.installCommand
      if (command === undefined) return { model }
      return { model, outMessage: OutMessage.RequestedCopy({ text: command }) }
    },
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
  const selected = configuredChoice(model.harnesses, model.config.harness)
  const health = selected?.health
  const needsFix = health !== undefined && health.status !== 'ready'
  return h.section(
    [h.Attribute('data-thread-panel', ''), h.Class('flex h-full min-h-0 flex-col')],
    [
      h.div(
        [h.Class('flex shrink-0 flex-wrap gap-2 border-b border-border-seam p-3')],
        [
          h.select(
            [
              h.Attribute('data-project-select', ''),
              h.Class(inputClass),
              h.OnChange((value) => Message.ChangedProject({ value })),
            ],
            [
              h.option([h.Value(''), h.Selected(model.selected === undefined)], ['Choose project']),
              ...optionsFor(
                h,
                model.projects.map((choice) => ({
                  value: choice.id,
                  label: `${choice.name} (${choice.cwd})`,
                })),
                model.selected,
              ),
            ],
          ),
          h.span(
            [
              h.Attribute('data-thread-project', ''),
              h.Class('self-center text-sm text-muted-foreground'),
            ],
            [model.project === undefined ? 'No project' : model.project.name],
          ),
          h.input([
            h.Attribute('data-project-name', ''),
            h.Class(inputClass),
            h.Value(model.newName),
            h.Placeholder('Project name'),
            h.OnInput((value) => Message.ChangedNewName({ value })),
          ]),
          h.input([
            h.Attribute('data-project-cwd', ''),
            h.Class(inputClass),
            h.Value(model.newCwd),
            h.Placeholder('Absolute path'),
            h.OnInput((value) => Message.ChangedNewCwd({ value })),
          ]),
          button(
            {
              onClick: Message.ClickedCreateProject(),
              variant: 'outline',
              size: 'sm',
              attributes: [h.Attribute('data-create-project', '')],
            },
            'Create project',
            h,
          ),
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
        ],
      ),
      ...(needsFix && health !== undefined
        ? [
            h.div(
              [
                h.Attribute('data-harness-health', ''),
                h.Class('flex shrink-0 flex-col gap-2 border-b border-border-seam px-4 py-3'),
              ],
              [
                h.div(
                  [h.Class('flex flex-wrap items-center gap-2')],
                  [
                    badge({ variant: 'outline' }, [health.status], h),
                    h.span(
                      [h.Attribute('data-harness-health-message', '')],
                      [health.message ?? health.status],
                    ),
                    button(
                      {
                        onClick: Message.ClickedRecheck(),
                        variant: 'outline',
                        size: 'sm',
                        attributes: [h.Attribute('data-harness-recheck', '')],
                      },
                      'Recheck',
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
                          h.span(
                            [
                              h.Attribute('data-harness-install-command', ''),
                              h.Class('min-w-0 flex-1 font-mono text-xs break-all'),
                            ],
                            [health.installCommand],
                          ),
                          button(
                            {
                              onClick: Message.ClickedCopyInstall(),
                              variant: 'outline',
                              size: 'sm',
                              attributes: [h.Attribute('data-harness-copy-install', '')],
                            },
                            'Copy',
                            h,
                          ),
                        ],
                      ),
                    ]),
              ],
            ),
          ]
        : []),
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
