import { Effect, Option, Schema as S } from 'effect'
import * as RuntimeCommand from 'foldkit/command'
import * as Mount from 'foldkit/mount'
import * as Dom from 'foldkit/dom'
import * as Update from 'foldkit/update'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import * as Dialog from './dialog.ts'
import { commandScore } from './command-score.ts'

import type { Attribute, Html, HtmlBuilder, KeyboardModifiers } from 'foldkit/html'

import { cn } from '../lib/utils.ts'
import { icon } from '../lib/icons.ts'
import { Check, Search } from 'lucide'
import { inputGroup, inputGroupAddon, inputGroupInput } from './input-group.ts'

type Child = Html | string

export const commandClass =
  'bg-popover text-popover-foreground rounded-xl! p-1 flex size-full flex-col overflow-hidden'

export const commandInputClass =
  'w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50'

export const commandListClass =
  'no-scrollbar max-h-72 scroll-py-1 outline-none overflow-x-hidden overflow-y-auto'

export const commandEmptyClass = 'py-6 text-center text-sm'

export const commandGroupClass =
  'text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium'

export const commandGroupHeadingClass = ''

export const commandItemClass =
  "data-selected:bg-muted data-selected:text-foreground data-selected:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! [&_svg:not([class*='size-'])]:size-4 group/command-item data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

export const commandSeparatorClass = 'bg-border -mx-1 h-px'

export const commandShortcutClass =
  'text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-xs tracking-widest'

export type CommandInputConfig<M> = Readonly<{
  id?: string
  ariaLabel?: string
  attributes?: ReadonlyArray<Attribute<M>>
  value?: string
  onInput?: (value: string) => M
  placeholder?: string
  isDisabled?: boolean
  className?: string
}>

type StyleConfig = Readonly<{ className?: string }>

const commandContainer = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div([h.Class(cn(commandClass, config.className)), h.DataAttribute('slot', 'command')], children)

const commandInput = <M>(config: CommandInputConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(cn('p-1 pb-0')), h.DataAttribute('slot', 'command-input-wrapper')],
    [
      inputGroup(
        {
          className:
            'bg-input/30 border-input/30 h-8! rounded-lg! shadow-none! *:data-[slot=input-group-addon]:pl-2!',
        },
        [
          inputGroupAddon({}, [icon(h, Search, 'size-4 shrink-0 opacity-50')], h),
          inputGroupInput(
            {
              id: config.id ?? 'command-input',
              ariaLabel: config.ariaLabel ?? 'Search commands',
              ...(config.onInput === undefined ? {} : { onInput: config.onInput }),
              ...(config.value === undefined ? {} : { value: config.value }),
              ...(config.isDisabled === undefined ? {} : { isDisabled: config.isDisabled }),
              ...(config.placeholder === undefined ? {} : { placeholder: config.placeholder }),
              className: cn(commandInputClass, config.className),
              attributes: [
                h.DataAttribute('slot', 'command-input'),
                h.Attribute('cmdk-input', ''),
                ...(config.attributes ?? []),
              ],
            },
            h,
          ),
        ],
        h,
      ),
    ],
  )

const commandList = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Class(cn(commandListClass, config.className)), h.DataAttribute('slot', 'command-list')],
    children,
  )

const commandEmpty = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Class(cn(commandEmptyClass, config.className)), h.DataAttribute('slot', 'command-empty')],
    children,
  )

const commandGroup = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(commandGroupClass, config.className)),
      h.DataAttribute('slot', 'command-group'),
      h.Role('group'),
    ],
    children,
  )

export type CommandItemConfig<M> = StyleConfig &
  Readonly<{
    isSelected?: boolean
    isDisabled?: boolean
    isChecked?: boolean
    attributes?: ReadonlyArray<Attribute<M>>
  }>

const commandItem = <M>(
  config: CommandItemConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(commandItemClass, config.className)),
      h.DataAttribute('slot', 'command-item'),
      h.Attribute('cmdk-item', ''),
      h.Role('option'),
      h.AriaSelected(config.isSelected === true),
      h.AriaDisabled(config.isDisabled === true),
      ...(config.isSelected === true ? [h.DataAttribute('selected', 'true')] : []),
      ...(config.isDisabled === true ? [h.DataAttribute('disabled', 'true')] : []),
      ...(config.isChecked === true ? [h.DataAttribute('checked', 'true')] : []),
      ...(config.attributes ?? []),
    ],
    children,
  )

const commandSeparator = <M>(config: StyleConfig, h: HtmlBuilder<M>): Html =>
  h.div(
    [
      h.Class(cn(commandSeparatorClass, config.className)),
      h.DataAttribute('slot', 'command-separator'),
    ],
    [],
  )

const commandShortcut = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.span(
    [
      h.Class(cn(commandShortcutClass, config.className)),
      h.DataAttribute('slot', 'command-shortcut'),
    ],
    children,
  )

/** Composable command palette — `Command` is the container, with sub-builders
 *  as properties. */
export const Command = Object.assign(commandContainer, {
  input: commandInput,
  list: commandList,
  empty: commandEmpty,
  group: commandGroup,
  item: commandItem,
  separator: commandSeparator,
  shortcut: commandShortcut,
})

/** Command owns query and active value; applications own items and actions. */
export const Model = S.Struct({ id: S.String, search: S.String, value: S.Option(S.String) })
export type Model = typeof Model.Type
export const Message = defineMessageUnion({
  ChangedSearch: { search: S.String },
  Activated: { value: S.String, scroll: S.Boolean },
  Selected: { value: S.String },
  CompletedScroll: {},
  Mounted: {},
  IgnoredKey: {},
})
export type Message = typeof Message.Type
export const OutMessage = defineMessageUnion({
  Selected: { value: S.String },
  SearchChanged: { search: S.String },
  ValueChanged: { value: S.String },
})
export type OutMessage = typeof OutMessage.Type
export type InitConfig = Readonly<{ id: string; search?: string; value?: string }>
export const init = ({ id, search = '', value }: InitConfig): Model => ({
  id,
  search,
  value: Option.fromNullishOr(value),
})

export const inputId = (id: string): string => `${id}-input`
const itemId = (id: string, value: string): string => `${id}-item-${encodeURIComponent(value)}`

export const ScrollActive = RuntimeCommand.define('ScrollCommandActive', {
  args: { id: S.String, value: S.String },
  messages: [Message.CompletedScroll],
  execute: ({ id, value }) =>
    Dom.scrollIntoViewAfterPaint(`[id="${itemId(id, value).replaceAll('"', '\\"')}"]`, {
      block: 'nearest',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedScroll())),
})

export const update = (
  model: Model,
  message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> => {
  switch (message._tag) {
    case 'ChangedSearch':
      return {
        model: { ...model, search: message.search, value: Option.none() },
        outMessage: OutMessage.SearchChanged({ search: message.search }),
      }
    case 'Activated':
      return {
        model: { ...model, value: Option.some(message.value) },
        commands: message.scroll ? [ScrollActive({ id: model.id, value: message.value })] : [],
        outMessage: OutMessage.ValueChanged({ value: message.value }),
      }
    case 'Selected':
      return { model, outMessage: OutMessage.Selected({ value: message.value }) }
    case 'CompletedScroll':
    case 'Mounted':
    case 'IgnoredKey':
      return { model }
  }
}

export type Item = Readonly<{
  /** Unique, stable action identifier. */
  value: string
  /** Defaults to value. The default filter searches this label and keywords. */
  label?: string
  keywords?: ReadonlyArray<string>
  group?: string
  isDisabled?: boolean
  isChecked?: boolean
  forceMount?: boolean
  content?: Html
  shortcut?: string
}>
export type Group = Readonly<{ value: string; heading: string; forceMount?: boolean }>
export type Filter = (value: string, search: string, keywords: ReadonlyArray<string>) => number
export type ViewInputs = Readonly<{
  items: ReadonlyArray<Item>
  groups?: ReadonlyArray<Group>
  label?: string
  placeholder?: string
  emptyText?: string
  loop?: boolean
  vimBindings?: boolean
  disablePointerSelection?: boolean
  shouldFilter?: boolean
  filter?: Filter
  loading?: boolean
  loadingText?: string
  className?: string
}>

/** Ranked, grouped results in the same order that view and navigation use. */
export const getResults = (search: string, config: ViewInputs): ReadonlyArray<Item> => {
  const query = search.trim()
  const shouldRank = config.shouldFilter !== false && query.length > 0
  const filter = config.filter ?? commandScore
  const ranked = config.items
    .map((item) => ({
      item,
      score: shouldRank
        ? filter(
            (item.label ?? item.value).trim(),
            query,
            (item.keywords ?? []).map((word) => word.trim()),
          )
        : 1,
    }))
    .filter(
      ({ item, score }) =>
        score > 0 ||
        item.forceMount ||
        config.groups?.some((group) => group.value === item.group && group.forceMount),
    )
  if (shouldRank) ranked.sort((a, b) => b.score - a.score)
  // Keep each group contiguous. The highest-ranked member places its group.
  const sections = new Map<string | undefined, Array<Item>>()
  for (const { item } of ranked) {
    const section = sections.get(item.group)
    if (section) section.push(item)
    else sections.set(item.group, [item])
  }
  return [...sections.values()].flat()
}

export const activeItem = (model: Model, items: ReadonlyArray<Item>): Item | undefined =>
  items.find((item) => !item.isDisabled && Option.contains(model.value, item.value)) ??
  items.find((item) => !item.isDisabled)

/** Pure navigation shared with tests. Meta jumps to an edge; Alt jumps groups. */
export const navigate = (
  items: ReadonlyArray<Item>,
  value: string | undefined,
  direction: 1 | -1,
  loop = false,
  byGroup = false,
): Item | undefined => {
  const enabled = items.filter((item) => !item.isDisabled)
  if (enabled.length === 0) return undefined
  const index = enabled.findIndex((item) => item.value === value)
  const current = enabled[index]
  if (byGroup && current) {
    for (let next = index + direction; next >= 0 && next < enabled.length; next += direction) {
      const item = enabled[next]
      if (item && item.group !== current.group) return item
    }
  }
  const next = index + direction
  return enabled[
    loop
      ? (next + enabled.length) % enabled.length
      : Math.max(0, Math.min(next, enabled.length - 1))
  ]
}

// Foldkit's key helper does not expose isComposing. Guard IME events at the
// DOM boundary before the helper sees them. Prevent mouse focus from leaving
// the search input, and expose cmdk's measured list height for animation.
export const CommandDom = Mount.define('MountCommandDom', {
  messages: [Message.Mounted],
  execute: ({ element }) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const keydown = (event: Event) => {
            if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229))
              event.stopImmediatePropagation()
          }
          const pointerdown = (event: Event) => {
            if (
              event instanceof MouseEvent &&
              event.target instanceof Element &&
              event.target.closest('[cmdk-item]')
            )
              event.preventDefault()
          }
          element.addEventListener('keydown', keydown, true)
          element.addEventListener('mousedown', pointerdown)
          const list = element.querySelector<HTMLElement>('[cmdk-list]')
          const sizer = element.querySelector<HTMLElement>('[cmdk-list-sizer]')
          const observer = new ResizeObserver(() => {
            if (list && sizer)
              list.style.setProperty('--cmdk-list-height', `${sizer.offsetHeight}px`)
          })
          if (sizer) observer.observe(sizer)
          return () => {
            element.removeEventListener('keydown', keydown, true)
            element.removeEventListener('mousedown', pointerdown)
            observer.disconnect()
          }
        }),
        (cleanup) => Effect.sync(cleanup),
      )
      return Message.Mounted()
    }),
})

export const view = defineView<Model, Message, ViewInputs>((model, config, h) => {
  const items = getResults(model.search, config)
  const active = activeItem(model, items)
  const enabled = items.filter((item) => !item.isDisabled)
  const activate = (item: Item | undefined) =>
    Option.some(
      item ? Message.Activated({ value: item.value, scroll: true }) : Message.IgnoredKey(),
    )
  const keydown = (key: string, modifiers: KeyboardModifiers): Option.Option<Message> => {
    if (key === 'Enter')
      return Option.some(active ? Message.Selected({ value: active.value }) : Message.IgnoredKey())
    if (key === 'Home') return activate(enabled[0])
    if (key === 'End') return activate(enabled.at(-1))
    const down =
      key === 'ArrowDown' ||
      (config.vimBindings !== false && modifiers.ctrlKey && (key === 'n' || key === 'j'))
    const up =
      key === 'ArrowUp' ||
      (config.vimBindings !== false && modifiers.ctrlKey && (key === 'p' || key === 'k'))
    if (!down && !up) return Option.none()
    if (modifiers.metaKey) return activate(down ? enabled.at(-1) : enabled[0])
    return activate(navigate(items, active?.value, down ? 1 : -1, config.loop, modifiers.altKey))
  }
  const renderItem = (item: Item): Html =>
    Command.item(
      {
        isSelected: active?.value === item.value,
        ...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled }),
        ...(item.isChecked === undefined ? {} : { isChecked: item.isChecked }),
        attributes: [
          h.Id(itemId(model.id, item.value)),
          h.Tabindex(-1),
          h.DataAttribute('value', item.value),
          ...(!item.isDisabled ? [h.OnClick(Message.Selected({ value: item.value }))] : []),
          ...(!item.isDisabled && !config.disablePointerSelection
            ? [
                h.OnPointerMove((_x, _y, pointerType) =>
                  pointerType === 'touch' || active?.value === item.value
                    ? Option.none()
                    : Option.some(Message.Activated({ value: item.value, scroll: false })),
                ),
              ]
            : []),
        ],
      },
      [
        item.content ?? item.label ?? item.value,
        ...(item.shortcut
          ? [Command.shortcut({}, [item.shortcut], h)]
          : [
              icon(
                h,
                Check,
                'size-4 shrink-0 ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100',
              ),
            ]),
      ],
      h,
    )
  const sections = new Map<string | undefined, Array<Item>>()
  for (const item of items) {
    const section = sections.get(item.group)
    if (section) section.push(item)
    else sections.set(item.group, [item])
  }
  // Keep empty groups mounted and hidden, matching cmdk's styling contract.
  for (const group of config.groups ?? [])
    if (!sections.has(group.value)) sections.set(group.value, [])
  const children: Array<Html> = []
  for (const [group, entries] of sections) {
    if (group === undefined) {
      children.push(...entries.map(renderItem))
      continue
    }
    const metadata = config.groups?.find((entry) => entry.value === group)
    const hidden = entries.length === 0 && !metadata?.forceMount
    const headingId = `${model.id}-heading-${encodeURIComponent(group)}`
    if (children.length > 0 && !model.search.trim() && !hidden)
      children.push(
        h.div([
          h.Attribute('cmdk-separator', ''),
          h.DataAttribute('slot', 'command-separator'),
          h.Role('separator'),
          h.Class(commandSeparatorClass),
        ]),
      )
    children.push(
      h.div(
        [
          h.Attribute('cmdk-group', ''),
          h.DataAttribute('slot', 'command-group'),
          h.Class(commandGroupClass),
          ...(hidden ? [h.Hidden(true)] : []),
        ],
        [
          h.div(
            [
              h.Id(headingId),
              h.Attribute('cmdk-group-heading', ''),
              h.DataAttribute('slot', 'command-group-heading'),
              h.Class(commandGroupHeadingClass),
            ],
            [metadata?.heading ?? group],
          ),
          h.div(
            [h.Role('group'), h.AriaLabelledBy(headingId), h.Attribute('cmdk-group-items', '')],
            entries.map(renderItem),
          ),
        ],
      ),
    )
  }
  return h.div(
    [
      h.Attribute('cmdk-root', ''),
      h.DataAttribute('slot', 'command'),
      h.Class(cn(commandClass, config.className)),
      h.OnMount(CommandDom()),
    ],
    [
      Command.input(
        {
          id: inputId(model.id),
          ariaLabel: config.label ?? 'Command menu',
          value: model.search,
          onInput: (search) => Message.ChangedSearch({ search }),
          placeholder: config.placeholder ?? 'Type a command or search...',
          attributes: [
            h.Role('combobox'),
            h.AriaExpanded(true),
            h.AriaControls(`${model.id}-list`),
            h.Attribute('aria-autocomplete', 'list'),
            h.Autocomplete('off'),
            h.OnKeyDownPreventDefault(keydown),
            ...(active ? [h.AriaActiveDescendant(itemId(model.id, active.value))] : []),
          ],
        },
        h,
      ),
      h.div(
        [
          h.Id(`${model.id}-list`),
          h.Role('listbox'),
          h.AriaLabel(config.label ?? 'Commands'),
          h.Attribute('cmdk-list', ''),
          h.DataAttribute('slot', 'command-list'),
          h.Class(commandListClass),
        ],
        [
          h.div(
            [h.Attribute('cmdk-list-sizer', '')],
            [
              ...(config.loading
                ? [
                    h.div(
                      [
                        h.Attribute('cmdk-loading', ''),
                        h.Role('progressbar'),
                        h.AriaLabel(config.loadingText ?? 'Loading commands'),
                      ],
                      [config.loadingText ?? 'Loading commands...'],
                    ),
                  ]
                : []),
              ...(items.length === 0
                ? [
                    h.div(
                      [
                        h.Attribute('cmdk-empty', ''),
                        h.DataAttribute('slot', 'command-empty'),
                        h.Role('status'),
                        h.Class(commandEmptyClass),
                      ],
                      [config.emptyText ?? 'No results found.'],
                    ),
                  ]
                : []),
              ...children,
            ],
          ),
        ],
      ),
    ],
  )
})

export const CommandDialogModel = S.Struct({
  command: Model,
  dialog: Dialog.Model,
  closeOnSelect: S.Boolean,
  resetOnOpen: S.Boolean,
})
export type CommandDialogModel = typeof CommandDialogModel.Type
export const CommandDialogMessage = defineMessageUnion({
  GotCommandMessage: { message: Message },
  GotDialogMessage: { message: Dialog.Message },
})
export type CommandDialogMessage = typeof CommandDialogMessage.Type
export const CommandDialogOutMessage = defineMessageUnion({
  Selected: { value: S.String },
  SearchChanged: { search: S.String },
  ValueChanged: { value: S.String },
  Opened: {},
  Closed: {},
})
export type CommandDialogOutMessage = typeof CommandDialogOutMessage.Type

type DialogUpdate = Update.ReturnWithOutMessage<
  CommandDialogModel,
  CommandDialogMessage,
  CommandDialogOutMessage
>
const dialogInit = (
  config: InitConfig &
    Readonly<{ closeOnSelect?: boolean; resetOnOpen?: boolean; isAnimated?: boolean }>,
): CommandDialogModel => ({
  command: init(config),
  dialog: Dialog.init({
    id: `${config.id}-dialog`,
    focusSelector: `[id="${inputId(config.id)}"]`,
    isAnimated: config.isAnimated ?? true,
  }),
  closeOnSelect: config.closeOnSelect ?? false,
  resetOnOpen: config.resetOnOpen ?? false,
})
type DialogUpdateResult = Update.ReturnWithOutMessage<
  Dialog.Model,
  Dialog.Message,
  Dialog.OutMessage
>
const foldDialogResult = (model: CommandDialogModel, result: DialogUpdateResult): DialogUpdate => {
  const folded = {
    model: { ...model, dialog: result.model },
    commands: RuntimeCommand.mapMessages(result.commands ?? [], (message) =>
      CommandDialogMessage.GotDialogMessage({ message }),
    ),
  }
  return result.outMessage ? Update.withOutMessage(folded, result.outMessage) : folded
}
const dialogOpen = (model: CommandDialogModel): DialogUpdate =>
  foldDialogResult(
    {
      ...model,
      command:
        model.resetOnOpen && !model.dialog.isOpen ? init({ id: model.command.id }) : model.command,
    },
    Dialog.open(model.dialog),
  )
const dialogClose = (model: CommandDialogModel): DialogUpdate =>
  foldDialogResult(model, Dialog.close(model.dialog))
const dialogUpdate = (model: CommandDialogModel, message: CommandDialogMessage): DialogUpdate => {
  if (message._tag === 'GotDialogMessage')
    return foldDialogResult(model, Dialog.update(model.dialog, message.message))
  const result = update(model.command, message.message)
  const next = { ...model, command: result.model }
  const closed =
    result.outMessage?._tag === 'Selected' && model.closeOnSelect
      ? dialogClose(next)
      : { model: next, commands: [] }
  const folded = {
    model: closed.model,
    commands: [
      ...RuntimeCommand.mapMessages(result.commands ?? [], (message) =>
        CommandDialogMessage.GotCommandMessage({ message }),
      ),
      ...(closed.commands ?? []),
    ],
  }
  return result.outMessage ? Update.withOutMessage(folded, result.outMessage) : folded
}
export type CommandDialogViewInputs = ViewInputs &
  Readonly<{ title?: string; description?: string; showCloseButton?: boolean; panelClass?: string }>
const dialogView = defineView<CommandDialogModel, CommandDialogMessage, CommandDialogViewInputs>(
  (model, config, h) =>
    h.submodel({
      slotId: model.dialog.id,
      model: model.dialog,
      view: Dialog.view,
      viewInputs: Dialog.styledViewInputs(
        {
          panelClass: cn(
            'rounded-xl! top-1/3 translate-y-0 overflow-hidden p-0',
            config.panelClass,
          ),
          content: (render, inner) => [
            Dialog.header(
              { className: 'sr-only' },
              [
                Dialog.title(
                  { attributes: render.title },
                  [config.title ?? 'Command Palette'],
                  inner,
                ),
                Dialog.description(
                  { attributes: render.description },
                  [config.description ?? 'Search for a command to run...'],
                  inner,
                ),
              ],
              inner,
            ),
            inner.submodel({
              slotId: model.command.id,
              model: model.command,
              view,
              viewInputs: config,
              toParentMessage: (message) => CommandDialogMessage.GotCommandMessage({ message }),
            }),
            ...(config.showCloseButton
              ? [Dialog.closeButton({ attributes: render.closeButton }, ['Close'], inner)]
              : []),
          ],
        },
        h,
      ),
      toParentMessage: (message) => CommandDialogMessage.GotDialogMessage({ message }),
    }),
)

/** One child owns both command interaction and the modal lifecycle. */
export const CommandDialog = {
  Model: CommandDialogModel,
  Message: CommandDialogMessage,
  OutMessage: CommandDialogOutMessage,
  init: dialogInit,
  open: dialogOpen,
  close: dialogClose,
  update: dialogUpdate,
  view: dialogView,
}
