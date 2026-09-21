import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import type { PanelProps } from '@oru/ui'
import { defineTerminalElement, terminalElementSpec } from './element.ts'

/**
 * The `panel/terminal` submodel: one terminal tab instance.
 *
 * Root instantiates one outlet per open tab with distinct `sessionId`
 * props; the view renders `<oru-terminal ws-url session-id>` flush
 * (full tab area, definite height, no host scroll). The custom element
 * owns the imperative restty lifecycle; the submodel stays pure.
 * The WS URL is same-origin `/pty/:sessionId`, so no host address travels
 * through props — `absorb` derives it from `sessionId`.
 */

export const Model = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  wsUrl: Schema.optional(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Noop: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({})

export const update = (model: Model, message: Message): { readonly model: Model } =>
  Message.match(message, {
    Noop: () => ({ model }),
  })

const wsUrlFor = (sessionId: string): string | undefined => {
  if (typeof location === 'undefined') return undefined
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${location.host}/pty/${sessionId}`
}

export const absorbProps = (model: Model, props: PanelProps): Model => {
  if (props.sessionId.length === 0) return model
  if (model.sessionId === props.sessionId && model.wsUrl !== undefined) return model
  return { sessionId: props.sessionId, wsUrl: wsUrlFor(props.sessionId) }
}

export const view = defineView<Model, Message, PanelProps>((model, props, h) => {
  defineTerminalElement()
  const terminal = terminalElementSpec.withMessage(h)
  const sessionId = model.sessionId ?? props.sessionId
  const wsUrl = model.wsUrl ?? (sessionId.length > 0 ? wsUrlFor(sessionId) : undefined)
  if (sessionId.length === 0 || wsUrl === undefined) {
    return h.div(
      [h.Class('flex h-full items-center justify-center text-xs text-muted-foreground')],
      ['no terminal session'],
    )
  }
  void model
  return h.div(
    [h.DataAttribute('terminal-tab', sessionId), h.Class('flex h-full min-h-0 flex-col')],
    [
      terminal(
        [
          terminal.SessionId(sessionId),
          terminal.WsUrl(wsUrl),
          h.Class('min-h-0 flex-1'),
          h.DataAttribute('ws-url', wsUrl),
          h.DataAttribute('session-id', sessionId),
        ],
        [],
      ),
    ],
  )
})

export type TerminalUpdate = Update.Return<Model, Message>
