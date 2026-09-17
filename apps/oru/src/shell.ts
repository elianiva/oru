/**
 * The three-column shell: left sidebar, main, right sidebar.
 *
 * Chrome: the columns are built by the caller and handed in as slot callbacks,
 * so the shell never learns what a thread is.
 *
 * The engine's model *is* the shell's model. A sidebar is collapsed exactly when
 * its panel sits at its collapsed size, so no flag can disagree with a drag.
 */
import { Effect, Match, Option, Schema as S, Stream } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { PanelLeft, PanelRight } from 'lucide'
import * as Resizable from '@/components/ui/resizable.ts'
import { layoutNumbersEqual } from '@/components/ui/resizable-box.ts'
import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'

export const Model = Resizable.Model
export type Model = typeof Model.Type

const sideSchema = S.Literals(['left', 'right'])
export type Side = typeof sideSchema.Type

export const Message = defineMessageUnion({
  GotGroup: { message: Resizable.Message },
  ToggledSidebar: { side: sideSchema },
})
export type Message = typeof Message.Type

const LEFT_PANEL = 'left'
const RIGHT_PANEL = 'right'
const MAIN_PANEL = 'main'

const SHELL_ID = 'oru-shell'
const STORAGE_KEY = 'oru.shell.layout'

const REFERENCE_VIEWPORT_WIDTH = 1440

/**
 * Pixels are converted once, against a named reference viewport, so the same
 * percentage is a wider sidebar on a wider window. Measuring the container
 * instead would write into the engine during a drag.
 */
const percentOfReference = (pixels: number): number => (pixels / REFERENCE_VIEWPORT_WIDTH) * 100

const MAIN_MIN_PERCENT = 30

export const panels: ReadonlyArray<Resizable.PanelConfig> = [
  {
    id: LEFT_PANEL,
    defaultSize: percentOfReference(320),
    minSize: percentOfReference(240),
    maxSize: percentOfReference(460),
    collapsible: true,
    collapsedSize: 0,
  },
  { id: MAIN_PANEL, minSize: MAIN_MIN_PERCENT },
  {
    id: RIGHT_PANEL,
    defaultSize: percentOfReference(360),
    minSize: percentOfReference(280),
    maxSize: percentOfReference(640),
    collapsible: true,
    collapsedSize: 0,
  },
]

type PanelState = Model['panels'][number]

const isDragging = (model: Model): boolean =>
  Match.value(model.dragState).pipe(
    Match.tagsExhaustive({ Idle: () => false, Dragging: () => true }),
  )

const isCollapsedPanel = (panel: PanelState): boolean =>
  panel.collapsible && layoutNumbersEqual(panel.size, panel.collapsedSize)

export const isCollapsed = (model: Model, which: Side): boolean => {
  const panel = model.panels.find((candidate) => candidate.id === which)
  return panel !== undefined && isCollapsedPanel(panel)
}

const restoreSize = (panel: PanelState): number =>
  Option.getOrElse(panel.expandedSize, () =>
    Option.getOrElse(panel.defaultSize, () => panel.minSize),
  )

/**
 * The layout a toggle would commit: built from the engine's own numbers, by the
 * engine's own collapse rule — a collapsible panel moves between its collapsed
 * and expanded sizes — generalised from "the panel left of a separator" to "the
 * panel you named", which is the gap the engine's `Enter` gesture leaves because
 * it cannot reach the last panel.
 */
export const toggledLayout = (model: Model, panelId: Side): Option.Option<Resizable.Layout> => {
  const index = model.panels.findIndex((candidate) => candidate.id === panelId)
  const panel = model.panels[index]
  if (panel === undefined || !panel.collapsible) return Option.none()
  const target = isCollapsedPanel(panel) ? restoreSize(panel) : panel.collapsedSize
  const neighbourIndex = index < model.panels.length - 1 ? index + 1 : index - 1
  const neighbour = model.panels[neighbourIndex]
  return Option.some(
    Object.fromEntries(
      model.panels.map((current, currentIndex) => {
        if (currentIndex === index) return [current.id, target]
        if (currentIndex === neighbourIndex && neighbour !== undefined) {
          return [current.id, neighbour.size + (panel.size - target)]
        }
        return [current.id, current.size]
      }),
    ),
  )
}

export const togglePanel = (model: Model, panelId: Side): Model =>
  Option.match(toggledLayout(model, panelId), {
    onNone: () => model,
    onSome: (layout) => Resizable.reflect(model, layout),
  })

export const storableLayout = (model: Model): Option.Option<Resizable.Layout> =>
  isDragging(model) ? Option.none() : Option.some(Resizable.layoutFromModel(model))

const decodeStoredLayout = S.decodeUnknownOption(S.fromJsonString(S.Record(S.String, S.Number)))

const readStoredLayout = (): Option.Option<Resizable.Layout> => {
  if (typeof localStorage === 'undefined') return Option.none()
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === null ? Option.none() : decodeStoredLayout(raw)
}

const writeStoredLayout = (layout: Resizable.Layout): Effect.Effect<void> =>
  Effect.sync(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  }).pipe(Effect.catchDefect(() => Effect.void))

/**
 * A restored layout enters through `reflect`, not through `init`'s
 * `defaultLayout`, because `defaultLayout` would overwrite each panel's
 * configured `defaultSize`, and with it the size a collapsed sidebar returns to.
 */
export const init = (): Model => {
  const model = Resizable.init({ id: SHELL_ID, panels })
  return Option.match(readStoredLayout(), {
    onNone: () => model,
    onSome: (layout) => Resizable.reflect(model, layout),
  })
}

const foldGroup = Update.foldChild({
  update: Resizable.update,
  read: (model: Model) => Option.some(model),
  write: (_model, next) => next,
  toParentMessage: (message: Resizable.Message) => Message.GotGroup({ message }),
  // Declaring this channel is what lets `foldChild` accept a child update that
  // returns an out-message. The engine's `LayoutChanged` names a layout the
  // shell already holds, so there is nothing to do with it.
  foldOutMessage: (outMessage): Update.Step<Model, Message> =>
    Resizable.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      LayoutChanged: () => (model) => ({ model }),
    }),
})

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    GotGroup: ({ message: groupMessage }) => foldGroup(model, groupMessage),
    ToggledSidebar: ({ side }) => ({ model: togglePanel(model, side) }),
  })

const groupSubscriptions = Subscription.lift(Resizable.subscriptions)({
  toChildModel: (model: Model) => model,
  toParentMessage: (message: Resizable.Message): Message => Message.GotGroup({ message }),
})

const layoutMirror = Subscription.make<Model, Message>()((entry) => ({
  layoutMirror: entry(
    { storable: S.Option(S.Record(S.String, S.Number)) },
    {
      modelToDependencies: (model) => ({ storable: storableLayout(model) }),
      dependenciesToStream: ({ storable }) =>
        Stream.callback<Message>(() =>
          Option.match(storable, {
            onNone: () => Effect.void,
            onSome: writeStoredLayout,
          }).pipe(Effect.flatMap(() => Effect.never)),
        ),
    },
  ),
}))

export const subscriptions = Subscription.aggregate<Model, Message>()(
  groupSubscriptions,
  layoutMirror,
)

/**
 * A header toggle is hover-only: it keeps `aria-expanded` for assistive tech
 * but never takes the `aria-expanded:` active wash the ghost button variant
 * paints, so an open sidebar doesn't leave its toggle looking pressed.
 */
const toggleButton = (which: Side, collapsed: boolean, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.OnClick(Message.ToggledSidebar({ side: which })),
      h.Class(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
      ),
      h.DataAttribute('shell-toggle', which),
      h.AriaExpanded(!collapsed),
      h.AriaLabel(collapsed ? `Expand ${which} sidebar` : `Collapse ${which} sidebar`),
    ],
    [icon(h, which === 'left' ? PanelLeft : PanelRight, 'size-4')],
  )

export type ViewInputs = Readonly<{
  /** Slot callbacks, not built `Html`: a vnode carrying a handler throws across a `viewInputs` boundary. */
  toLeftPanel: () => Html
  toMain: () => Html
  toRightPanel: () => Html
}>

/**
 * Both toggles sit on a seam, so a sidebar can be brought back while it is
 * closed, which a control inside that sidebar could not do.
 */
const mainColumn = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex h-full min-h-0 flex-col')],
    [
      h.header(
        [h.Class('flex h-10 shrink-0 items-center gap-1 px-3')],
        [
          toggleButton('left', isCollapsed(model, 'left'), h),
          h.span([h.Class('truncate px-2 text-sm font-medium')], ['oru']),
          h.div([h.Class('flex-1')], []),
          toggleButton('right', isCollapsed(model, 'right'), h),
        ],
      ),
      h.div([h.Class('flex min-h-0 flex-1 flex-col')], [viewInputs.toMain()]),
    ],
  )

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
  const column = (index: number): Html => {
    if (index === 0) return viewInputs.toLeftPanel()
    if (index === 1) return mainColumn(model, viewInputs, h)
    return viewInputs.toRightPanel()
  }
  return h.div(
    [h.Class('flex h-svh w-full flex-col overflow-hidden bg-sidebar')],
    [
      h.submodel({
        slotId: 'shell-group',
        model,
        view: Resizable.view,
        viewInputs: {
          className: 'min-h-0 flex-1 bg-sidebar p-3',
          handleLabel: 'Resize panels',
          panels: [
            {
              // A collapsing sidebar fades its content while the resizable
              // panel animates its width; `visibility` flips discretely at
              // the end of the fade out (and at the start of the fade in).
              className: cn(
                'overflow-hidden! transition-[opacity,visibility] duration-200 ease-out',
                isCollapsed(model, 'left') ? 'invisible opacity-0' : 'visible opacity-100',
              ),
            },
            {
              // The center column is the only card: a rounded fill on the
              // frame background, separated by whitespace instead of seams.
              className: 'rounded-xl bg-background border border-[0.5px]',
            },
            {
              className: cn(
                'overflow-hidden! transition-[opacity,visibility] duration-200 ease-out',
                isCollapsed(model, 'right') ? 'invisible opacity-0' : 'visible opacity-100',
              ),
            },
          ],
          // A collapsed panel is zero-width, so its separator keeps its place
          // rather than taking `hidden`, which would take the hit area with it.
          handles: [
            {
              className: cn(
                'w-3 bg-transparent transition-opacity duration-200 ease-out',
                isCollapsed(model, 'left') && 'w-0 opacity-0',
              ),
            },
            {
              className: cn(
                'w-3 bg-transparent transition-opacity duration-200 ease-out',
                isCollapsed(model, 'right') && 'w-0 opacity-0',
              ),
            },
          ],
          toPanelContent: (index) => column(index),
        },
        toParentMessage: (message) => Message.GotGroup({ message }),
      }),
    ],
  )
})
