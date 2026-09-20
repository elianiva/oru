/**
 * The conversation slot's definition: a thread's viewer.
 *
 * Renders the thread's log facts as chat: user and assistant messages, tool
 * calls with results, turn failures, compaction and branch facts, and pending
 * approvals with approve and deny actions. Facts arrive as props from root,
 * which subscribes to the host's thread watch; decisions leave as
 * out-messages root executes.
 */
import { Predicate, Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import type { ConversationProps } from '@oru/ui'

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Noop: {},
  ClickedApprove: { request: Schema.String },
  ClickedDeny: { request: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  DecideApproval: {
    request: Schema.NonEmptyString,
    decision: Schema.Literals(['approve', 'deny']),
  },
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({})

type ConversationReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): ConversationReturn =>
  Message.match<ConversationReturn>(message, {
    Noop: () => ({ model }),
    ClickedApprove: ({ request }) => ({
      model,
      outMessage: OutMessage.DecideApproval({ request, decision: 'approve' }),
    }),
    ClickedDeny: ({ request }) => ({
      model,
      outMessage: OutMessage.DecideApproval({ request, decision: 'deny' }),
    }),
  })

const threadName = (id: string): string => id

export const view = defineView<Model, Message, ConversationProps>((model, props, h) => {
  const events = props.threadId === undefined ? [] : props.events
  const pendingApprovals = new Map<string, { name: string; call: string }>()
  for (const event of events) {
    if (Predicate.isTagged(event, 'tool/requested')) {
      if (!pendingApprovals.has(event.call)) {
        pendingApprovals.set(event.call, { name: event.name, call: event.call })
      }
    }
    if (Predicate.isTagged(event, 'tool/completed')) pendingApprovals.delete(event.call)
    if (Predicate.isTagged(event, 'approval/decided')) pendingApprovals.delete(event.request)
  }
  const rows = []
  for (const event of events) {
    if (Predicate.isTagged(event, 'message/appended')) {
      rows.push(
        h.div(
          [
            h.DataAttribute('chat-message', `${event.role}-${event.id}`),
            h.Class(
              event.role === 'user'
                ? 'ml-auto max-w-3xl rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground'
                : 'w-full max-w-3xl rounded-xl border border-border/60 bg-card px-4 py-2 text-sm',
            ),
          ],
          [event.body],
        ),
      )
    } else if (Predicate.isTagged(event, 'tool/requested')) {
      rows.push(
        h.div(
          [h.DataAttribute('tool-request', event.call), h.Class('text-xs text-muted-foreground')],
          [`tool ${event.name}`],
        ),
      )
    } else if (Predicate.isTagged(event, 'tool/completed')) {
      rows.push(
        h.div(
          [
            h.DataAttribute('tool-result', event.call),
            h.Class('max-w-3xl truncate font-mono text-xs text-muted-foreground'),
          ],
          [event.ok ? event.result.slice(0, 200) : `denied: ${event.result.slice(0, 200)}`],
        ),
      )
    } else if (Predicate.isTagged(event, 'turn/failed')) {
      rows.push(
        h.div(
          [h.DataAttribute('turn-failed', event.turn), h.Class('text-sm text-destructive')],
          [event.reason],
        ),
      )
    } else if (Predicate.isTagged(event, 'thread/compacted')) {
      rows.push(
        h.div(
          [h.DataAttribute('thread-compacted', event.id), h.Class('text-xs text-muted-foreground')],
          [`compacted: ${event.summary.slice(0, 160)}`],
        ),
      )
    } else if (Predicate.isTagged(event, 'thread/branched')) {
      rows.push(
        h.div(
          [h.DataAttribute('thread-branched', event.id), h.Class('text-xs text-muted-foreground')],
          ['branched from earlier history'],
        ),
      )
    }
  }
  return h.div(
    [h.Class('flex min-h-0 flex-1 flex-col')],
    [
      h.header(
        [h.Class('flex h-10 shrink-0 items-center px-5')],
        [
          h.span(
            [h.Class('truncate text-sm font-medium')],
            [props.threadId === undefined ? '' : threadName(props.threadId)],
          ),
        ],
      ),
      h.div(
        [
          h.DataAttribute('chat-scroll', ''),
          h.Class('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4'),
        ],
        [
          ...rows,
          ...[...pendingApprovals.values()].map((pending) =>
            h.div(
              [
                h.DataAttribute('approval-pending', pending.call),
                h.Class('flex items-center gap-2'),
              ],
              [
                h.span([h.Class('text-sm')], [`approve ${pending.name}?`]),
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('approval-approve', pending.call),
                    h.OnClick(Message.ClickedApprove({ request: pending.call })),
                    h.Class('rounded-md border px-2 py-1 text-xs'),
                  ],
                  ['Approve'],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('approval-deny', pending.call),
                    h.OnClick(Message.ClickedDeny({ request: pending.call })),
                    h.Class('rounded-md border px-2 py-1 text-xs'),
                  ],
                  ['Deny'],
                ),
              ],
            ),
          ),
          ...(props.pending
            ? [
                h.div(
                  [h.DataAttribute('chat-pending', ''), h.Class('text-xs text-muted-foreground')],
                  ['working…'],
                ),
              ]
            : []),
        ],
      ),
    ],
  )
})
