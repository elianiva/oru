import { DateTime, Option, Schema } from 'effect'
import { SessionMessage } from '@opencode/schema/session-message'
import type { Agent } from '@opencode/schema/agent'
import type { Model } from '@opencode/schema/model'
import { type HistoryItem, isToolCall, isUserMessage } from '@oru/harness'

/**
 * Bootstrap OpenCode's session from oru's record.
 *
 * Runs once, when the thread has no session yet; afterwards the session is
 * OpenCode's own record and the runtime's history is never written back. That
 * one shot sets three rules, each for the same reason OpenCode would reject a
 * seed that broke it:
 *
 * - a call is seeded only when its output is also in the record, because a
 *   provider rejects an assistant turn that leaves a call unanswered;
 * - reasoning is not seeded, matching the reasoning capability the bridge
 *   reports;
 * - consecutive assistant-side items become one assistant message, which is
 *   the shape OpenCode writes for a step: text and its calls belong to the
 *   same turn of the model's reply, not to a queue of adjacent replies.
 *
 * The agent and the model are required by the projection and unknown to a
 * replayed history, so they are the session's own: a message records where the
 * session is pointed, not what a model that has since changed happened to be.
 */
export interface SeedContext {
  readonly agent: Agent.ID
  readonly model: Model.Ref
}

/** Arguments a record calls canonical JSON but that were never quite JSON. */
const ToolArguments = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
const parseArguments = (text: string): Record<string, Schema.Json> => {
  const decoded = Schema.decodeUnknownOption(ToolArguments)(text)
  return Option.isSome(decoded) ? decoded.value : {}
}

export const seedMessages = (
  history: readonly HistoryItem[],
  context: SeedContext,
): SessionMessage.Info[] => {
  const outputs = new Map<string, string>()
  for (const item of history) {
    if (item.type === 'tool_result') outputs.set(item.call_id, item.output)
  }

  const messages: SessionMessage.Info[] = []
  let started = Date.now() - history.length
  let index = 0
  const stamp = (): number => started + index++
  // The projection types its content as readonly, so the group's own array is
  // held here: the message is pushed holding the same reference, and a run of
  // items appends to it in place.
  let content: SessionMessage.AssistantContent[] | undefined
  const open = (): SessionMessage.AssistantContent[] => {
    if (content !== undefined) return content
    content = []
    messages.push({
      type: 'assistant',
      id: SessionMessage.ID.create(),
      time: { created: DateTime.makeUnsafe(stamp()) },
      agent: context.agent,
      model: context.model,
      content,
    })
    return content
  }

  for (const item of history) {
    if (isUserMessage(item)) {
      content = undefined
      if (item.text !== '') {
        messages.push({
          type: 'user',
          id: SessionMessage.ID.create(),
          time: { created: DateTime.makeUnsafe(stamp()) },
          text: item.text,
        })
      }
      continue
    }
    if (item.type === 'assistant_message') {
      if (item.text !== '') open().push({ type: 'text', text: item.text })
      continue
    }
    if (item.type === 'reasoning') continue
    if (isToolCall(item)) {
      const output = outputs.get(item.call_id)
      if (output === undefined) continue
      open().push({
        type: 'tool',
        // The call's own id, not a minted one: it is the pair the output below
        // settles, and nothing correlates it across messages afterwards.
        id: item.call_id,
        name: item.name,
        executed: true,
        state: {
          status: 'completed',
          input: parseArguments(item.arguments),
          content: [{ type: 'text', text: output }],
        },
        time: { created: DateTime.makeUnsafe(stamp()) },
      })
      continue
    }
    // A tool result: already folded into the call it answers.
  }

  return messages
}
