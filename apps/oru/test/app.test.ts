import { Option } from 'effect'
import * as Scene from 'foldkit/scene'
import { afterEach, describe, expect, it } from 'vitest'
import * as Resizable from '../src/components/ui/resizable.ts'
import * as Composer from '../src/composer.ts'
import { Message, init, update, view } from '../src/root.ts'
import * as Shell from '../src/shell.ts'
import {
  fakeThreadSections,
  threadById,
  type ThreadRow,
  type ThreadSection,
} from '../src/threads.ts'
import * as ThreadList from '../src/thread-list.ts'

const sizes = (model: Shell.Model): ReadonlyArray<number> => model.panels.map((panel) => panel.size)

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

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
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
      Scene.given(init().model),
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
      Scene.given(init().model),
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
    const { model } = init()
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
    const { model } = init()
    const shell = model.shell

    expect(sizes(enterOn(shell, 1))).toEqual(sizes(shell))

    const dragRight = dragged(shell, 1, 30)
    const toggleRight = Shell.togglePanel(shell, 'right')
    expect(panelSize(toggleRight, 'right')).toBe(0)
    expect(sizes(toggleRight)).toEqual(sizes(dragRight))
    expect(panelSize(dragRight, 'main')).toBe(77.778)
  })

  it('returns a collapsed sidebar to the size it had, and holds both at once', () => {
    const { model } = init()
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
    const { model } = init()
    const shell = model.shell
    expect(Shell.isCollapsed(shell, 'left')).toBe(false)
    expect(Shell.isCollapsed(Shell.togglePanel(shell, 'left'), 'left')).toBe(true)
    expect(Shell.isCollapsed(dragged(shell, 1, 30), 'right')).toBe(true)
    expect(Shell.isCollapsed(shell, 'right')).toBe(false)
  })

  it('mirrors the settled layout to storage and stays quiet during a drag', () => {
    const restore = withStorage({})
    try {
      const { model } = init()
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

  it('encloses a project group of more than one row, and only that one', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(
        Scene.selector('[data-thread-section="active"] [data-thread-group="oru"]'),
      ).toHaveClass('rounded-lg'),
      Scene.expect(
        Scene.selector('[data-thread-section="active"] [data-thread-group="bb-sidebar"]'),
      ).not.toHaveClass('rounded-lg'),
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
            { sections: fixtureSection([chain(4)]), selected: Option.none() },
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
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.click(Scene.selector('[data-section-toggle="active"]')),
      Scene.expect(Scene.text('Active (3)')).toExist(),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro-tests"]')).not.toExist(),
    )
  })

  it('reports a click upward and lets the app hold the selection', () => {
    const click = ThreadList.update(
      ThreadList.init(),
      ThreadList.Message.ClickedThread({ id: 'sidebar-rows' }),
    )
    expect('outMessage' in click ? click.outMessage : undefined).toEqual(
      ThreadList.OutMessage.Selected({ id: 'sidebar-rows' }),
    )

    const selected = update(
      init().model,
      Message.GotThreads({ message: ThreadList.Message.ClickedThread({ id: 'sidebar-rows' }) }),
    )
    expect(selected.model.selectedThread).toEqual(Option.some('sidebar-rows'))
  })

  it('carries the selection into the right column through the shell’s slot callback', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(Scene.selector('[data-detail]')).toContainText('No thread selected'),
      Scene.click(Scene.selector('[data-thread-row="shell-retro"]')),
      Scene.expect(Scene.selector('[data-detail]')).toContainText(
        'Fold the resizable engine into the app shell',
      ),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro"]')).toHaveAttr(
        'aria-current',
        'page',
      ),
    )
  })

  it('names an idle row with no status word', () => {
    const idle = threadById(fakeThreadSections, 'kernel-session-fold')
    expect(idle === undefined ? undefined : ThreadList.statusLabel(idle.status)).toBeUndefined()
    expect(ThreadList.statusLabel('needs-you')).toBe('Needs you')
    expect(ThreadList.statusLabel('failed')).toBe('Failed')
    expect(ThreadList.statusLabel('unread')).toBe('Unread')
    expect(ThreadList.statusLabel('working')).toBe('Working')
    expect(ThreadList.statusLabel('draft')).toBe('Draft')
  })

  it('finds a row in the seam, including a nested one', () => {
    expect(threadById(fakeThreadSections, 'shell-retro-audit')?.title).toBe(
      'Audit collapse semantics',
    )
    expect(threadById(fakeThreadSections, 'shell-retro-tests-reload')?.title).toBe(
      'Reload with both sidebars shut',
    )
    expect(threadById(fakeThreadSections, 'nope')).toBeUndefined()
  })
})

describe('composer', () => {
  it('renders centered with headline, input, actions, and context chips', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(Scene.selector('[data-composer]')).toExist(),
      Scene.expect(Scene.text('What should we build in oru?')).toExist(),
      Scene.expect(Scene.selector('[data-composer-input]')).toExist(),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      Scene.expect(Scene.text('Medium')).toExist(),
      Scene.expect(Scene.text('oru')).toExist(),
      Scene.expect(Scene.text('Worktree')).toExist(),
      Scene.expect(Scene.text('Branch from: origin/master')).toExist(),
      Scene.expect(Scene.text('Full Access')).toExist(),
    )
  })

  it('submits a draft through the root loop, clearing the box', () => {
    const typed = update(
      init().model,
      Message.GotComposer({
        message: Composer.Message.ChangedDraft({ value: 'hello composer' }),
      }),
    )
    Scene.scene(
      { update, view },
      Scene.given(typed.model),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      Scene.click(Scene.selector('[data-composer-submit]')),
      Scene.expect(Scene.selector('[data-composer-submit][data-disabled]')).toExist(),
    )
  })

  it('emits Submitted with the draft text and clears it', () => {
    const typed = Composer.update(Composer.init(), Composer.Message.ChangedDraft({ value: 'hi' }))
    expect(typed.model.draft).toBe('hi')
    const sent = Composer.update(typed.model, Composer.Message.ClickedSubmit())
    expect(sent.model.draft).toBe('')
    expect('outMessage' in sent ? sent.outMessage : undefined).toEqual(
      Composer.OutMessage.Submitted({ text: 'hi' }),
    )
  })

  it('does nothing on submit with a blank draft', () => {
    const sent = Composer.update(Composer.init(), Composer.Message.ClickedSubmit())
    expect(sent.model.draft).toBe('')
    expect('outMessage' in sent ? sent.outMessage : undefined).toBeUndefined()
  })

  it('merges contributions from multiple sources', () => {
    const merged = Composer.mergeContributions(
      {
        placeholder: 'Ask anything',
        headline: 'Build something',
        leading: [{ id: 'add' }],
        trailing: [],
        chips: [],
      },
      {
        ...Composer.emptyContributions(''),
        chips: [{ id: 'repo', label: 'oru' }],
      },
    )
    expect(merged.placeholder).toBe('Ask anything')
    expect(merged.headline).toBe('Build something')
    expect(merged.leading).toHaveLength(1)
    expect(merged.chips).toHaveLength(1)
  })
})
