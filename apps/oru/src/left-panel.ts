/**
 * The left sidebar: menu, thread list, and sidebar actions.
 *
 * A thin submodel over the thread list. The model, messages, and update loop
 * are the thread list's own; this module only adds the sidebar container —
 * background, sizing, and the `data-left-panel` hook — so `root.ts` never
 * learns what a thread is and the row rendering stays in `thread-list.ts`.
 */
import { Option } from 'effect'
import { defineView } from 'foldkit/submodel'
import * as ThreadList from './thread-list.ts'
import type { ThreadSection } from './threads.ts'

export const Model = ThreadList.Model
export type Model = ThreadList.Model
export const Message = ThreadList.Message
export type Message = ThreadList.Message
export const OutMessage = ThreadList.OutMessage
export type OutMessage = ThreadList.OutMessage
export const init = ThreadList.init
export const update = ThreadList.update
export const subscriptions = ThreadList.subscriptions

export type ViewInputs = Readonly<{
  sections: ReadonlyArray<ThreadSection>
  selected: Option.Option<string>
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
  h.div(
    [
      h.DataAttribute('left-panel', ''),
      h.Class('flex h-full min-h-0 flex-col text-sidebar-foreground'),
    ],
    [ThreadList.view(model, { sections: viewInputs.sections, selected: viewInputs.selected }, h)],
  ),
)
