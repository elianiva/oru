import { Option } from 'effect'
import { Navigation, Url } from 'foldkit'
import * as Scene from 'foldkit/scene'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '@oru/rpc'
import * as Resizable from '../src/components/ui/resizable.ts'
import * as Composer from '../src/composer.ts'
import {
  CreateProject,
  Message,
  Model,
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
import {
  fakeThreadSections,
  threadById,
  type ThreadRow,
  type ThreadSection,
} from '../src/threads.ts'
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
    Scene.scene(
      { update, view },
      Scene.given(init(homeUrl).model),
      Scene.expectAll(
        Scene.all.selector('[data-thread-section="active"] [data-thread-group]'),
      ).toHaveCount(2),
      Scene.expect(Scene.selector('[data-thread-group="oru"]')).toHaveAttr(
        'aria-label',
        'oru threads',
      ),
      Scene.expect(Scene.selector('[data-thread-group="bb-sidebar"]')).toContainText(
        'Status slot: word or age, never both',
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
      Scene.given(init(homeUrl).model),
      Scene.click(Scene.selector('[data-section-toggle="active"]')),
      Scene.expect(Scene.text('Active (3)')).toExist(),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro-tests"]')).not.toExist(),
    )
  })

  it('reports a click upward and navigates to that thread’s URL', () => {
    const click = ThreadList.update(
      ThreadList.init(),
      ThreadList.Message.ClickedThread({ id: 'sidebar-rows' }),
    )
    expect('outMessage' in click ? click.outMessage : undefined).toEqual(
      ThreadList.OutMessage.Selected({ id: 'sidebar-rows' }),
    )

    const before = init(homeUrl).model
    const selected = update(
      before,
      Message.GotThreads({ message: ThreadList.Message.ClickedThread({ id: 'sidebar-rows' }) }),
    )
    expect(selected.model).toEqual(before)
    expect(selected.commands).toHaveLength(1)
    expect(selected.commands?.[0]?.name).toBe('NavigateInternal')
    expect(selected.commands?.[0]?.args).toEqual({ url: '/thread/sidebar-rows' })
  })

  it('draws the selected thread from the route, in both columns', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(urlForPath('/thread/shell-retro')).model),
      Scene.expect(Scene.selector('[data-detail]')).toContainText(
        'Fold the resizable engine into the app shell',
      ),
      Scene.expect(Scene.selector('[data-thread-row="shell-retro"]')).toHaveAttr(
        'aria-current',
        'page',
      ),
      Scene.expect(Scene.selector('[data-conversation]')).toContainText(
        'Fold the resizable engine into the app shell',
      ),
    )
  })

  it('reads the selection out of the route and shows no thread at home', () => {
    expect(selectedThread(init(homeUrl).model)).toEqual(Option.none())
    expect(selectedThread(init(urlForPath('/thread/shell-retro')).model)).toEqual(
      Option.some('shell-retro'),
    )
    expect(selectedThread(init(urlForPath('/settings/general')).model)).toEqual(Option.none())
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
  const withProjects = (projects: ReadonlyArray<Project>): Model =>
    update(
      init(homeUrl).model,
      Message.GotProjects({ message: Projects.Message.ProjectsArrived({ projects }) }),
    ).model

  const listOne = (): Model => withProjects([{ id: 'p1', name: 'oru', cwd: '/tmp/oru' }])

  /** The composer's own path to a filled-in create form, as the browser walks it. */
  const typedCreateForm = (model: Model): Model => {
    const walk: ReadonlyArray<Composer.Message> = [
      Composer.Message.ClickedAction({ id: 'project' }),
      Composer.Message.ClickedChipOption({ chip: 'project', option: 'new-project' }),
      Composer.Message.ChangedChipField({ chip: 'project', field: 'name', value: 'second' }),
      Composer.Message.ChangedChipField({ chip: 'project', field: 'cwd', value: 'tmp/second' }),
    ]
    return walk.reduce(
      (current, message) => update(current, Message.GotComposer({ message })).model,
      model,
    )
  }

  it('renders centered with headline, input, actions, and context chips', () => {
    Scene.scene(
      { update, view },
      Scene.given(init(homeUrl).model),
      Scene.expect(Scene.selector('[data-composer]')).toExist(),
      Scene.expect(Scene.text('What should we build in oru?')).toExist(),
      Scene.expect(Scene.selector('[data-composer-input]')).toExist(),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      Scene.expect(Scene.text('Medium')).toExist(),
      // A cold load has no host answer, so the chip names no project; the
      // shell header renders the brand 'oru' all the same, which is why this is
      // asserted against the chip rather than against the literal.
      Scene.expect(Scene.selector('[data-composer-chip="project"]')).toContainText('Project'),
      Scene.expect(Scene.selector('[data-composer-chip="project"]')).not.toContainText('oru'),
      Scene.expect(Scene.text('Worktree')).toExist(),
      Scene.expect(Scene.text('Branch from: origin/master')).toExist(),
      Scene.expect(Scene.text('Full Access')).toExist(),
    )
  })

  it('names the composer’s project from the host’s answer', () => {
    Scene.scene(
      { update, view },
      Scene.given(listOne()),
      Scene.expect(Scene.selector('[data-composer-chip="project"]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-composer-chip-panel="project"]')).not.toExist(),
    )
  })

  it('lists the host’s projects in the chip and creates from its form', () => {
    Scene.scene(
      { update, view },
      Scene.given(listOne()),
      Scene.click(Scene.selector('[data-composer-chip="project"]')),
      Scene.expect(Scene.selector('[data-composer-chip-option="p1"]')).toContainText('/tmp/oru'),
      Scene.expect(Scene.selector('[data-composer-chip-option="new-project"]')).toExist(),
      Scene.click(Scene.selector('[data-composer-chip-option="new-project"]')),
      Scene.type(Scene.selector('[data-composer-chip-field="name"]'), 'second'),
      Scene.type(Scene.selector('[data-composer-chip-field="cwd"]'), '/tmp/second'),
      Scene.click(Scene.selector('[data-composer-chip-submit]')),
      Scene.Command.expectHas(CreateProject),
      // The host's own row is what closes the form, so the chip names an
      // answered project and never the text that was typed.
      Scene.Command.resolve(
        CreateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectCreated({
            project: { id: 'p2', name: 'second', cwd: '/tmp/second' },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-composer-chip-panel="project"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-composer-chip="project"]')).toContainText('second'),
    )
  })

  it('asks the host to create what the form describes, then shows its refusal inline', () => {
    const submitted = update(
      typedCreateForm(listOne()),
      Message.GotComposer({ message: Composer.Message.ClickedChipSubmit({ chip: 'project' }) }),
    )
    expect(submitted.commands?.map((command) => command.name)).toEqual(['CreateProject'])
    expect(submitted.commands?.[0]?.args).toEqual({ name: 'second', cwd: 'tmp/second' })

    const refused = update(
      submitted.model,
      Message.GotProjects({
        message: Projects.Message.CreateRefused({
          refusal: Projects.RelativeCwd.make({ cwd: 'tmp/second' }),
        }),
      }),
    )
    Scene.scene(
      { update, view },
      Scene.given(refused.model),
      Scene.expect(Scene.selector('[data-composer-chip-error="project"]')).toContainText(
        'absolute',
      ),
      Scene.expect(Scene.selector('[data-composer-chip-submit="project"]')).toBeEnabled(),
    )
  })

  it('keeps a create draft through a host that stops, and stops calling it pending', () => {
    const submitted = update(
      typedCreateForm(listOne()),
      Message.GotComposer({ message: Composer.Message.ClickedChipSubmit({ chip: 'project' }) }),
    ).model
    expect(submitted.projects.panel).toEqual(
      Projects.PanelComposing.make({
        name: 'second',
        cwd: 'tmp/second',
        refusal: undefined,
        isSaving: true,
      }),
    )

    const back = update(
      submitted,
      Message.GotProjects({
        message: Projects.Message.HostUnreachable({ reason: 'ListProjects: the host is down' }),
      }),
    ).model
    expect(back.projects.panel).toEqual(
      Projects.PanelComposing.make({
        name: 'second',
        cwd: 'tmp/second',
        refusal: undefined,
        isSaving: false,
      }),
    )

    const remembered = update(
      back,
      Message.GotProjects({ message: Projects.Message.ProjectsArrived({ projects: [] }) }),
    ).model
    Scene.scene(
      { update, view },
      Scene.given(remembered),
      Scene.expect(Scene.selector('[data-composer-chip="project"]')).toHaveAttr(
        'aria-expanded',
        'true',
      ),
      Scene.expect(Scene.selector('[data-composer-chip-field="name"]')).toHaveValue('second'),
      Scene.expect(Scene.selector('[data-composer-chip-submit="project"]')).toBeEnabled(),
    )
  })

  it('holds a draft the host owes an answer for, so the refusal reaches the form that asked', () => {
    const submitted = update(
      typedCreateForm(listOne()),
      Message.GotComposer({ message: Composer.Message.ClickedChipSubmit({ chip: 'project' }) }),
    ).model
    Scene.scene(
      { update, view },
      Scene.given(submitted),
      Scene.expect(Scene.selector('[data-composer-chip-submit="project"]')).toBeDisabled(),
      Scene.expect(Scene.selector('[data-composer-chip-cancel="project"]')).toBeDisabled(),
    )

    const abandoned = ((): Model => {
      const walk: ReadonlyArray<Composer.Message> = [
        Composer.Message.ClickedChipCancel({ chip: 'project' }),
        Composer.Message.ClickedAction({ id: 'project' }),
        Composer.Message.ClickedChipOption({ chip: 'project', option: 'new-project' }),
        Composer.Message.ChangedChipField({ chip: 'project', field: 'name', value: 'third' }),
      ]
      return walk.reduce(
        (current, message) => update(current, Message.GotComposer({ message })).model,
        submitted,
      )
    })()
    expect(abandoned.projects.panel).toEqual(submitted.projects.panel)

    const refused = update(
      abandoned,
      Message.GotProjects({
        message: Projects.Message.CreateRefused({
          refusal: Projects.RelativeCwd.make({ cwd: 'tmp/second' }),
        }),
      }),
    ).model
    Scene.scene(
      { update, view },
      Scene.given(refused),
      Scene.expect(Scene.selector('[data-composer-chip-error="project"]')).toContainText(
        'tmp/second',
      ),
      Scene.expect(Scene.selector('[data-composer-chip-field="name"]')).toHaveValue('second'),
      Scene.expect(Scene.selector('[data-composer-chip-submit="project"]')).toBeEnabled(),
      Scene.expect(Scene.selector('[data-composer-chip-cancel="project"]')).toBeEnabled(),
    )
  })

  it('marks a project as picked only when the host answer backs the pick', () => {
    Scene.scene(
      { update, view },
      Scene.given(listOne()),
      Scene.click(Scene.selector('[data-composer-chip="project"]')),
      Scene.expectAll(Scene.all.selector('[data-composer-chip-option-selected]')).toHaveCount(0),
      Scene.click(Scene.selector('[data-composer-chip-option="p1"]')),
      Scene.click(Scene.selector('[data-composer-chip="project"]')),
      Scene.expectAll(Scene.all.selector('[data-composer-chip-option-selected]')).toHaveCount(1),
    )
  })

  it('does not offer a project id the host never answered with', () => {
    const opened = update(
      listOne(),
      Message.GotComposer({ message: Composer.Message.ClickedAction({ id: 'project' }) }),
    ).model
    const picked = update(
      opened,
      Message.GotComposer({
        message: Composer.Message.ClickedChipOption({ chip: 'project', option: 'p-ghost' }),
      }),
    ).model
    expect(Projects.selectedProject(picked.projects)?.id).toBe('p1')
  })

  it('submits a draft through the root loop, clearing the box', () => {
    const typed = update(
      init(homeUrl).model,
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
        chips: [{ id: 'project', label: 'oru' }],
      },
    )
    expect(merged.placeholder).toBe('Ask anything')
    expect(merged.headline).toBe('Build something')
    expect(merged.leading).toHaveLength(1)
    expect(merged.chips).toHaveLength(1)
  })
})

describe('routing', () => {
  it('builds each page back to its own URL', () => {
    expect(homeRouter()).toBe('/')
    expect(threadRouter({ threadId: 'shell-retro' })).toBe('/thread/shell-retro')
    expect(settingsIndexRouter()).toBe('/settings')
    expect(settingsGeneralRouter()).toBe('/settings/general')
    expect(settingsProvidersRouter()).toBe('/settings/providers')
    expect(settingsAppearanceRouter()).toBe('/settings/appearance')
  })

  it('parses every settings section to its own route, with a fallback', () => {
    expect(urlToAppRoute(urlForPath('/'))).toEqual(AppRoute.Home())
    expect(urlToAppRoute(urlForPath('/thread/shell-retro'))).toEqual(
      AppRoute.Thread({ threadId: 'shell-retro' }),
    )
    expect(urlToAppRoute(urlForPath('/settings'))).toEqual(AppRoute.SettingsGeneral())
    expect(urlToAppRoute(urlForPath('/settings/general'))).toEqual(AppRoute.SettingsGeneral())
    expect(urlToAppRoute(urlForPath('/settings/providers'))).toEqual(AppRoute.SettingsProviders())
    expect(urlToAppRoute(urlForPath('/settings/appearance'))).toEqual(AppRoute.SettingsAppearance())
    expect(urlToAppRoute(urlForPath('/nope'))).toEqual(AppRoute.NotFound({ path: '/nope' }))
  })

  it('titles each route from the section list', () => {
    expect(titleForRoute(AppRoute.Home())).toBe('oru')
    expect(titleForRoute(AppRoute.Thread({ threadId: 'shell-retro' }))).toBe('Thread | oru')
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
          projects: [{ id: 'p1', name: 'oru', cwd: '/tmp/oru' }],
        }),
      }),
    ).model

    Scene.scene(
      { update, view },
      Scene.given(listed),
      Scene.expect(Scene.selector('[data-settings-page="projects"]')).toExist(),
      Scene.expect(Scene.selector('[data-projects-row="p1"]')).toContainText('oru'),
      Scene.expect(Scene.selector('[data-projects-row="p1"]')).toContainText('/tmp/oru'),
      Scene.click(Scene.selector('[data-projects-edit="p1"]')),
      Scene.expect(Scene.selector('#settings-project-name')).toHaveValue('oru'),
      Scene.type(Scene.selector('#settings-project-name'), 'oru-app'),
      Scene.click(Scene.selector('[data-projects-save="p1"]')),
      Scene.Command.expectHas(UpdateProject),
      Scene.Command.resolve(
        UpdateProject,
        Message.GotProjects({
          message: Projects.Message.ProjectUpdated({
            project: { id: 'p1', name: 'oru-app', cwd: '/tmp/oru' },
          }),
        }),
      ),
      Scene.expect(Scene.selector('[data-projects-row="p1"]')).toContainText('oru-app'),
      Scene.expect(Scene.selector('[data-projects-edit-form="p1"]')).not.toExist(),
    )
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
            { id: 'p1', name: 'oru', cwd: '/tmp/oru' },
            { id: 'p2', name: 'bb', cwd: '/tmp/bb' },
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
          project: { id: 'p1', name: 'oru-app', cwd: '/tmp/oru' },
        }),
      }),
    ).model
    expect(answered.projects.edit).toBeUndefined()
    expect(answered.projects.host).toEqual(
      Projects.Loaded.make({
        projects: [
          { id: 'p1', name: 'oru-app', cwd: '/tmp/oru' },
          { id: 'p2', name: 'bb', cwd: '/tmp/bb' },
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
