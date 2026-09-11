import { Schema } from 'effect'
import { defineView } from 'foldkit/submodel'
import { defineMessageUnion } from 'foldkit/message'
import { ThreadId } from '@oru/kernel'
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
    [h.Attribute('data-thread-panel', ''), h.Class('flex h-full min-h-0 flex-col')],
    [
      h.div(
        [h.Class('flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3')],
        model.lines.length === 0
          ? [Empty({}, [Empty.header({}, [Empty.title({}, ['No messages yet'], h)], h)], h)]
          : [
              Item.group(
                { className: 'gap-2' },
                model.lines.map((line) =>
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
  ),
)
