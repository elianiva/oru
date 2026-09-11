import { Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import { ThreadId } from '@oru/kernel'
import { labelOf, TranscriptLine } from './transcript.ts'

export const Model = Schema.Struct({
  threadId: Schema.UndefinedOr(ThreadId),
  draft: Schema.String,
  lines: Schema.Array(TranscriptLine),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Opened: { threadId: ThreadId },
  ChangedDraft: { value: Schema.String },
  ClickedSend: {},
  LineArrived: { line: TranscriptLine },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedSend: { text: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({ threadId: undefined, draft: '', lines: [] })

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    Opened: ({ threadId }) => ({ model: { ...model, threadId } }),
    ChangedDraft: ({ value }) => ({ model: { ...model, draft: value } }),
    ClickedSend: () => {
      if (model.threadId === undefined || model.draft.length === 0) return { model }
      return {
        model: { ...model, draft: '' },
        outMessage: OutMessage.RequestedSend({ text: model.draft }),
      }
    },
    LineArrived: ({ line }) => ({ model: { ...model, lines: [...model.lines, line] } }),
  })

export const view = defineView<Model, Message>((model, h) =>
  h.section(
    [h.Attribute('data-thread-panel', '')],
    [
      h.input([
        h.Attribute('data-thread-draft', ''),
        h.Value(model.draft),
        h.OnInput((value) => Message.ChangedDraft({ value })),
      ]),
      h.button([h.Attribute('data-thread-send', ''), h.OnClick(Message.ClickedSend())], ['Send']),
      h.ul(
        [],
        model.lines.map((line) => h.li([], [labelOf(line)])),
      ),
    ],
  ),
)
