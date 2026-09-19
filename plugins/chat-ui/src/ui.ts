import type { ComposerProps, ConversationProps } from '@oru/ui'
import type { ChatUiDef } from './defs.ts'
import * as ComposerArea from './composer-area.ts'
import * as Conversation from './conversation.ts'

/**
 * The `ui` facet entry: the definitions the host bundles and the app
 * imports. Each def is typed by the submodel it wraps, so this module
 * assigns without casts; the loader reads `defs` and validates each
 * record's slot and definition id against the snapshot before mounting it.
 */
export const composerDef: ChatUiDef<
  ComposerArea.Model,
  ComposerArea.Message,
  ComposerProps,
  ComposerArea.OutMessage
> = {
  slot: 'composer',
  defId: 'composer',
  init: ComposerArea.init,
  update: ComposerArea.update,
  view: ComposerArea.view,
  absorb: ComposerArea.absorbProps,
  signal: ComposerArea.signal,
}

export const conversationDef: ChatUiDef<
  Conversation.Model,
  Conversation.Message,
  ConversationProps,
  never
> = {
  slot: 'conversation',
  defId: 'conversation',
  init: Conversation.init,
  update: Conversation.update,
  view: Conversation.view,
}

export const defs = [composerDef, conversationDef]
