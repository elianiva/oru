/** Stateful submodel. Import the whole module as a namespace. */
import { Effect, Match, Option, Queue, Schema as S, Stream } from 'effect'
import {
  childAttributes,
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
} from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import type { View as SubmodelView } from 'foldkit/submodel'
import * as Command from 'foldkit/command'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'

import { icon } from '@/lib/icons.ts'
import { cn } from '@/lib/utils.ts'
import { PanelLeft } from 'lucide'

import { type ButtonSize, type ButtonVariant } from './button.ts'
import { inputClass } from './input.ts'
import * as Sheet from './sheet.ts'
import { skeletonClass } from './skeleton.ts'
import * as Tooltip from './tooltip.ts'

type Child = Html | string

/** Attributes or pre-built attribute fragments a caller can spread onto an
 *  element built with their own `h`. */
type Attributes<M> = ReadonlyArray<Attribute<M> | ChildAttribute>

// Sidebar is a collapsible application shell with desktop and mobile modes.

export const SIDEBAR_WIDTH = '16rem'
export const SIDEBAR_WIDTH_MOBILE = '18rem'
export const SIDEBAR_WIDTH_ICON = '3rem'
export const SIDEBAR_COOKIE_NAME = 'sidebar_state'
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
export const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

/** Viewport below Tailwind's `md` breakpoint counts as mobile (upstream
 *  `useIsMobile`). */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

export const Message = defineMessageUnion({
  Toggled: {},
  SetIsOpen: { isOpen: S.Boolean },
  SetIsMobile: { isMobile: S.Boolean },
  GotSheetMessage: { message: Sheet.Message },
})
export type Message = typeof Message.Type

/** Sidebar state: desktop expansion, mobile viewport flag, and the mobile
 *  off-canvas Sheet submodel that owns the open-on-mobile presentation. */
export const Model = S.Struct({
  cookieName: S.String,
  isOpen: S.Boolean,
  isMobile: S.Boolean,
  sheet: Sheet.Model,
})
export type Model = typeof Model.Type

export type InitConfig = Readonly<{
  /** Unique id for this sidebar instance (names the embedded mobile Sheet). */
  id: string
  /** Desktop initial expansion. Defaults to `true` like upstream. */
  defaultOpen?: boolean
  /** Cookie used to persist the desktop expanded/collapsed state. */
  cookieName?: string
}>

export const init = ({
  id,
  defaultOpen = true,
  cookieName = SIDEBAR_COOKIE_NAME,
}: InitConfig): Model => ({
  cookieName,
  isOpen: readOpenCookie(cookieName) ?? defaultOpen,
  isMobile: false,
  sheet: Sheet.init({ id: `${id}-mobile-sheet` }),
})

/** `'expanded' | 'collapsed'`, emitted as `data-state` on the shell. */
export const state = (model: Model): 'expanded' | 'collapsed' =>
  model.isOpen ? 'expanded' : 'collapsed'

export const setOpen = (model: Model, isOpen: boolean): Model =>
  evo(model, { isOpen: () => isOpen })

const mapSheet = (
  model: Model,
  {
    model: next,
    commands = [],
  }: Update.ReturnWithOutMessage<Sheet.Model, Sheet.Message, Sheet.OutMessage>,
): Update.Return<Model, Message> => ({
  model: evo(model, { sheet: () => next }),
  commands: Command.mapMessages(commands, (message) => Message.GotSheetMessage({ message })),
})

/** Open the off-canvas mobile sidebar. */
export const openMobile = (model: Model): Update.Return<Model, Message> =>
  mapSheet(model, Sheet.open(model.sheet))

/** Close the off-canvas mobile sidebar. */
export const closeMobile = (model: Model): Update.Return<Model, Message> =>
  mapSheet(model, Sheet.close(model.sheet))

/** Toggle like upstream `toggleSidebar`: mobile viewports toggle the Sheet,
 *  desktop viewports toggle the collapse state. */
export const toggle = (model: Model): Update.Return<Model, Message> =>
  model.isMobile
    ? model.sheet.isOpen
      ? closeMobile(model)
      : openMobile(model)
    : { model: setOpen(model, !model.isOpen) }

const foldNoOpStep = (): Update.Step<Model, Message> => (model) => ({ model })

const foldSheetOutMessage = Match.type<Sheet.OutMessage>().pipe(
  Match.withReturnType<Update.Step<Model, Message>>(),
  Match.tagsExhaustive({
    Opened: foldNoOpStep,
    Closed: foldNoOpStep,
  }),
)

const foldSheet = Update.foldChild({
  update: Sheet.update,
  read: (model: Model) => Option.some(model.sheet),
  write: (model, next) => evo(model, { sheet: () => next }),
  toParentMessage: (message) => Message.GotSheetMessage({ message }),
  foldOutMessage: foldSheetOutMessage,
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Match.value(message).pipe(
    Match.withReturnType<Update.Return<Model, Message>>(),
    Match.tagsExhaustive({
      Toggled: () => toggle(model),
      SetIsOpen: ({ isOpen }) => ({ model: setOpen(model, isOpen) }),
      SetIsMobile: ({ isMobile }) => ({ model: evo(model, { isMobile: () => isMobile }) }),
      GotSheetMessage: ({ message }) => foldSheet(model, message),
    }),
  )

function readOpenCookie(cookieName: string): boolean | undefined {
  if (typeof document === 'undefined') {
    return undefined
  }

  const prefix = `${encodeURIComponent(cookieName)}=`
  const value = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length)

  return value === 'true' ? true : value === 'false' ? false : undefined
}

const writeOpenCookie = (cookieName: string, isOpen: boolean): void => {
  if (typeof document !== 'undefined') {
    document.cookie = `${encodeURIComponent(cookieName)}=${isOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
  }
}

const hydrateOpenState = (cookieName: string, isOpen: boolean): void => {
  if (typeof document === 'undefined') {
    return
  }

  const escapedCookieName = CSS.escape(cookieName)
  for (const wrapper of document.querySelectorAll<HTMLElement>(
    `[data-slot="sidebar-wrapper"][data-sidebar-cookie="${escapedCookieName}"]`,
  )) {
    const sidebar = wrapper.querySelector<HTMLElement>('[data-slot="sidebar"]:not([data-mobile])')
    if (!sidebar) {
      continue
    }

    sidebar.dataset.state = isOpen ? 'expanded' : 'collapsed'
    sidebar.dataset.collapsible = isOpen ? '' : (sidebar.dataset.sidebarCollapsible ?? '')
  }
}

/** Global listeners for an embedded sidebar: the upstream ⌘/Ctrl+B shortcut
 *  (always listening, like upstream's window keydown effect) and a media-query
 *  listener that keeps `isMobile` in sync with the viewport. Lift with
 *  `Subscription.lift(Sidebar.subscriptions)` from your slice. */
export const subscriptions = Subscription.make<Model, Message>()((entry) => {
  let cookieHydrated = false

  return {
    cookie: entry(
      { cookieName: S.String, isOpen: S.Boolean },
      {
        modelToDependencies: (model) => ({
          cookieName: model.cookieName,
          isOpen: model.isOpen,
        }),
        dependenciesToStream: ({ cookieName, isOpen }) =>
          Stream.callback<Message>((queue) =>
            Effect.sync(() => {
              const stored = readOpenCookie(cookieName)
              if (!cookieHydrated) {
                cookieHydrated = true
                if (stored !== undefined && stored !== isOpen) {
                  hydrateOpenState(cookieName, stored)
                  Queue.offerUnsafe(queue, Message.SetIsOpen({ isOpen: stored }))
                } else {
                  writeOpenCookie(cookieName, isOpen)
                }
              } else {
                writeOpenCookie(cookieName, isOpen)
              }
            }).pipe(Effect.flatMap(() => Effect.never)),
          ),
      },
    ),
    keyboardShortcut: entry(
      { isListening: S.Boolean },
      {
        modelToDependencies: () => ({ isListening: true }),
        dependenciesToStream: ({ isListening }) =>
          Stream.when(
            Subscription.fromEventFilterMap<KeyboardEvent, Message>({
              target: window,
              type: 'keydown',
              toMessage: (event) => {
                if (
                  event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault()
                  return Option.some(Message.Toggled())
                }
                return Option.none()
              },
            }),
            Effect.sync(() => isListening),
          ),
      },
    ),
    mediaQuery: entry(
      { isListening: S.Boolean },
      {
        modelToDependencies: () => ({ isListening: true }),
        dependenciesToStream: ({ isListening }) =>
          Stream.when(
            Stream.callback<Message>((queue) =>
              Effect.acquireRelease(
                Effect.sync(() => {
                  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
                  const handler = (event: MediaQueryListEvent) => {
                    Queue.offerUnsafe(queue, Message.SetIsMobile({ isMobile: event.matches }))
                  }
                  mediaQuery.addEventListener('change', handler)
                  // Emit once on subscribe so a mobile viewport corrects the
                  // desktop default right after mount.
                  Queue.offerUnsafe(queue, Message.SetIsMobile({ isMobile: mediaQuery.matches }))
                  return { mediaQuery, handler }
                }),
                ({ mediaQuery, handler }) =>
                  Effect.sync(() => mediaQuery.removeEventListener('change', handler)),
              ).pipe(Effect.flatMap(() => Effect.never)),
            ),
            Effect.sync(() => isListening),
          ),
      },
    ),
  }
})

export const sidebarProviderClass =
  'group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar'

/** Upstream Sidebar outer container (desktop only; carries the group/peer
 *  hooks every data-[…] variant keys off). */
export const sidebarShellClass = 'group peer hidden text-sidebar-foreground md:block'

/** Upstream SidebarGap base string. */
export const sidebarGapClass =
  'transition-[width] duration-200 ease-linear relative w-(--sidebar-width) bg-transparent group-data-[collapsible=offcanvas]:w-0 group-data-[side=right]:rotate-180'

/** Upstream SidebarContainer base string. */
export const sidebarContainerClass =
  'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex'

/** Icon-mode width adjustments, keyed by whether the variant floats inside
 *  padding (floating/inset) or docks flush (sidebar). */
export const sidebarIconWidthClass: Readonly<Record<'docked' | 'padded', string>> = {
  docked: 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
  padded: 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]',
}

/** Variant extras for the container: flush variants draw the border, padded
 *  ones get breathing room. */
export const sidebarContainerVariantClass: Readonly<Record<'docked' | 'padded', string>> = {
  docked:
    'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
  padded:
    'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]',
}

/** Upstream collapsible="none" panel string. */
export const sidebarStaticClass =
  'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground'

/** Upstream mobile SheetContent string, re-keyed to foldcn's Sheet panel slot;
 *  narrows the width var to the mobile size. */
export const sidebarMobilePanelClass =
  'bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden [--sidebar-width:18rem] w-(--sidebar-width)'

/** Upstream SidebarRail string. */
export const sidebarRailClass =
  'hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2 in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize [[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar [[data-side=left][data-collapsible=offcanvas]_&]:-right-2 [[data-side=right][data-collapsible=offcanvas]_&]:-left-2'

/** Upstream SidebarHeader string. */
export const sidebarHeaderClass = 'gap-2 p-2 flex flex-col'

/** Upstream SidebarContent string. */
export const sidebarContentClass =
  'no-scrollbar gap-0 flex min-h-0 flex-1 flex-col overflow-auto group-data-[collapsible=icon]:overflow-hidden'

/** Upstream SidebarFooter string. */
export const sidebarFooterClass = 'gap-2 p-2 flex flex-col'

/** Upstream SidebarGroup string. */
export const sidebarGroupClass = 'p-2 relative flex w-full min-w-0 flex-col'

/** Upstream SidebarGroupLabel string (sizing/color from the token). */
export const sidebarGroupLabelClass =
  'text-sidebar-foreground/70 ring-sidebar-ring h-8 rounded-md px-2 text-xs font-medium transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 flex shrink-0 items-center outline-hidden [&>svg]:shrink-0'

/** Upstream SidebarGroupAction string. */
export const sidebarGroupActionClass =
  'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 w-5 rounded-md p-0 focus-visible:ring-2 [&>svg]:size-4 flex aspect-square items-center justify-center outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 md:after:hidden [&>svg]:shrink-0'

/** Upstream SidebarGroupContent string. */
export const sidebarGroupContentClass = 'text-sm w-full'

/** Upstream SidebarMenu string. */
export const sidebarMenuClass = 'gap-0 flex w-full min-w-0 flex-col'

export const sidebarMenuItemClass = 'group/menu-item relative'

export type MenuButtonVariant = Extract<ButtonVariant, 'default' | 'outline'>
export type MenuButtonSize = Extract<ButtonSize, 'default' | 'sm' | 'lg'>

/** Upstream SidebarMenuButton cva base. */
export const sidebarMenuButtonClass =
  'ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground gap-2 rounded-md p-2 text-left text-sm transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-active:font-medium peer/menu-button group/menu-button flex w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate'

export const sidebarMenuButtonVariantClass: Readonly<Record<MenuButtonVariant, string>> = {
  default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  outline:
    'bg-background hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-[0_0_0_1px_var(--sidebar-border)] hover:shadow-[0_0_0_1px_var(--sidebar-accent)]',
}

export const sidebarMenuButtonSizeClass: Readonly<Record<MenuButtonSize, string>> = {
  default: 'h-8 text-sm',
  sm: 'h-7 text-xs',
  lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
}

/** Upstream SidebarMenuAction string. */
export const sidebarMenuActionClass =
  'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 aspect-square w-5 rounded-md p-0 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 focus-visible:ring-2 [&>svg]:size-4 flex items-center justify-center outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 md:after:hidden [&>svg]:shrink-0'

/** Extra classes upstream applies when MenuAction sets showOnHover. */
export const sidebarMenuActionShowOnHoverClass =
  'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0'

/** Upstream SidebarMenuBadge string. */
export const sidebarMenuBadgeClass =
  'text-sidebar-foreground peer-hover/menu-button:text-sidebar-accent-foreground peer-data-active/menu-button:text-sidebar-accent-foreground pointer-events-none absolute right-1 h-5 min-w-5 rounded-md px-1 text-xs font-medium peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 flex items-center justify-center tabular-nums select-none group-data-[collapsible=icon]:hidden'

/** Upstream SidebarMenuSkeleton string. */
export const sidebarMenuSkeletonClass = 'h-8 gap-2 rounded-md px-2 flex items-center'

/** Upstream SidebarMenuSub string. */
export const sidebarMenuSubClass =
  'border-sidebar-border mx-3.5 translate-x-px gap-1 border-l px-2.5 py-0.5 group-data-[collapsible=icon]:hidden flex min-w-0 flex-col'

export const sidebarMenuSubItemClass = 'group/menu-sub-item relative'

/** Upstream SidebarMenuSubButton cva base. Sizing keys off data-size. */
export const sidebarMenuSubButtonClass =
  'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground h-7 gap-2 rounded-md px-2 focus-visible:ring-2 data-[size=md]:text-sm data-[size=sm]:text-xs [&>svg]:size-4 flex min-w-0 -translate-x-px items-center overflow-hidden outline-hidden group-data-[collapsible=icon]:hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0'

/** Upstream SidebarInset string (bg + inset margins from the token). */
export const sidebarInsetClass =
  'bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 relative flex w-full flex-1 flex-col'

/** Upstream SidebarSeparator: Separator primitive + token. */
export const sidebarSeparatorClass = 'mx-2 shrink-0 bg-border h-px w-auto'

/** Upstream SidebarTrigger: ghost icon-sm Button + trigger token. */
export const sidebarTriggerClass =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg text-sidebar-foreground"

export type SidebarSide = 'left' | 'right'
export type SidebarVariant = 'sidebar' | 'floating' | 'inset'
export type SidebarCollapsible = 'offcanvas' | 'icon' | 'none'

/** Slot payload handed to the provider's content callbacks: derived state
 *  plus pre-built attributes that toggle the sidebar when spread onto any
 *  element (message-free, so they compose across submodel boundaries). */
export type SidebarSlots = Readonly<{
  isOpen: boolean
  state: 'expanded' | 'collapsed'
  isMobile: boolean
  /** Spread onto a control (typically `Sidebar.trigger`) to toggle. */
  trigger: ReadonlyArray<ChildAttribute>
  /** Spread onto `Sidebar.rail` to make the hot-spot clickable. */
  rail: ReadonlyArray<ChildAttribute>
}>

export type ProviderViewInputs = Readonly<{
  side?: SidebarSide
  variant?: SidebarVariant
  collapsible?: SidebarCollapsible
  className?: string
  /** Inside the rail (header / content / footer / rail). */
  content: (slots: SidebarSlots) => ReadonlyArray<Child>
  /** Wrapper-level children rendered after the rail, the inset page column
   *  lives here so `peer-data-[variant=inset]` margins can reach it. */
  children: (slots: SidebarSlots) => ReadonlyArray<Child>
}>

/** Interactive provider shell. Embed via `h.submodel({ view: SidebarProvider.view, … })`. */
export const view = defineView<Model, Message, ProviderViewInputs>((model, viewInputs, h) => {
  const side = viewInputs.side ?? 'left'
  const variant = viewInputs.variant ?? 'sidebar'
  const collapsible = viewInputs.collapsible ?? 'offcanvas'
  const slots: SidebarSlots = {
    isOpen: model.isOpen,
    state: state(model),
    isMobile: model.isMobile,
    trigger: childAttributes([h.OnClick(Message.Toggled())]),
    rail: childAttributes([h.OnClick(Message.Toggled())]),
  }

  const padding = variant === 'floating' || variant === 'inset' ? 'padded' : 'docked'

  // Static panel: no collapse choreography, even on mobile (matches upstream).
  if (collapsible === 'none') {
    return h.div(
      [
        h.Class(cn(sidebarProviderClass, viewInputs.className)),
        h.DataAttribute('slot', 'sidebar-wrapper'),
        h.DataAttribute('sidebar-cookie', model.cookieName),
        h.Style({ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_WIDTH_ICON }),
      ],
      [
        h.div(
          [
            h.Class(cn(sidebarStaticClass, viewInputs.className)),
            h.DataAttribute('slot', 'sidebar'),
            h.DataAttribute('sidebar', 'sidebar'),
          ],
          viewInputs.content(slots),
        ),
        ...viewInputs.children(slots),
      ],
    )
  }

  // Mobile: the rail renders as an off-canvas Sheet owned by the engine.
  // The explicit SubmodelView/ViewInputs annotations and `h.submodel<typeof
  // Sheet.view>` are load-bearing: without them TypeScript's inference of the
  // submodel's View parameter degrades inside this large view (the styled
  // inputs value then fails to check against a phantom `undefined` target).
  if (model.isMobile) {
    const mobileSheetView: SubmodelView<Sheet.Model, Sheet.Message, Sheet.ViewInputs> = Sheet.view
    // Custom ViewInputs that adds upstream's data-mobile / data-slot / data-sidebar
    // to the Sheet panel (Sheet.styledViewInputs would emit data-slot="sheet-content").
    const mobileSheetInputs: Sheet.ViewInputs = {
      toView: ({
        dialog,
        backdrop,
        panel,
        closeButton: _closeButton,
        title,
        description,
        isVisible,
      }) =>
        h.dialog(
          [
            ...dialog,
            h.DataAttribute('slot', 'sheet'),
            h.Class(cn('bg-transparent p-0 open:block')),
          ],
          isVisible
            ? [
                h.div([
                  ...backdrop,
                  h.DataAttribute('slot', 'sheet-overlay'),
                  h.Class(cn(Sheet.sheetBackdropClass)),
                ]),
                h.div(
                  [
                    ...panel,
                    h.DataAttribute('slot', 'sidebar'),
                    h.DataAttribute('sidebar', 'sidebar'),
                    h.DataAttribute('mobile', 'true'),
                    h.DataAttribute('side', side),
                    h.Style({ '--sidebar-width': SIDEBAR_WIDTH_MOBILE }),
                    h.Class(
                      cn(
                        Sheet.sheetPanelClass[side],
                        Sheet.sheetMotionClass,
                        sidebarMobilePanelClass,
                      ),
                    ),
                  ],
                  [
                    h.div(
                      [h.Class('sr-only flex flex-col')],
                      [
                        Sheet.title({ attributes: title }, ['Sidebar'], h),
                        Sheet.description(
                          { attributes: description },
                          ['Displays the mobile sidebar.'],
                          h,
                        ),
                      ],
                    ),
                    h.div([h.Class('flex h-full w-full flex-col')], viewInputs.content(slots)),
                  ],
                ),
              ]
            : [],
        ),
    }
    return h.div(
      [
        h.Class(cn(sidebarProviderClass, viewInputs.className)),
        h.DataAttribute('slot', 'sidebar-wrapper'),
        h.DataAttribute('sidebar-cookie', model.cookieName),
        h.Style({ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_WIDTH_ICON }),
      ],
      [
        h.submodel<typeof Sheet.view>({
          slotId: model.sheet.id,
          model: model.sheet,
          view: mobileSheetView,
          viewInputs: mobileSheetInputs,
          toParentMessage: (message) => Message.GotSheetMessage({ message }),
        }),
        ...viewInputs.children(slots),
      ],
    )
  }

  return h.div(
    [
      h.Class(cn(sidebarProviderClass, viewInputs.className)),
      h.DataAttribute('slot', 'sidebar-wrapper'),
      h.DataAttribute('sidebar-cookie', model.cookieName),
      h.Style({ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_WIDTH_ICON }),
    ],
    [
      h.div(
        [
          h.Class(sidebarShellClass),
          h.DataAttribute('slot', 'sidebar'),
          h.DataAttribute('sidebar', 'sidebar'),
          h.DataAttribute('state', slots.state),
          h.DataAttribute('collapsible', slots.state === 'collapsed' ? collapsible : ''),
          h.DataAttribute('sidebar-collapsible', collapsible),
          h.DataAttribute('variant', variant),
          h.DataAttribute('side', side),
        ],
        [
          h.div(
            [
              h.Class(cn(sidebarGapClass, sidebarIconWidthClass[padding])),
              h.DataAttribute('slot', 'sidebar-gap'),
            ],
            [],
          ),
          h.div(
            [
              h.Class(cn(sidebarContainerClass, sidebarContainerVariantClass[padding])),
              h.DataAttribute('slot', 'sidebar-container'),
              h.DataAttribute('side', side),
            ],
            [
              h.div(
                [
                  h.Class(
                    'bg-sidebar group-data-[variant=floating]:ring-sidebar-border group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 flex size-full flex-col',
                  ),
                  h.DataAttribute('slot', 'sidebar-inner'),
                  h.DataAttribute('sidebar', 'sidebar'),
                ],
                viewInputs.content(slots),
              ),
            ],
          ),
        ],
      ),
      ...viewInputs.children(slots),
    ],
  )
})

type StyleConfig = Readonly<{ className?: string }>

export const header = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarHeaderClass, config.className)),
      h.DataAttribute('slot', 'sidebar-header'),
      h.DataAttribute('sidebar', 'header'),
    ],
    children,
  )

export const content = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarContentClass, config.className)),
      h.DataAttribute('slot', 'sidebar-content'),
      h.DataAttribute('sidebar', 'content'),
    ],
    children,
  )

export const footer = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarFooterClass, config.className)),
      h.DataAttribute('slot', 'sidebar-footer'),
      h.DataAttribute('sidebar', 'footer'),
    ],
    children,
  )

export const group = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(sidebarGroupClass),
      h.DataAttribute('slot', 'sidebar-group'),
      h.DataAttribute('sidebar', 'group'),
    ],
    children,
  )

export const groupLabel = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarGroupLabelClass, config.className)),
      h.DataAttribute('slot', 'sidebar-group-label'),
      h.DataAttribute('sidebar', 'group-label'),
    ],
    children,
  )

/** Small action button pinned beside a group label (e.g. a "+"). Spread your
 *  onClick through `attributes`. */
export const groupAction = <M>(
  attributes: Attributes<M>,
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      ...attributes,
      h.Type('button'),
      h.Class(cn(sidebarGroupActionClass, config.className)),
      h.DataAttribute('slot', 'sidebar-group-action'),
      h.DataAttribute('sidebar', 'group-action'),
    ],
    children,
  )

export const groupContent = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarGroupContentClass, config.className)),
      h.DataAttribute('slot', 'sidebar-group-content'),
      h.DataAttribute('sidebar', 'group-content'),
    ],
    children,
  )

export const menu = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.ul(
    [
      h.Class(sidebarMenuClass),
      h.DataAttribute('slot', 'sidebar-menu'),
      h.DataAttribute('sidebar', 'menu'),
    ],
    children,
  )

export const menuItem = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.li(
    [
      h.Class(sidebarMenuItemClass),
      h.DataAttribute('slot', 'sidebar-menu-item'),
      h.DataAttribute('sidebar', 'menu-item'),
    ],
    children,
  )

export type MenuButtonConfig<M> = Readonly<{
  isActive?: boolean
  variant?: MenuButtonVariant
  size?: MenuButtonSize
  className?: string
  /** Extra attributes merged onto the button (click handlers, hrefs via
   *  delegation, …). */
  attributes?: Attributes<M>
  /** Optional collapsed-mode tooltip composition. The caller owns the
   *  Tooltip model and maps its messages into the parent update loop. */
  tooltip?: MenuButtonTooltipConfig<M>
}>

export type MenuButtonTooltipConfig<M> = Readonly<{
  model: Tooltip.Model
  content: Child
  toParentMessage: (message: Tooltip.Message) => M
}>

/** Menu item button. Wire clicks/navigation through `config.attributes`;
 *  wrap the label in a `<span>` so icon-mode truncation applies. When
 *  `tooltip` is supplied, the shared Tooltip wrapper owns the generated
 *  trigger while preserving this button's Sidebar attributes. */
export const menuButton = <M>(
  config: MenuButtonConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html => {
  const variant = config.variant ?? 'default'
  const size = config.size ?? 'default'
  const menuButtonClass = cn(
    sidebarMenuButtonClass,
    sidebarMenuButtonVariantClass[variant],
    sidebarMenuButtonSizeClass[size],
    config.className,
  )
  const triggerAttributes = [
    h.Type('button'),
    ...(config.attributes ?? []),
    h.DataAttribute('slot', 'sidebar-menu-button'),
    h.DataAttribute('sidebar', 'menu-button'),
    h.DataAttribute('size', size),
    ...(config.isActive === true ? [h.DataAttribute('active', 'true')] : []),
  ]

  if (config.tooltip === undefined) {
    return h.button([...triggerAttributes, h.Class(menuButtonClass)], children)
  }

  return h.submodel({
    slotId: config.tooltip.model.id,
    model: config.tooltip.model,
    view: Tooltip.view,
    viewInputs: Tooltip.styledViewInputs(
      {
        anchor: { placement: 'right', gap: 8 },
        trigger: h.span([], children),
        triggerAttributes,
        triggerClass: menuButtonClass,
        content: config.tooltip.content,
        hoverOnly: true,
      },
      h,
    ),
    toParentMessage: config.tooltip.toParentMessage,
  })
}

/** Icon-only action pinned at the end of a menu row. `showOnHover` reveals it
 *  only while the row is hovered/focused (desktop widths). */
export const menuAction = <M>(
  attributes: Attributes<M>,
  config: StyleConfig & Readonly<{ showOnHover?: boolean }>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      ...attributes,
      h.Type('button'),
      h.Class(
        cn(
          sidebarMenuActionClass,
          ...(config.showOnHover === true ? [sidebarMenuActionShowOnHoverClass] : []),
          config.className,
        ),
      ),
      h.DataAttribute('slot', 'sidebar-menu-action'),
      h.DataAttribute('sidebar', 'menu-action'),
    ],
    children,
  )

export const menuBadge = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(sidebarMenuBadgeClass, config.className)),
      h.DataAttribute('slot', 'sidebar-menu-badge'),
      h.DataAttribute('sidebar', 'menu-badge'),
    ],
    children,
  )

/** Loading placeholder row. Randomizes its text width between 50–90% like
 *  upstream; set `showIcon` to include the leading avatar circle. */
export const menuSkeleton = <M>(
  config: StyleConfig & Readonly<{ showIcon?: boolean }>,
  h: HtmlBuilder<M>,
): Html => {
  const width = `${Math.floor(Math.random() * 40) + 50}%`
  return h.div(
    [
      h.Class(cn(sidebarMenuSkeletonClass, config.className)),
      h.Style({ '--skeleton-width': width }),
      h.DataAttribute('slot', 'sidebar-menu-skeleton'),
      h.DataAttribute('sidebar', 'menu-skeleton'),
    ],
    [
      ...(config.showIcon === true
        ? [
            h.div([
              h.Class(cn(skeletonClass, 'size-4 rounded-md')),
              h.DataAttribute('sidebar', 'menu-skeleton-icon'),
            ]),
          ]
        : []),
      h.div([
        h.Class(cn(skeletonClass, 'h-4 max-w-(--skeleton-width) flex-1')),
        h.DataAttribute('sidebar', 'menu-skeleton-text'),
      ]),
    ],
  )
}

export const menuSub = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.ul(
    [
      h.Class(cn(sidebarMenuSubClass, config.className)),
      h.DataAttribute('slot', 'sidebar-menu-sub'),
      h.DataAttribute('sidebar', 'menu-sub'),
    ],
    children,
  )

export const menuSubItem = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.li(
    [
      h.Class(sidebarMenuSubItemClass),
      h.DataAttribute('slot', 'sidebar-menu-sub-item'),
      h.DataAttribute('sidebar', 'menu-sub-item'),
    ],
    children,
  )

export type MenuSubButtonConfig = Readonly<{
  size?: 'sm' | 'md'
  isActive?: boolean
  className?: string
}>

/** Nested menu link/button. Size keys off the emitted `data-size` attribute,
 *  matching the upstream token CSS. */
export const menuSubButton = <M>(
  attributes: Attributes<M>,
  config: MenuSubButtonConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html => {
  const size = config.size ?? 'md'
  return h.a(
    [
      ...attributes,
      h.Class(cn(sidebarMenuSubButtonClass, config.className)),
      h.DataAttribute('slot', 'sidebar-menu-sub-button'),
      h.DataAttribute('sidebar', 'menu-sub-button'),
      h.DataAttribute('size', size),
      ...(config.isActive === true ? [h.DataAttribute('active', 'true')] : []),
    ],
    children,
  )
}

/** Bare text control styled for the rail (upstream wraps its Input primitive;
 *  foldcn's labeled field wrapper would add structure upstream doesn't have). */
export const input = <M>(attributes: Attributes<M>, config: StyleConfig, h: HtmlBuilder<M>): Html =>
  h.input([
    ...attributes,
    h.Class(cn(inputClass, 'bg-background h-8 w-full shadow-none', config.className)),
    h.DataAttribute('slot', 'sidebar-input'),
    h.DataAttribute('sidebar', 'input'),
  ])

/** Raw-div separator mechanics (upstream delegates to its Separator
 *  primitive); margins come from the token. */
export const separator = <M>(config: StyleConfig, h: HtmlBuilder<M>): Html =>
  h.div(
    [
      h.Class(cn(sidebarSeparatorClass, config.className)),
      h.DataAttribute('slot', 'sidebar-separator'),
      h.DataAttribute('sidebar', 'separator'),
    ],
    [],
  )

/** Click-to-toggle hot-spot on the rail edge. Spread the provider's
 *  `slots.rail` attributes to wire it up. */
export const rail = <M>(attributes: Attributes<M>, config: StyleConfig, h: HtmlBuilder<M>): Html =>
  h.button(
    [
      ...attributes,
      h.Type('button'),
      h.Tabindex(-1),
      h.AriaLabel('Toggle Sidebar'),
      h.Attribute('title', 'Toggle Sidebar'),
      h.Class(cn(sidebarRailClass, config.className)),
      h.DataAttribute('slot', 'sidebar-rail'),
      h.DataAttribute('sidebar', 'rail'),
    ],
    [],
  )

/** Toggle button (PanelLeft glyph + sr-only hint). Spread the provider's
 *  `slots.trigger` attributes to wire it up. */
export const trigger = <M>(
  attributes: Attributes<M>,
  config: StyleConfig,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      ...attributes,
      h.Type('button'),
      h.Class(cn(sidebarTriggerClass, config.className)),
      h.DataAttribute('slot', 'sidebar-trigger'),
      h.DataAttribute('sidebar', 'trigger'),
    ],
    [icon(h, PanelLeft, 'rtl:rotate-180'), h.span([h.Class('sr-only')], ['Toggle Sidebar'])],
  )

/** The scrolling page column (`<main>`); place it in the provider's
 *  `children` slot. Inset-variant margins arrive through the peer selector. */
export const inset = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.main(
    [h.Class(cn(sidebarInsetClass, config.className)), h.DataAttribute('slot', 'sidebar-inset')],
    children,
  )

/** Presentational sidebar parts. The interactive shell lives in
 *  `SidebarProvider.view`. */
export const Sidebar = {
  header,
  content,
  footer,
  group,
  groupLabel,
  groupAction,
  groupContent,
  menu,
  menuItem,
  menuButton,
  menuAction,
  menuBadge,
  menuSkeleton,
  menuSub,
  menuSubItem,
  menuSubButton,
  separator,
  trigger,
  rail,
  input,
}

/** Namespace alias for the provider (engine and shell view). */
export const SidebarProvider = {
  Model,
  Message,
  init,
  update,
  state,
  setOpen,
  toggle,
  openMobile,
  closeMobile,
  subscriptions,
  view,
}

export const SidebarInset = Object.assign(inset)
