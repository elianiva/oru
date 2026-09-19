import { Effect, Option, Predicate } from 'effect'
import { Navigation, Url } from 'foldkit'
import * as Scene from 'foldkit/scene'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HarnessHealth } from '@oru/harness'
import type { Project, ThreadOptions } from '@oru/rpc'
import * as Resizable from '../src/components/ui/resizable.ts'
import { resetDefsForTest } from '../src/ui-defs.ts'
import {
  CreateProject,
  CreateThreadAndSend,
  DeleteProject,
  GetProjectDetail,
  ListDirectory,
  Message,
  Model,
  NavigateInternal,
  PersistPrefs,
  PreloadDirectory,
  UpdateProject,
  init,
  selectedThread,
  update,
  view,
} from '../src/root.ts'
import {
  AppRoute,
  homeRouter,
  settingsAppearanceRouter,
  settingsGeneralRouter,
  settingsIndexRouter,
  settingsProvidersRouter,
  settingsSections,
  threadRouter,
  titleForRoute,
  urlToAppRoute,
} from '../src/route.ts'
import * as General from '../src/settings/general.ts'
import * as Projects from '../src/projects.ts'
import * as Shell from '../src/shell.ts'
import { threadById, type ThreadRow, type ThreadSection } from '../src/threads.ts'
import * as ThreadList from '../src/thread-list.ts'

const sizes = (model: Shell.Model): ReadonlyArray<number> => model.panels.map((panel) => panel.size)

/** The cold-load URL for `/`: routing `init` parses its starting route from it. */
const homeUrl: Url.Url = {
  protocol: 'http:',
  host: 'localhost',
  port: Option.none(),
  pathname: '/',
  search: Option.none(),
  hash: Option.none(),
}

const urlForPath = (pathname: string): Url.Url => ({ ...homeUrl, pathname })

const panelSize = (model: Shell.Model, id: string): number => {
  const panel = model.panels.find((candidate) => candidate.id === id)
  return panel === undefined ? Number.NaN : panel.size
}

const keyedHandle = (handleIndex: number, key: string): Shell.Message =>
  Shell.Message.GotGroup({ message: Resizable.Message.KeyedHandle({ handleIndex, key }) })

const enterOn = (shell: Shell.Model, handleIndex: number): Shell.Model =>
  Shell.update(shell, keyedHandle(handleIndex, 'Enter')).model

const dragged = (model: Shell.Model, handleIndex: number, deltaPercent: number): Shell.Model => {
  const pressed = Resizable.update(
    model,
    Resizable.Message.PressedHandle({ handleIndex, clientX: 0, clientY: 0 }),
  )
  const measured = Resizable.update(
    pressed.model,
    Resizable.Message.MeasuredContainer({ handleIndex, pixelSize: 1000 }),
  )
  return Resizable.update(
    measured.model,
    Resizable.Message.MovedHandle({ clientX: deltaPercent * 10, clientY: 0 }),
  ).model
}

const withStorage = (entries: Readonly<Record<string, string>>): (() => void) => {
  const store = new Map(Object.entries(entries))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
  })
  return () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

import * as StubComposer from './stub-composer.ts'
import { mountStubs, stubSnapshot } from './stub-composer.ts'

/** Mount the stub defs and reconcile them, so scenes render a composer. */
const withStubs = (model: Model): Model =>
  update(model, Message.UiSnapshotArrived({ snapshot: stubSnapshot() })).model

beforeEach(() => {
  mountStubs()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
  resetDefsForTest()
})

const fixtureRow = (
  id: string,
  children: ReadonlyArray<ThreadRow>,
  iconUrl: Option.Option<string>,
): ThreadRow => ({
  id,
  title: `Fixture ${id}`,
  project: { id: 'fixture', name: 'Fixture', iconUrl },
  location: { kind: 'branch', name: 'main' },
  status: 'idle',
  isUnread: false,
  activity: 0,
  updatedAt: 0,
  children,
})

const fixtureSection = (rows: ReadonlyArray<ThreadRow>): ReadonlyArray<ThreadSection> => [
  { id: 'fixture', label: 'Fixture', rows },
]

const fixtureModel = (): ThreadList.Model =>
  ThreadList.update(ThreadList.init(), ThreadList.Message.ToggledSection({ id: 'fixture' })).model

describe('shell', () => {
  it('renders three columns with a splitter between them', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(homeUrl).model),
      Scene.expectAll(Scene.all.selector('[data-slot="resizable-panel"]')).toHaveCount(3),
      Scene.expectAll(Scene.all.selector('[data-slot="resizable-handle"]')).toHaveCount(2),
      Scene.expect(Scene.selector('#oru-shell-panel-left')).toExist(),
      Scene.expect(Scene.selector('#oru-shell-panel-main')).toExist(),
      Scene.expect(Scene.selector('#oru-shell-panel-right')).toExist(),
      Scene.expect(Scene.selector('[data-thread-list]')).toExist(),
      Scene.expect(Scene.selector('[data-main]')).toExist(),
      Scene.expect(Scene.selector('[data-detail]')).toExist(),
    )
  })

  it('collapses the left sidebar from the header toggle', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(homeUrl).model),
      Scene.expect(Scene.selector('[data-shell-toggle="left"]')).toHaveAttr(
        'aria-expanded',
        'true',
      ),
      Scene.click(Scene.selector('[data-shell-toggle="left"]')),
      Scene.expect(Scene.selector('[data-shell-toggle="left"]')).toHaveAttr(
        'aria-expanded',
        'false',
      ),
      Scene.expect(Scene.selector('[data-shell-toggle="left"]')).toHaveAccessibleName(
        'Expand left sidebar',
      ),
      Scene.expect(Scene.selector('[data-shell-toggle="right"]')).toHaveAttr(
        'aria-expanded',
        'true',
      ),
    )
  })

  it('lands the toolbar toggle on exactly the layout the engine gestures reach', () => {
    const { model } = init(homeUrl)
    const shell = model.shell
    const enterLeft = enterOn(shell, 0)
    const dragLeft = dragged(shell, 0, -30)
    const toggleLeft = Shell.togglePanel(shell, 'left')

    expect(panelSize(toggleLeft, 'left')).toBe(0)
    expect(sizes(toggleLeft)).toEqual(sizes(enterLeft))
    expect(sizes(toggleLeft)).toEqual(sizes(dragLeft))
    expect(panelSize(dragLeft, 'main')).toBe(75)
  })

  it('closes the gap the engine’s Enter gesture leaves: the last panel', () => {
    const { model } = init(homeUrl)
    const shell = model.shell

    expect(sizes(enterOn(shell, 1))).toEqual(sizes(shell))

    const dragRight = dragged(shell, 1, 30)
    const toggleRight = Shell.togglePanel(shell, 'right')
    expect(panelSize(toggleRight, 'right')).toBe(0)
    expect(sizes(toggleRight)).toEqual(sizes(dragRight))
    expect(panelSize(dragRight, 'main')).toBe(77.778)
  })

  it('returns a collapsed sidebar to the size it had, and holds both at once', () => {
    const { model } = init(homeUrl)
    const shell = model.shell
    const before = sizes(shell)

    const leftClosed = Shell.togglePanel(shell, 'left')
    expect(sizes(Shell.togglePanel(leftClosed, 'left'))).toEqual(before)

    const rightClosed = Shell.togglePanel(shell, 'right')
    expect(sizes(Shell.togglePanel(rightClosed, 'right'))).toEqual(before)

    const bothClosed = Shell.togglePanel(leftClosed, 'right')
    expect(sizes(bothClosed)).toEqual([0, 100, 0])
    expect(sizes(Shell.togglePanel(Shell.togglePanel(bothClosed, 'left'), 'right'))).toEqual(before)
  })

  it('reports a sidebar as collapsed from the model, never from a flag', () => {
    const { model } = init(homeUrl)
    const shell = model.shell
    expect(Shell.isCollapsed(shell, 'left')).toBe(false)
    expect(Shell.isCollapsed(Shell.togglePanel(shell, 'left'), 'left')).toBe(true)
    expect(Shell.isCollapsed(dragged(shell, 1, 30), 'right')).toBe(true)
    expect(Shell.isCollapsed(shell, 'right')).toBe(false)
  })

  it('mirrors the settled layout to storage and stays quiet during a drag', () => {
    const restore = withStorage({})
    try {
      const { model } = init(homeUrl)
      expect(Option.isSome(Shell.storableLayout(model.shell))).toBe(true)

      const pressed = Resizable.update(
        model.shell,
        Resizable.Message.PressedHandle({ handleIndex: 0, clientX: 0, clientY: 0 }),
      )
      expect(Option.isNone(Shell.storableLayout(pressed.model))).toBe(true)

      const released = Resizable.update(pressed.model, Resizable.Message.ReleasedHandle({}))
      expect(Option.isSome(Shell.storableLayout(released.model))).toBe(true)
    } finally {
      restore()
    }
  })

  it('restores a collapsed sidebar from storage and ignores a value it cannot read', () => {
    const restore = withStorage({ 'oru.shell.layout': '{"left":0,"main":78,"right":22}' })
    try {
      expect(panelSize(Shell.init(), 'left')).toBe(0)
      expect(Shell.isCollapsed(Shell.init(), 'left')).toBe(true)
      expect(panelSize(Shell.togglePanel(Shell.init(), 'left'), 'left')).toBeCloseTo(22.222, 3)
    } finally {
      restore()
    }

    const restoreJunk = withStorage({ 'oru.shell.layout': '{"left":"wide"}' })
    try {
      expect(panelSize(Shell.init(), 'left')).toBeCloseTo(22.222, 3)
    } finally {
      restoreJunk()
    }

    const restoreBroken = withStorage({ 'oru.shell.layout': 'not json at all' })
    try {
      expect(panelSize(Shell.init(), 'left')).toBeCloseTo(22.222, 3)
    } finally {
      restoreBroken()
    }
  })
})

describe('thread list', () => {
  it("takes the status slot's colour from the theme's status tokens", () => {
    expect(ThreadList.statusTone('failed')).toBe('text-status-failed')
    expect(ThreadList.statusTone('needs-you')).toBe('text-status-attention')
    expect(ThreadList.statusTone('unread')).toBe('text-status-unread')
    expect(ThreadList.statusTone('working')).toBe('text-status-working')
    expect(ThreadList.statusTone('workflow')).toBe('text-status-working')
    expect(ThreadList.statusTone('draft')).toBe('text-status-draft')
    expect(ThreadList.statusTone('idle')).toBe('text-muted-foreground')
  })

  it('gives each project in a section its own list', () => {
    const sections: ReadonlyArray<ThreadSection> = [
      {
        id: 'active',
        label: 'Active',
        rows: [
          fixtureRow('oru-row', [], Option.none()),
          {
            ...fixtureRow('other-row', [], Option.none()),
            project: { id: 'other', name: 'Other', iconUrl: Option.none() },
          },
        ],
      },
    ]
    Scene.scene(
      {
        update: ThreadList.update,
        view: (model, h) =>
          ThreadList.view(model, { sections, selected: Option.none(), projects: [] }, h),
      },
      Scene.given(ThreadList.init()),
      Scene.expectAll(
        Scene.all.selector('[data-thread-section="active"] [data-thread-group]'),
      ).toHaveCount(2),
      Scene.expect(Scene.selector('[data-thread-group="fixture"]')).toHaveAttr(
        'aria-label',
        'Fixture threads',
      ),
      Scene.expect(Scene.selector('[data-thread-group="other"]')).toContainText(
        'Fixture other-row',
      ),
    )
  })

  it('draws a project glyph: an icon when the seam names one, a monogram when it does not', () => {
    Scene.scene(
      {
        update: ThreadList.update,
        view: (model, h) =>
          ThreadList.view(
            model,
            {
              sections: fixtureSection([
                fixtureRow('with-icon', [], Option.some('/fixture-project.svg')),
                fixtureRow('without-icon', [], Option.none()),
              ]),
              selected: Option.none(),
              projects: [],
            },
            h,
          ),
      },
      Scene.given(fixtureModel()),
      Scene.expect(Scene.selector('[data-thread-row="with-icon"] img')).toHaveAttr(
        'src',
        '/fixture-project.svg',
      ),
      Scene.expect(Scene.selector('[data-thread-row="without-icon"] img')).not.toExist(),
      Scene.expect(
        Scene.selector('[data-thread-row="without-icon"] [data-project-monogram]'),
      ).toContainText('F'),
    )
  })

  it('stops the subagent tree three levels below its section row', () => {
    const chain = (depth: number): ThreadRow =>
      fixtureRow(`chain-${String(depth)}`, depth === 0 ? [] : [chain(depth - 1)], Option.none())
    Scene.scene(
      {
        update: ThreadList.update,
        view: (model, h) =>
          ThreadList.view(
            model,
            {
              sections: fixtureSection([chain(4)]),
              selected: Option.none(),
              projects: [],
            },
            h,
          ),
      },
      Scene.given(fixtureModel()),
      Scene.expectAll(Scene.all.selector('[data-thread-row]')).toHaveCount(4),
      Scene.expect(Scene.selector('[data-thread-row="chain-1"]')).toExist(),
      Scene.expect(
        Scene.selector('[data-subagent-list="3"] [data-thread-row="chain-1"]'),
      ).toExist(),
      Scene.expect(Scene.selector('[data-subagent-list="4"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-thread-row="chain-0"]')).not.toExist(),
    )
  })

  it('collapses a section from its header', () => {
    const sections: ReadonlyArray<ThreadSection> = [
      {
        id: 'active',
        label: 'Active',
        rows: [fixtureRow('row-a', [], Option.none()), fixtureRow('row-b', [], Option.none())],
      },
    ]
    Scene.scene(
      {
        update: ThreadList.update,
        view: (model, h) =>
          ThreadList.view(model, { sections, selected: Option.none(), projects: [] }, h),
      },
      Scene.given(ThreadList.init()),
      Scene.click(Scene.selector('[data-section-toggle="active"]')),
      Scene.expect(Scene.text('Active (2)')).toExist(),
      Scene.expect(Scene.selector('[data-thread-row="row-a"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-thread-row="row-b"]')).not.toExist(),
    )
  })

  it('reports a click upward and navigates to that thread’s URL', () => {
    const click = ThreadList.update(
      ThreadList.init(),
      ThreadList.Message.ClickedThread({ id: 'thread-1' }),
    )
    expect('outMessage' in click ? click.outMessage : undefined).toEqual(
      ThreadList.OutMessage.Selected({ id: 'thread-1' }),
    )

    const before = init(homeUrl).model
    const selected = update(
      before,
      Message.GotThreads({ message: ThreadList.Message.ClickedThread({ id: 'thread-1' }) }),
    )
    expect(selected.model).toEqual(before)
    expect(selected.commands).toHaveLength(1)
    expect(selected.commands?.[0]?.name).toBe('NavigateInternal')
    expect(selected.commands?.[0]?.args).toEqual({ url: '/thread/thread-1' })
  })

  it('filters the list by project from a clickable All projects row', () => {
    const sections: ReadonlyArray<ThreadSection> = [
      {
        id: 'active',
        label: 'Active',
        rows: [
          fixtureRow('oru-row', [], Option.none()),
          {
            ...fixtureRow('other-row', [], Option.none()),
            project: { id: 'other', name: 'Other', iconUrl: Option.none() },
          },
        ],
      },
    ]
    const projects = [
      { id: 'fixture', name: 'Fixture' },
      { id: 'other', name: 'Other' },
    ]
    Scene.scene(
      {
        update: ThreadList.update,
        view: (model, h) =>
          ThreadList.view(model, { sections, selected: Option.none(), projects }, h),
      },
      Scene.given(ThreadList.init()),
      Scene.expect(Scene.selector('[data-project-filter-trigger]')).toContainText('All projects'),
      Scene.expect(Scene.selector('[data-project-filter-panel]')).not.toExist(),
      Scene.click(Scene.selector('[data-project-filter-trigger]')),
      Scene.expect(Scene.selector('[data-project-filter-option="all"]')).toExist(),
      Scene.expect(Scene.selector('[data-project-filter-option="fixture"]')).toContainText(
        'Fixture',
      ),
      Scene.expect(Scene.selector('[data-project-filter-option="other"]')).toExist(),
      Scene.expect(Scene.selector('[data-project-filter-option="new"]')).toContainText(
        'New project',
      ),
      Scene.click(Scene.selector('[data-project-filter-option="fixture"]')),
      Scene.expect(Scene.selector('[data-project-filter-trigger]')).toContainText('Fixture'),
      Scene.expect(Scene.selector('[data-project-filter-panel]')).not.toExist(),
      Scene.expect(Scene.selector('[data-thread-row="oru-row"]')).toExist(),
      Scene.expect(Scene.selector('[data-thread-row="other-row"]')).not.toExist(),
      Scene.click(Scene.selector('[data-project-filter-trigger]')),
      Scene.click(Scene.selector('[data-project-filter-option="all"]')),
      Scene.expect(Scene.selector('[data-project-filter-trigger]')).toContainText('All projects'),
      Scene.expect(Scene.selector('[data-thread-row="other-row"]')).toExist(),
    )
  })

  it('opens the shared dialog from the filter’s New project row, without navigating', () => {
    const listed = update(
      init(homeUrl).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
    ).model
    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.click(Scene.selector('[data-project-filter-trigger]')),
      Scene.click(Scene.selector('[data-project-filter-option="new"]')),
      Scene.expect(Scene.selector('[data-project-filter-panel]')).not.toExist(),
      Scene.Command.expectHas(ListDirectory),
      Scene.expect(Scene.selector('[data-projects-dialog]')).toExist(),
      Scene.Command.resolve(
        ListDirectory,
        Message.GotProjects({
          message: Projects.Message.DirectoryArrived({
            listing: { path: '/tmp', parent: '/', entries: [] },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-dirs-empty]')).toExist(),
    )
    const clicked = update(
      listed,
      Message.GotThreads({ message: ThreadList.Message.ClickedNewProject() }),
    )
    expect(clicked.commands?.[0]?.name).toBe('ListDirectory')
  })

  it('draws the selected thread from the route, in both columns', () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(init(urlForPath('/thread/thread-1')).model)),
      Scene.expect(Scene.selector('[data-detail]')).toContainText('No thread selected'),
      Scene.expect(Scene.selector('[data-conversation]')).toContainText('thread-1'),
    )
  })

  it('reads the selection out of the route and shows no thread at home', () => {
    expect(selectedThread(init(homeUrl).model)).toEqual(Option.none())
    expect(selectedThread(init(urlForPath('/thread/thread-1')).model)).toEqual(
      Option.some('thread-1'),
    )
    expect(selectedThread(init(urlForPath('/settings/general')).model)).toEqual(Option.none())
  })

  it('names an idle row with no status word', () => {
    const idle = fixtureRow('idle-row', [], Option.none())
    expect(ThreadList.statusLabel(idle.status)).toBeUndefined()
    expect(ThreadList.statusLabel('needs-you')).toBe('Needs you')
    expect(ThreadList.statusLabel('failed')).toBe('Failed')
    expect(ThreadList.statusLabel('unread')).toBe('Unread')
    expect(ThreadList.statusLabel('working')).toBe('Working')
    expect(ThreadList.statusLabel('draft')).toBe('Draft')
  })

  it('finds a row in the seam, including a nested one', () => {
    const sections: ReadonlyArray<ThreadSection> = [
      {
        id: 'fixture',
        label: 'Fixture',
        rows: [
          fixtureRow(
            'parent',
            [fixtureRow('child', [fixtureRow('grandchild', [], Option.none())], Option.none())],
            Option.none(),
          ),
        ],
      },
    ]
    expect(threadById(sections, 'child')?.title).toBe('Fixture child')
    expect(threadById(sections, 'grandchild')?.title).toBe('Fixture grandchild')
    expect(threadById(sections, 'nope')).toBeUndefined()
  })
})

describe('composer', () => {
  const withProjects = (projects: ReadonlyArray<Project>): Model =>
    update(
      init(homeUrl).model,
      Message.GotProjects({ message: Projects.Message.ProjectsArrived({ projects }) }),
    ).model

  const listOne = (): Model =>
    withProjects([{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }])

  it('renders centered with headline, input, and the stub composer', () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(init(homeUrl).model)),
      Scene.expect(Scene.selector('[data-composer]')).toExist(),
      Scene.expect(Scene.text('What should we build in oru?')).toExist(),
      Scene.expect(Scene.selector('[data-composer-input]')).toExist(),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      // A cold load has no host answer, so the stub names no project; the
      // shell header renders the brand 'oru' all the same, which is why this is
      // asserted against the picker rather than against the literal.
      Scene.expect(Scene.selector('[data-project-picker-trigger]')).toContainText('Project'),
      Scene.expect(Scene.selector('[data-project-picker-trigger]')).not.toContainText('oru'),
    )
  })

  it("names the composer's project from the host's answer", () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(listOne())),
      Scene.expect(Scene.selector('[data-project-picker-trigger]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-project-picker-panel]')).not.toExist(),
    )
  })

  const homeListing = {
    path: '/tmp',
    parent: '/',
    entries: [
      { name: 'second', path: '/tmp/second', isDirectory: true },
      { name: 'note.txt', path: '/tmp/note.txt', isDirectory: false },
    ],
  }

  const secondListing = {
    path: '/tmp/second',
    parent: '/tmp',
    entries: [],
  }

  const arrivedHome = Message.GotProjects({
    message: Projects.Message.DirectoryArrived({ listing: homeListing }),
  })

  const arrivedSecond = Message.GotProjects({
    message: Projects.Message.DirectoryArrived({ listing: secondListing }),
  })

  it('opens the shared dialog from the composer chip: dirs only, breadcrumb, suggested name', () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(listOne())),
      Scene.click(Scene.selector('[data-project-picker-trigger]')),
      Scene.expect(Scene.selector('[data-project-picker-option="p1"]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-project-picker-option="new-project"]')).toExist(),
      Scene.click(Scene.selector('[data-project-picker-option="new-project"]')),
      Scene.Command.expectHas(ListDirectory),
      // The chip menu closes; the shared dialog opens in its place.
      Scene.expect(Scene.selector('[data-project-picker-panel]')).not.toExist(),
      Scene.expect(Scene.selector('[data-projects-dialog]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dirs-loading]')).toExist(),
      Scene.Command.resolve(ListDirectory, arrivedHome),
      // The browser names the checkout: breadcrumb, parent row, dirs only.
      Scene.expect(Scene.selector('[data-projects-breadcrumb]')).toContainText('tmp'),
      Scene.expect(Scene.selector('[data-projects-parent]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/second"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/note.txt"]')).not.toExist(),
      Scene.click(Scene.selector('[data-projects-dir="/tmp/second"]')),
      Scene.Command.resolve(ListDirectory, arrivedSecond),
      Scene.expect(Scene.selector('[data-projects-breadcrumb]')).toContainText('second'),
      // Confirming the directory opens the details dialog with the
      // checkout's own name suggested.
      Scene.click(Scene.selector('[data-projects-use-dir]')),
      Scene.expect(Scene.selector('[data-projects-dialog]')).not.toExist(),
      Scene.expect(Scene.selector('[data-projects-create]')).toExist(),
      Scene.expect(Scene.selector('#settings-project-create-name')).toHaveValue('second'),
      Scene.expect(Scene.selector('#settings-project-create-cwd')).toHaveValue('/tmp/second'),
      Scene.expect(Scene.selector('#settings-project-create-icon')).toExist(),
    )
  })

  it('creates from the shared dialog, and the host’s own row names the chip', () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(listOne())),
      Scene.click(Scene.selector('[data-project-picker-trigger]')),
      Scene.click(Scene.selector('[data-project-picker-option="new-project"]')),
      Scene.Command.resolve(ListDirectory, arrivedHome),
      Scene.click(Scene.selector('[data-projects-dir="/tmp/second"]')),
      Scene.Command.resolve(ListDirectory, arrivedSecond),
      Scene.click(Scene.selector('[data-projects-use-dir]')),
      Scene.type(Scene.selector('#settings-project-create-icon'), '/icons/second.svg'),
      Scene.click(Scene.selector('[data-projects-create-save]')),
      Scene.Command.expectHas(CreateProject),
      // The host's own row is what closes the dialog, so the chip names an
      // answered project and never the text that was typed.
      Scene.Command.resolve(
        CreateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectCreated({
            project: { id: 'p2', name: 'second', cwd: '/tmp/second', icon: '/icons/second.svg' },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-create]')).not.toExist(),
      Scene.expect(Scene.selector('[data-project-picker-trigger]')).toContainText('second'),
    )
  })

  it('shows the host’s refusal inline on the dialog that asked for it', () => {
    Scene.scene(
      { update, view },
      Scene.given(withStubs(listOne())),
      Scene.click(Scene.selector('[data-project-picker-trigger]')),
      Scene.click(Scene.selector('[data-project-picker-option="new-project"]')),
      Scene.Command.resolve(ListDirectory, arrivedHome),
      Scene.click(Scene.selector('[data-projects-dir="/tmp/second"]')),
      Scene.Command.resolve(ListDirectory, arrivedSecond),
      Scene.click(Scene.selector('[data-projects-use-dir]')),
      Scene.type(Scene.selector('#settings-project-create-cwd'), 'tmp/second'),
      Scene.click(Scene.selector('[data-projects-create-save]')),
      Scene.Command.expectHas(CreateProject),
      Scene.Command.resolve(
        CreateProject,
        Message.GotProjects({
          message: Projects.Message.CreateRefused({
            refusal: Projects.RelativeCwd.make({ cwd: 'tmp/second' }),
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-create-error]')).toContainText('absolute'),
      Scene.expect(Scene.selector('[data-projects-create-save]')).toBeEnabled(),
    )
  })

  it('keeps the draft and names the reason when no project is selected', () => {
    const typed = update(
      withStubs(init(homeUrl).model),
      Message.GotComposerUi({
        message: StubComposer.StubMessage.ChangedDraft({ value: 'hello composer' }),
      }),
    )
    Scene.scene(
      { update, view },
      Scene.given(typed.model),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      Scene.click(Scene.selector('[data-composer-submit]')),
      Scene.expect(Scene.selector('[data-submit-error-text]')).toContainText(
        'Select a project first.',
      ),
      Scene.expect(Scene.selector('[data-composer-input]')).toHaveValue('hello composer'),
      Scene.click(Scene.selector('[data-submit-error-dismiss]')),
      Scene.expect(Scene.selector('[data-submit-error]')).not.toExist(),
    )
  })

  it('creates the thread with the def configuration and navigates to it', () => {
    const ready = withStubs(listOne())

    Scene.scene(
      { update, view },
      Scene.given(ready),
      Scene.type(Scene.selector('[data-composer-input]'), 'hello composer'),
      Scene.click(Scene.selector('[data-composer-submit]')),
      Scene.Command.expectHas(CreateThreadAndSend),
      Scene.expect(Scene.selector('[data-composer-submit][data-disabled]')).toExist(),
      Scene.Command.resolve(CreateThreadAndSend, Message.ThreadCreated({ threadId: 'thread-1' })),
      Scene.Command.expectHas(NavigateInternal),
      Scene.Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
      Scene.expect(Scene.selector('[data-submit-error]')).not.toExist(),
    )

    const drafted = update(
      ready,
      Message.GotComposerUi({
        message: StubComposer.StubMessage.ChangedDraft({ value: 'hello composer' }),
      }),
    )
    const submitted = update(
      drafted.model,
      Message.GotComposerUi({ message: StubComposer.StubMessage.ClickedSubmit() }),
    )
    expect(submitted.commands?.[0]?.name).toBe('CreateThreadAndSend')
    expect(submitted.commands?.[0]?.args).toEqual({
      project: 'p1',
      harness: 'pi',
      model: 'muse/claude-1.3-contributor',
      reasoning: 'high',
      text: 'hello composer',
    })
    const created = update(submitted.model, Message.ThreadCreated({ threadId: 'thread-1' }))
    expect(created.commands?.[0]?.name).toBe('NavigateInternal')
    expect(created.commands?.[0]?.args).toEqual({ url: '/thread/thread-1' })
  })

  it('restores the draft when the host refuses the creation', () => {
    const submitted = update(
      update(
        withStubs(listOne()),
        Message.GotComposerUi({
          message: StubComposer.StubMessage.ChangedDraft({ value: 'hello composer' }),
        }),
      ).model,
      Message.GotComposerUi({ message: StubComposer.StubMessage.ClickedSubmit() }),
    )
    expect(submitted.commands?.[0]?.name).toBe('CreateThreadAndSend')
    const failed = update(
      submitted.model,
      Message.ThreadCreateFailed({ reason: 'SendMessage: boom', text: 'hello composer' }),
    )
    expect(failed.model.submit).toEqual({ pending: false, error: 'SendMessage: boom' })
    Scene.scene(
      { update, view },
      Scene.given(failed.model),
      Scene.expect(Scene.selector('[data-composer-input]')).toHaveValue('hello composer'),
    )
  })

  it('sends a follow-up straight to the thread the route selected', () => {
    const typed = update(
      withStubs(init(urlForPath('/thread/thread-1')).model),
      Message.GotComposerUi({
        message: StubComposer.StubMessage.ChangedDraft({ value: 'follow up' }),
      }),
    )
    const submitted = update(
      typed.model,
      Message.GotComposerUi({ message: StubComposer.StubMessage.ClickedSubmit() }),
    )
    expect(submitted.commands?.[0]?.name).toBe('SendThreadMessage')
    expect(submitted.commands?.[0]?.args).toEqual({ threadId: 'thread-1', text: 'follow up' })
    expect(submitted.model.submit.pending).toBe(true)
    const sent = update(submitted.model, Message.ThreadMessageSent())
    expect(sent.model.submit).toEqual({ pending: false, error: undefined })
    const failed = update(
      submitted.model,
      Message.ThreadMessageFailed({ reason: 'SendMessage: boom', text: 'follow up' }),
    )
    expect(failed.model.submit).toEqual({ pending: false, error: 'SendMessage: boom' })
    Scene.scene(
      { update, view },
      Scene.given(failed.model),
      Scene.expect(Scene.selector('[data-composer-input]')).toHaveValue('follow up'),
    )
  })

  it('mounts the assigned defs through the outlets, and empties them when the assignment vanishes', () => {
    const mounted = withStubs(init(homeUrl).model)
    Scene.scene(
      { update, view },
      Scene.given(mounted),
      Scene.expect(Scene.selector('[data-composer]')).toExist(),
    )
    const emptied = update(
      mounted,
      Message.UiSnapshotArrived({
        snapshot: { bundles: [], assignments: [] },
      }),
    )
    expect(emptied.commands ?? []).toEqual([])
    Scene.scene(
      { update, view },
      Scene.given(emptied.model),
      Scene.expect(Scene.selector('[data-composer]')).not.toExist(),
    )
  })
})

describe('model picker', () => {
  const catalogue: ThreadOptions['models'] = [
    { id: 'deepseek/deepseek-flash', label: 'DeepSeek Flash', provider: 'deepseek' },
    { id: 'github-copilot/gpt-5', label: 'Copilot Five', provider: 'github-copilot' },
  ]

  const ready: HarnessHealth = { status: 'ready' }

  const optionsFor = (health: HarnessHealth, model: string | undefined): ThreadOptions => ({
    config: { harness: 'pi', model, reasoning: undefined },
    harness: 'pi',
    harnesses: [{ id: 'pi', label: 'pi', icon: 'terminal', health }],
    providers: [
      { id: 'deepseek', label: 'DeepSeek', icon: 'waves' },
      { id: 'github-copilot', label: 'Muse', icon: 'bot' },
    ],
    models: catalogue,
  })

  const loaded = (url: Url.Url, health: HarnessHealth, model: string | undefined) =>
    update(init(url).model, Message.HostOptionsArrived({ options: optionsFor(health, model) }))
      .model

  it('asks the host for the options of the route it loaded', () => {
    expect(init(urlForPath('/thread/thread-1')).commands?.map((command) => command.name)).toEqual([
      'ListProjects',
      'LoadThreadOptions',
    ])
    // Home renders the picker trigger, so a cold load fetches the catalogue
    // the stored choice is named from; otherwise the trigger reads 'Model'
    // until the picker is first opened.
    expect(init(homeUrl).commands?.map((command) => command.name)).toEqual([
      'ListProjects',
      'LoadThreadOptions',
    ])
    expect(init(homeUrl).commands?.[1]).toMatchObject({
      name: 'LoadThreadOptions',
      args: { threadId: undefined, refresh: false },
    })
    expect(init(urlForPath('/settings/general')).commands?.map((command) => command.name)).toEqual([
      'ListProjects',
    ])
  })

  it('loads the picker for the route a navigation lands on, and resets it', () => {
    const loadedHome = loaded(homeUrl, ready, 'deepseek/deepseek-flash')

    const atThread = update(loadedHome, Message.ChangedUrl({ url: urlForPath('/thread/thread-1') }))
    expect(atThread.commands?.map((command) => command.name)).toEqual(['LoadThreadOptions'])
    expect(atThread.commands?.[0]?.args).toEqual({ threadId: 'thread-1', refresh: false })
    expect(Predicate.isTagged(atThread.model.options, 'Loading')).toBe(true)

    const atHome = update(atThread.model, Message.ChangedUrl({ url: urlForPath('/') }))
    expect(atHome.commands?.[0]?.args).toEqual({ threadId: undefined, refresh: false })

    const atSettings = update(
      atHome.model,
      Message.ChangedUrl({ url: urlForPath('/settings/appearance') }),
    )
    expect(atSettings.commands).toEqual([])
  })

  it('persists the pick when the def configures', async () => {
    const restore = withStorage({})
    try {
      const one = update(
        init(homeUrl).model,
        Message.GotProjects({
          message: Projects.Message.ProjectsArrived({
            projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
          }),
        }),
      ).model
      const configured = update(
        withStubs(one),
        Message.GotComposerUi({ message: StubComposer.StubMessage.TestConfigure() }),
      )
      expect(configured.commands?.[0]?.name).toBe('PersistPrefs')
      await Effect.runPromise(
        PersistPrefs({ model: 'deepseek/deepseek-flash', reasoning: 'low' }).effect,
      )
      expect(globalThis.localStorage?.getItem('oru.model-picker')).toBe(
        JSON.stringify({
          version: 1,
          model: 'deepseek/deepseek-flash',
          reasoning: 'low',
        }),
      )
    } finally {
      restore()
    }
  })
})

describe('routing', () => {
  it('builds each page back to its own URL', () => {
    expect(homeRouter()).toBe('/')
    expect(threadRouter({ threadId: 'thread-1' })).toBe('/thread/thread-1')
    expect(settingsIndexRouter()).toBe('/settings')
    expect(settingsGeneralRouter()).toBe('/settings/general')
    expect(settingsProvidersRouter()).toBe('/settings/providers')
    expect(settingsAppearanceRouter()).toBe('/settings/appearance')
  })

  it('parses every settings section to its own route, with a fallback', () => {
    expect(urlToAppRoute(urlForPath('/'))).toEqual(AppRoute.Home())
    expect(urlToAppRoute(urlForPath('/thread/thread-1'))).toEqual(
      AppRoute.Thread({ threadId: 'thread-1' }),
    )
    expect(urlToAppRoute(urlForPath('/settings'))).toEqual(AppRoute.SettingsGeneral())
    expect(urlToAppRoute(urlForPath('/settings/general'))).toEqual(AppRoute.SettingsGeneral())
    expect(urlToAppRoute(urlForPath('/settings/providers'))).toEqual(AppRoute.SettingsProviders())
    expect(urlToAppRoute(urlForPath('/settings/appearance'))).toEqual(AppRoute.SettingsAppearance())
    expect(urlToAppRoute(urlForPath('/nope'))).toEqual(AppRoute.NotFound({ path: '/nope' }))
  })

  it('titles each route from the section list', () => {
    expect(titleForRoute(AppRoute.Home())).toBe('oru')
    expect(titleForRoute(AppRoute.Thread({ threadId: 'thread-1' }))).toBe('Thread | oru')
    expect(titleForRoute(AppRoute.SettingsGeneral())).toBe('General - Settings | oru')
    expect(titleForRoute(AppRoute.SettingsProviders())).toBe('Providers - Settings | oru')
    expect(titleForRoute(AppRoute.NotFound({ path: '/nope' }))).toBe('Not found | oru')
  })

  it('reaches a settings route through ChangedUrl', () => {
    const moved = update(
      init(homeUrl).model,
      Message.ChangedUrl({ url: urlForPath('/settings/providers') }),
    )
    expect(moved.model.route).toEqual(AppRoute.SettingsProviders())
  })

  it('sends internal link clicks to pushUrl and leaves the model alone', () => {
    const before = init(homeUrl).model
    const internal = Navigation.UrlRequest.Internal({ url: urlForPath('/settings') })
    const after = update(before, Message.ClickedLink({ request: internal }))
    expect(after.model).toEqual(before)
    expect(after.commands).toHaveLength(1)
  })
})

describe('settings', () => {
  it('wires the sidebar settings icon at /settings', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(homeUrl).model),
      Scene.expect(Scene.selector('[data-nav="settings"]')).toHaveAttr('href', '/settings'),
    )
  })

  it('lists every section in the sidebar, with the current one marked', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/settings/providers')).model),
      Scene.expect(Scene.selector('[data-settings]')).toExist(),
      Scene.expect(Scene.selector('[data-settings-back]')).toHaveAttr('href', '/'),
      ...settingsSections.map((section) =>
        Scene.expect(Scene.selector(`[data-settings-link="${section.id}"]`)).toContainText(
          section.label,
        ),
      ),
      Scene.expect(Scene.selector('[data-settings-link="providers"]')).toHaveAttr(
        'aria-current',
        'page',
      ),
      Scene.expect(Scene.selector('[data-settings-link="general"]')).not.toHaveAttr(
        'aria-current',
        'page',
      ),
    )
  })

  it('renders the General skeleton: toggles, followup select, branch prefix', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/settings')).model),
      Scene.expect(Scene.selector('[data-settings-page="general"]')).toExist(),
      Scene.expect(Scene.text('Navigate to threads on creation')).toExist(),
      Scene.expect(Scene.text('Default thread followup behavior')).toExist(),
      Scene.expect(Scene.selector('#settings-branch-prefix')).toHaveValue('elianiva/'),
      Scene.expect(Scene.text('bb CLI skills')).toExist(),
      Scene.expect(Scene.text('Voice Input')).toExist(),
      Scene.expect(Scene.text('Show diagnostic events')).toExist(),
    )
  })

  it('toggles a General switch through the root loop', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/settings/general')).model),
      Scene.expect(Scene.selector('#settings-navigate-to-threads')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      Scene.click(Scene.selector('#settings-navigate-to-threads')),
      Scene.expect(Scene.selector('#settings-navigate-to-threads')).toHaveAttr(
        'aria-checked',
        'false',
      ),
    )
  })

  it('stores General control state in its own submodel', () => {
    const toggled = General.update(
      General.init(),
      General.Message.ToggledStreamerMode({ isChecked: true }),
    )
    expect(toggled.model.streamerMode).toBe(true)
    const renamed = General.update(
      toggled.model,
      General.Message.ChangedBranchPrefix({ value: 'wip/' }),
    )
    expect(renamed.model.branchPrefix).toBe('wip/')
  })

  it('renders a placeholder page per section behind its own route', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/settings/appearance')).model),
      Scene.expect(Scene.selector('[data-settings-page="appearance"]')).toExist(),
      Scene.expect(Scene.selector('[data-settings-link="appearance"]')).toHaveAttr(
        'aria-current',
        'page',
      ),
    )
  })

  it('lists the host’s projects on the Projects page and renames one through the host', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.expect(Scene.selector('[data-settings-page="projects"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-row="p1"]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-projects-row="p1"]')).toContainText('/tmp/oru'),
      Scene.expect(Scene.selector('[data-projects-open="p1"]')).toHaveAttr(
        'href',
        '/settings/projects/p1',
      ),
    )

    const detailFixture = {
      project: { id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined },
      threadCount: 0,
      createdAt: Date.now(),
      gitRemote: undefined,
      checkout: { machine: 'melon', path: '/tmp/oru' },
      threadDefaults: undefined,
    }
    const onDetail = [
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
      Message.GotProjects({
        message: Projects.Message.DetailArrived({ detail: detailFixture }),
      }),
    ].reduce<Model>(
      (current, message) => update(current, message).model,
      init(urlForPath('/settings/projects/p1')).model,
    )

    Scene.scene(
      { update, view },
      Scene.given(onDetail),
      Scene.expect(Scene.selector('[data-settings-page="project-detail"]')).toExist(),
      Scene.expect(Scene.selector('[data-project-detail-name]')).toContainText('oru'),
      Scene.click(Scene.selector('[data-projects-edit="p1"]')),
      Scene.expect(Scene.selector('#settings-project-name')).toHaveValue('oru'),
      Scene.type(Scene.selector('#settings-project-name'), 'oru-app'),
      Scene.click(Scene.selector('[data-projects-save="p1"]')),
      Scene.Command.expectHas(UpdateProject),
      Scene.Command.resolve(
        UpdateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectUpdated({
            project: { id: 'p1', name: 'oru-app', cwd: '/tmp/oru', icon: undefined },
          }),
        }),
      ),
      Scene.Command.resolve(
        GetProjectDetail,
        Message.GotProjects({
          message: Projects.Message.DetailArrived({
            detail: {
              project: { id: 'p1', name: 'oru-app', cwd: '/tmp/oru', icon: undefined },
              threadCount: 0,
              createdAt: Date.now(),
              gitRemote: undefined,
              checkout: { machine: 'melon', path: '/tmp/oru' },
              threadDefaults: undefined,
            },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-edit-form="p1"]')).not.toExist(),
    )
  })

  it('creates from the settings page with Browse filling the cwd and icon saved', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.expect(Scene.selector('[data-projects-create]')).not.toExist(),
      Scene.expect(Scene.selector('[data-projects-dialog]')).not.toExist(),
      Scene.click(Scene.selector('[data-projects-create-open]')),
      Scene.expect(Scene.selector('[data-projects-dialog]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-create]')).not.toExist(),
      Scene.Command.expectHas(ListDirectory),
      Scene.Command.resolve(
        ListDirectory,
        Message.GotProjects({
          message: Projects.Message.DirectoryArrived({
            listing: {
              path: '/tmp/second',
              parent: '/tmp',
              entries: [{ name: 'app', path: '/tmp/second/app', isDirectory: true }],
            },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/second/app"]')).toExist(),
      Scene.click(Scene.selector('[data-projects-use-dir]')),
      Scene.expect(Scene.selector('#settings-project-create-cwd')).toHaveValue('/tmp/second'),
      Scene.expect(Scene.selector('#settings-project-create-name')).toHaveValue('second'),
      Scene.type(Scene.selector('#settings-project-create-icon'), '/icons/second.svg'),
      Scene.click(Scene.selector('[data-projects-create-save]')),
      Scene.Command.expectHas(CreateProject),
      Scene.Command.resolve(
        CreateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectCreated({
            project: {
              id: 'p2',
              name: 'second',
              cwd: '/tmp/second',
              icon: '/icons/second.svg',
            },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-create]')).not.toExist(),
      Scene.expect(Scene.selector('[data-projects-row="p2"]')).toContainText('second'),
    )
  })

  it('saves the logo with a rename and deletes with a confirm', () => {
    const detailFixture = {
      project: { id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined },
      threadCount: 2,
      createdAt: Date.now(),
      gitRemote: 'git@github.com:elianiva/oru.git',
      checkout: { machine: 'melon', path: '/tmp/oru' },
      threadDefaults: { harness: 'pi', model: 'deepseek/deepseek-flash', reasoning: 'high' },
    }
    const listed = [
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
      Message.GotProjects({
        message: Projects.Message.DetailArrived({ detail: detailFixture }),
      }),
    ].reduce<Model>(
      (current, message) => update(current, message).model,
      init(urlForPath('/settings/projects/p1')).model,
    )

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.expect(Scene.selector('[data-project-detail-name]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-project-detail-subtitle]')).toContainText('2 threads'),
      Scene.click(Scene.selector('[data-projects-edit="p1"]')),
      Scene.expect(Scene.selector('[data-projects-icon] #settings-project-icon')).toExist(),
      Scene.type(Scene.selector('#settings-project-icon'), '/icons/oru.svg'),
      Scene.click(Scene.selector('[data-projects-save="p1"]')),
      Scene.Command.expectHas(UpdateProject),
      Scene.Command.resolve(
        UpdateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectUpdated({
            project: { id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: '/icons/oru.svg' },
          }),
        }),
      ),
      Scene.Command.resolve(
        GetProjectDetail,
        Message.GotProjects({
          message: Projects.Message.DetailArrived({ detail: detailFixture }),
        }),
      ),
      Scene.expect(Scene.selector('[data-project-detail-name]')).toExist(),
      Scene.click(Scene.selector('[data-projects-delete="p1"]')),
      Scene.expect(Scene.selector('[data-projects-delete-confirm="p1"]')).toExist(),
      Scene.click(Scene.selector('[data-projects-delete-confirm-button="p1"]')),
      Scene.Command.expectHas(DeleteProject),
      Scene.Command.resolve(
        DeleteProject,
        Message.GotProjects({ message: Projects.Message.ProjectDeleted({ project: 'p1' }) }),
      ),
      Scene.Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
      Scene.expect(Scene.selector('[data-projects-delete-confirm="p1"]')).not.toExist(),
    )
  })

  it('suggests the directory’s own name and keeps a typed one', () => {
    expect(Projects.deriveProjectName('/tmp/second')).toBe('second')
    expect(Projects.deriveProjectName('/tmp/second/')).toBe('second')
    expect(Projects.deriveProjectName('/')).toBe('project')
  })

  it('never lists dotfolders in the directory browser', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.click(Scene.selector('[data-projects-create-open]')),
      Scene.Command.expectHas(ListDirectory),
      Scene.Command.resolve(
        ListDirectory,
        Message.GotProjects({
          message: Projects.Message.DirectoryArrived({
            listing: {
              path: '/tmp',
              parent: '/',
              entries: [
                { name: 'app', path: '/tmp/app', isDirectory: true },
                { name: '.git', path: '/tmp/.git', isDirectory: true },
              ],
            },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/app"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/.git"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-projects-toggle-hidden]')).not.toExist(),
    )
  })

  it('preloads a hovered folder so opening it answers from cache', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined }],
        }),
      }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.click(Scene.selector('[data-projects-create-open]')),
      Scene.Command.expectHas(ListDirectory),
      Scene.Command.resolve(
        ListDirectory,
        Message.GotProjects({
          message: Projects.Message.DirectoryArrived({
            listing: {
              path: '/tmp',
              parent: '/',
              entries: [{ name: 'app', path: '/tmp/app', isDirectory: true }],
            },
          }),
        }),
      ),
      Scene.hover(Scene.selector('[data-projects-dir="/tmp/app"]')),
      Scene.Command.expectHas(PreloadDirectory),
      Scene.Command.resolve(
        PreloadDirectory,
        Message.GotProjects({
          message: Projects.Message.DirectoryCached({
            listing: {
              path: '/tmp/app',
              parent: '/tmp',
              entries: [{ name: 'src', path: '/tmp/app/src', isDirectory: true }],
            },
          }),
        }),
      ),
      // A cached open issues no ListDirectory: an extra fetch would surface
      // here as a command without a resolver and fail the scene.
      Scene.click(Scene.selector('[data-projects-dir="/tmp/app"]')),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/app/src"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dirs-loading]')).not.toExist(),
      // And the way back is cached too.
      Scene.click(Scene.selector('[data-projects-parent]')),
      Scene.expect(Scene.selector('[data-projects-dir="/tmp/app"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-dirs-loading]')).not.toExist(),
    )
  })

  it('keeps the stale listing mounted while the next directory loads', () => {
    const opened = [
      Projects.Message.ClickedCreate(),
      Projects.Message.ClickedCreateBrowse(),
      Projects.Message.DirectoryArrived({
        listing: {
          path: '/tmp',
          parent: '/',
          entries: [{ name: 'app', path: '/tmp/app', isDirectory: true }],
        },
      }),
    ].reduce((model, message) => Projects.update(model, message).model, Projects.init())
    const moving = Projects.update(opened, Projects.Message.OpenedDirectory({ path: '/tmp/app' }))
    expect(moving.model.create?.browse?.isLoading).toBe(true)
    expect(moving.model.create?.browse?.listing?.path).toBe('/tmp')
    expect('outMessage' in moving ? moving.outMessage : undefined).toEqual(
      Projects.OutMessage.RequestedDirectory({ path: '/tmp/app' }),
    )
  })

  it('hovers only once per path and never the open folder', () => {
    const opened = [
      Projects.Message.ClickedCreate(),
      Projects.Message.ClickedCreateBrowse(),
      Projects.Message.DirectoryArrived({
        listing: {
          path: '/tmp',
          parent: '/',
          entries: [{ name: 'app', path: '/tmp/app', isDirectory: true }],
        },
      }),
    ].reduce((model, message) => Projects.update(model, message).model, Projects.init())
    const current = Projects.update(opened, Projects.Message.HoveredDirectory({ path: '/tmp' }))
    expect('outMessage' in current ? current.outMessage : undefined).toBeUndefined()
    const first = Projects.update(opened, Projects.Message.HoveredDirectory({ path: '/tmp/app' }))
    expect('outMessage' in first ? first.outMessage : undefined).toEqual(
      Projects.OutMessage.RequestedPreload({ path: '/tmp/app' }),
    )
    const second = Projects.update(
      first.model,
      Projects.Message.HoveredDirectory({ path: '/tmp/app' }),
    )
    expect('outMessage' in second ? second.outMessage : undefined).toBeUndefined()
  })

  it('renders the Projects page empty rather than with a plausible row', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({ message: Projects.Message.ProjectsArrived({ projects: [] }) }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.expect(Scene.selector('[data-projects-settings-empty]')).toExist(),
      Scene.expectAll(Scene.all.selector('[data-projects-row]')).toHaveCount(0),
    )
  })

  it('cannot open another project while one save is in flight', () => {
    const listed = update(
      init(urlForPath('/settings/projects')).model,
      Message.GotProjects({
        message: Projects.Message.ProjectsArrived({
          projects: [
            { id: 'p1', name: 'oru', cwd: '/tmp/oru', icon: undefined },
            { id: 'p2', name: 'bb', cwd: '/tmp/bb', icon: undefined },
          ],
        }),
      }),
    ).model
    const editP1: ReadonlyArray<Projects.Message> = [
      Projects.Message.ClickedEdit({ project: 'p1' }),
      Projects.Message.ChangedEditField({ field: 'name', value: 'oru-app' }),
      Projects.Message.ClickedEditSave(),
    ]
    const editingP1 = editP1.reduce(
      (current, message) => update(current, Message.GotProjects({ message })).model,
      listed,
    )

    const switched = update(
      editingP1,
      Message.GotProjects({ message: Projects.Message.ClickedEdit({ project: 'p2' }) }),
    ).model
    expect(switched.projects.edit?.project).toBe('p1')

    const canceled = update(
      switched,
      Message.GotProjects({ message: Projects.Message.ClickedEditCancel() }),
    ).model
    expect(canceled.projects.edit?.project).toBe('p1')

    // The answer p1 was waiting for is the only thing that closes its editor.
    const answered = update(
      canceled,
      Message.GotProjects({
        message: Projects.Message.ProjectUpdated({
          project: { id: 'p1', name: 'oru-app', cwd: '/tmp/oru', icon: undefined },
        }),
      }),
    ).model
    expect(answered.projects.edit).toBeUndefined()
    expect(answered.projects.host).toEqual(
      Projects.Loaded.make({
        projects: [
          { id: 'p1', name: 'oru-app', cwd: '/tmp/oru', icon: undefined },
          { id: 'p2', name: 'bb', cwd: '/tmp/bb', icon: undefined },
        ],
      }),
    )
  })

  it('explains an unknown path with a way back', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/nope')).model),
      Scene.expect(Scene.text('Nothing here')).toExist(),
      Scene.expect(Scene.selector('[data-settings]')).not.toExist(),
    )
  })
})
