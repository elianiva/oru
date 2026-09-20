import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { UI_SDK_MAJOR, UiSnapshot, type ComposerProps } from '@oru/ui'
import { registerDef, resetDefsForTest } from '../src/ui-defs.ts'

/**
 * A second composer implementation, and the core-replacement proof in
 * miniature: the app's outlet tests mount this instead of chat-ui and the
 * submit flows behave identically. It owns a draft, a project selection
 * synced from props by diff, and the chip menu that opens the shared
 * create dialog. It deliberately renders no model, worktree, branch, or
 * access pickers — those are chat-ui's UI, covered by chat-ui's tests.
 */

export const StubModel = Schema.Struct({
  draft: Schema.String,
  selected: Schema.UndefinedOr(Schema.String),
  isOpen: Schema.Boolean,
  seen: Schema.Array(Schema.String),
})
export type StubModel = typeof StubModel.Type

export const StubMessage = defineMessageUnion({
  ChangedDraft: { value: Schema.String },
  ClickedSubmit: {},
  Toggled: {},
  SelectedOption: { option: Schema.String },
  Canceled: {},
  /** Test-only: emit a canned ConfigureRequested for the persist test. */
  TestConfigure: {},
})
export type StubMessage = typeof StubMessage.Type

export const StubOut = defineMessageUnion({
  Submitted: {
    project: Schema.optional(Schema.NonEmptyString),
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
    text: Schema.NonEmptyString,
  },
  ConfigureRequested: {
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  },
  RequestedCreateDialog: {},
})
export type StubOut = typeof StubOut.Type

const NEW_ROW = 'new-project'

export const init = (): StubModel => ({ draft: '', selected: undefined, isOpen: false, seen: [] })

export const update = (
  model: StubModel,
  message: StubMessage,
): { readonly model: StubModel; readonly outMessage?: StubOut } =>
  StubMessage.match(message, {
    ChangedDraft: ({ value }) => ({ model: { ...model, draft: value } }),
    ClickedSubmit: () =>
      model.draft.trim() === ''
        ? { model }
        : {
            model: { ...model, draft: '' },
            outMessage: StubOut.Submitted({
              project: model.selected,
              harness: 'pi',
              model: 'muse/claude-1.3-contributor',
              reasoning: 'high',
              text: model.draft,
            }),
          },
    Toggled: () => ({ model: { ...model, isOpen: !model.isOpen } }),
    SelectedOption: ({ option }) =>
      option === NEW_ROW
        ? {
            model: { ...model, isOpen: false },
            outMessage: StubOut.RequestedCreateDialog(),
          }
        : { model: { ...model, selected: option, isOpen: false } },
    Canceled: () => ({ model: { ...model, isOpen: false } }),
    TestConfigure: () => ({
      model,
      outMessage: StubOut.ConfigureRequested({
        harness: 'pi',
        model: 'deepseek/deepseek-flash',
        reasoning: 'low',
      }),
    }),
  })

export const absorbProps = (model: StubModel, props: ComposerProps): StubModel => {
  const ids = props.projects.map((project) => project.id)
  const prev = new Set(model.seen)
  const added = ids.filter((id) => !prev.has(id))
  let selected = model.selected
  if (added.length > 0) {
    selected = added[0]
  } else if (selected !== undefined && !ids.includes(selected)) {
    selected = undefined
  }
  if (selected === model.selected && ids.length === model.seen.length) return model
  return { ...model, selected, seen: ids }
}

export const signal = (
  model: StubModel,
  incoming: { readonly type: string; readonly text?: string },
): StubModel =>
  incoming.type === 'restore-draft' && incoming.text !== undefined
    ? { ...model, draft: incoming.text }
    : model

export const view = defineView<StubModel, StubMessage, ComposerProps>((model, props, h) => {
  const label =
    model.selected !== undefined
      ? (props.projects.find((project) => project.id === model.selected)?.name ?? 'Project')
      : 'Project'
  return h.div(
    [h.Attribute('data-composer', ''), h.Class('w-full max-w-3xl')],
    [
      ...(props.headline === undefined
        ? []
        : [
            h.div(
              [h.Attribute('data-composer-headline', ''), h.Class('mb-6 text-center')],
              [props.headline],
            ),
          ]),
      h.textarea([
        h.Attribute('data-composer-input', ''),
        h.Value(model.draft),
        h.Placeholder(props.placeholder),
        h.OnInput((value) => StubMessage.ChangedDraft({ value })),
      ]),
      h.button(
        [
          h.Type('button'),
          h.OnClick(StubMessage.ClickedSubmit()),
          h.Attribute('data-composer-submit', ''),
          ...(model.draft.trim() === '' ? [h.Attribute('data-disabled', '')] : []),
        ],
        ['Send'],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(StubMessage.Toggled()),
          h.Attribute('data-project-picker-trigger', ''),
        ],
        [label],
      ),
      ...(model.isOpen
        ? [
            h.div(
              [h.Attribute('data-project-picker-panel', '')],
              [
                ...props.projects.map((project) =>
                  h.button(
                    [
                      h.Type('button'),
                      h.OnClick(StubMessage.SelectedOption({ option: project.id })),
                      h.Attribute('data-project-picker-option', project.id),
                    ],
                    [project.name],
                  ),
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(StubMessage.SelectedOption({ option: NEW_ROW })),
                    h.Attribute('data-project-picker-option', NEW_ROW),
                  ],
                  ['New project…'],
                ),
              ],
            ),
          ]
        : []),
    ],
  )
})

const stubConversationView = defineView<unknown, never, { readonly threadId?: string | undefined }>(
  (_model, props, h) =>
    h.div([h.Class('min-h-0 flex-1')], [props.threadId === undefined ? '' : props.threadId]),
)

export const mountStubs = (): void => {
  resetDefsForTest()
  registerDef('test/stub', 'composer', composerAddress, {
    init,
    update,
    view,
    absorb: absorbProps,
    signal,
  })
  registerDef('test/stub', 'conversation', conversationAddress, {
    init: () => ({}),
    update: (model: Record<string, never>) => ({ model }),
    view: stubConversationView,
  })
}

const composerAddress = 'a'.repeat(64)
const conversationAddress = 'b'.repeat(64)

export const stubSnapshot = (): UiSnapshot =>
  UiSnapshot.make({
    bundles: [
      {
        plugin: 'test/stub',
        defId: 'composer',
        slot: 'composer',
        address: composerAddress,
        jsUrl: `/ui/${composerAddress}.js`,
        sdkMajor: UI_SDK_MAJOR,
      },
      {
        plugin: 'test/stub',
        defId: 'conversation',
        slot: 'conversation',
        address: conversationAddress,
        jsUrl: `/ui/${conversationAddress}.js`,
        sdkMajor: UI_SDK_MAJOR,
      },
    ],
    assignments: [
      { slot: 'composer', plugin: 'test/stub', defId: 'composer' },
      { slot: 'conversation', plugin: 'test/stub', defId: 'conversation' },
    ],
  })
