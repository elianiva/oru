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
 * (full tab area, definite height, no host scroll). The attributes are
 * literal (`h.Attribute`, not `DataAttribute`, not JS properties): the
 * element reads `ws-url` and observes both names. The custom element
 * owns the imperative restty lifecycle; the submodel stays pure.
 * The WS URL travels in props (the server advertises it at creation);
 * deriving from `location` is only the fallback.
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

const wsUrlOfProps = (props: PanelProps): string | undefined => {
  if (props.wsUrl !== undefined && props.wsUrl.length > 0) {
    if (props.wsUrl.startsWith('ws://') || props.wsUrl.startsWith('wss://')) return props.wsUrl
    if (typeof location === 'undefined') return props.wsUrl
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${location.host}${props.wsUrl}`
  }
  if (props.sessionId.length === 0) return undefined
  return wsUrlFor(props.sessionId)
}

export const absorbProps = (model: Model, props: PanelProps): Model => {
  if (props.sessionId.length === 0) return model
  if (model.sessionId === props.sessionId && model.wsUrl !== undefined) return model
  return { sessionId: props.sessionId, wsUrl: wsUrlOfProps(props) }
}

export const view = defineView<Model, Message, PanelProps>((model, props, h) => {
  defineTerminalElement()
  const terminal = terminalElementSpec.withMessage(h)
  const sessionId = model.sessionId ?? props.sessionId
  const wsUrl = model.wsUrl ?? wsUrlOfProps({ ...props, sessionId })
  if (sessionId.length === 0 || wsUrl === undefined) {
    return h.div(
      [h.Class('flex h-full items-center justify-center text-xs text-muted-foreground')],
      ['no terminal session'],
    )
  }
  return h.div(
    [h.DataAttribute('terminal-tab', sessionId), h.Class('flex h-full min-h-0 flex-col')],
    [
      terminal(
        [
          h.Attribute('ws-url', wsUrl),
          h.Attribute('session-id', sessionId),
          h.Class('min-h-0 flex-1'),
        ],
        [],
      ),
    ],
  )
})

export type TerminalUpdate = Update.Return<Model, Message>
