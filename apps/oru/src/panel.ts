import { Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { View as SubmodelView } from 'foldkit/submodel'
import type { PanelProps } from '@oru/ui'
import { getDef } from './ui-defs.ts'

/**
 * The host-owned right-panel terminal tabs.
 *
 * The host owns the tab strip, the `+` launcher, and tab identity; the
 * `oru/terminal-ghostty` plugin owns the tab *content* through the
 * additive `panel` slot (one `terminal` def, N tab instances). Root keeps
 * one outlet per open tab and renders the active one flush (full tab area,
 * definite height, no host scroll) — bb's `threadPanelAction` shape.
 */

export const PanelTab = Schema.Struct({
  sessionId: Schema.String,
  projectId: Schema.optional(Schema.String),
  title: Schema.String,
  wsUrl: Schema.optional(Schema.String),
})
export type PanelTab = typeof PanelTab.Type

export const PanelBundle = Schema.Struct({
  plugin: Schema.String,
  defId: Schema.String,
  address: Schema.String,
  jsUrl: Schema.String,
  sdkMajor: Schema.Number,
})
export type PanelBundle = typeof PanelBundle.Type

export type PanelOutlet =
  | { readonly _tag: 'Empty' }
  | {
      readonly _tag: 'Loading'
      readonly plugin: string
      readonly defId: string
      readonly slot: string
      readonly jsUrl: string
      readonly address: string
    }
  | {
      readonly _tag: 'Ready'
      readonly plugin: string
      readonly defId: string
      readonly slot: string
      readonly address: string
      readonly childModel: unknown
    }
  | {
      readonly _tag: 'Failed'
      readonly plugin: string
      readonly defId: string
      readonly slot: string
      readonly reason: string
    }

export interface PanelViewInputs<M> {
  readonly tabs: ReadonlyArray<PanelTab>
  readonly activeId: string | undefined
  readonly outlets: Readonly<Record<string, PanelOutlet>>
  readonly bundle: PanelBundle | undefined
  readonly creating: boolean
  readonly error: string | undefined
  readonly threadId: string | undefined
  readonly messages: {
    readonly newTerminal: M
    readonly selectTab: (sessionId: string) => M
    readonly closeTab: (sessionId: string) => M
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: child messages are the def's own dispatches, forwarded into its update untouched (same rule as root's foldComposerUi)
    readonly child: (sessionId: string, message: unknown) => M
  }
}

const terminalOutlet = <M>(inputs: PanelViewInputs<M>, tab: PanelTab, h: HtmlBuilder<M>): Html => {
  const outlet = inputs.outlets[tab.sessionId]
  const bundle = inputs.bundle
  if (bundle === undefined || outlet === undefined || !Predicate.isTagged(outlet, 'Ready')) {
    return h.div(
      [
        h.DataAttribute('terminal-loading', tab.sessionId),
        h.Class('flex h-full min-h-0 items-center justify-center text-xs text-muted-foreground'),
      ],
      [bundle === undefined ? 'terminal unavailable' : 'starting terminal…'],
    )
  }
  const def = getDef(bundle.plugin, bundle.defId, bundle.address)
  if (def === undefined) {
    return h.div(
      [
        h.DataAttribute('terminal-loading', tab.sessionId),
        h.Class('flex h-full min-h-0 items-center justify-center text-xs text-muted-foreground'),
      ],
      ['starting terminal…'],
    )
  }
  const props: PanelProps = {
    sessionId: tab.sessionId,
    projectId: tab.projectId,
    threadId: inputs.threadId,
    title: tab.title,
    wsUrl: tab.wsUrl,
  }
  // SAFETY: the brand is type-level-only per foldkit's docs, so a def view built by another foldkit copy stays structurally compatible (same rule as root's composer-outlet).
  return h.submodel({
    slotId: `panel-terminal-${tab.sessionId}`,
    model: outlet.childModel,
    view: def.view as SubmodelView<unknown, unknown, PanelProps>,
    viewInputs: props,
    toParentMessage: (childMessage) => inputs.messages.child(tab.sessionId, childMessage),
  })
}

/**
 * Tab strip + launcher + all tabs (inactives hidden, never unmounted:
 * unmounting would disconnect the terminal element and kill its PTY).
 * Pure view over root state: every button dispatches a root message the
 * caller built, so this module never imports root (no cycle) — same shape
 * as `RightPanel.view`.
 */
export const view = <M>(inputs: PanelViewInputs<M>, h: HtmlBuilder<M>): Html => {
  const active = inputs.tabs.find((tab) => tab.sessionId === inputs.activeId) ?? inputs.tabs[0]
  return h.div(
    [
      h.DataAttribute('panel-tabs', ''),
      h.Class('flex h-full min-h-0 flex-col text-sidebar-foreground'),
    ],
    [
      h.div(
        [h.Class('flex h-9 shrink-0 items-center gap-1 px-2')],
        [
          ...inputs.tabs.map((tab) =>
            h.div(
              [
                h.DataAttribute('panel-tab', tab.sessionId),
                h.Class(
                  tab.sessionId === active?.sessionId
                    ? 'flex min-w-0 items-center gap-1 rounded-md bg-sidebar-accent px-2 py-1'
                    : 'flex min-w-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent/60',
                ),
              ],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(inputs.messages.selectTab(tab.sessionId)),
                    h.DataAttribute('panel-tab-select', tab.sessionId),
                    h.Class('min-w-0 truncate text-xs'),
                  ],
                  [tab.title],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(inputs.messages.closeTab(tab.sessionId)),
                    h.DataAttribute('panel-tab-close', tab.sessionId),
                    h.AriaLabel(`Close ${tab.title}`),
                    h.Class('shrink-0 text-xs text-muted-foreground hover:text-foreground'),
                  ],
                  ['×'],
                ),
              ],
            ),
          ),
          h.button(
            [
              h.Type('button'),
              h.OnClick(inputs.messages.newTerminal),
              h.DataAttribute('panel-new-terminal', ''),
              h.Class(
                'ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              ),
            ],
            [inputs.creating ? 'starting…' : '+ Terminal'],
          ),
        ],
      ),
      ...(inputs.error === undefined
        ? []
        : [
            h.p(
              [
                h.DataAttribute('panel-error', ''),
                h.Class('shrink-0 px-3 py-1 text-xs text-destructive'),
              ],
              [inputs.error],
            ),
          ]),
      h.div(
        [h.DataAttribute('panel-content', ''), h.Class('min-h-0 flex-1')],
        [
          ...(active === undefined
            ? [
                h.div(
                  [
                    h.Class(
                      'flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center',
                    ),
                  ],
                  [h.p([h.Class('text-xs text-muted-foreground')], ['No terminal yet.'])],
                ),
              ]
            : inputs.tabs.map((tab) =>
                h.div(
                  [
                    h.DataAttribute('panel-tab-body', tab.sessionId),
                    h.Class(
                      tab.sessionId === active.sessionId
                        ? 'h-full min-h-0'
                        : 'hidden h-full min-h-0',
                    ),
                  ],
                  [terminalOutlet(inputs, tab, h)],
                ),
              )),
        ],
      ),
    ],
  )
}
