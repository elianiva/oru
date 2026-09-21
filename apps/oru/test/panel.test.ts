import { Option, Predicate } from 'effect'
import { Url } from 'foldkit'
import * as Scene from 'foldkit/scene'
import { defineView } from 'foldkit/submodel'
import { describe, expect, it } from 'vitest'
import { UI_SDK_MAJOR, UiSnapshot, type PanelProps } from '@oru/ui'
import { resetDefsForTest, registerDef } from '../src/ui-defs.ts'
import { Message, init, update, view } from '../src/root.ts'

/** The cold-load URL for `/`: routing `init` parses its starting route from it. */
const homeUrl: Url.Url = {
  protocol: 'http:',
  host: 'localhost',
  port: Option.none(),
  pathname: '/',
  search: Option.none(),
  hash: Option.none(),
}

const terminalAddress = 'c'.repeat(64)
const terminalAddress2 = 'd'.repeat(64)

const panelSnapshot = UiSnapshot.make({
  assignments: [{ slot: 'panel', plugin: 'oru/terminal-ghostty', defId: 'terminal' }],
  bundles: [
    {
      plugin: 'oru/terminal-ghostty',
      defId: 'terminal',
      slot: 'panel',
      address: terminalAddress,
      jsUrl: `/ui/${terminalAddress}.js`,
      sdkMajor: UI_SDK_MAJOR,
    },
  ],
})

interface StubTerminalModel {
  sessions: Array<string>
}

const stubTerminalDef = (): void => {
  resetDefsForTest()
  registerDef('oru/terminal-ghostty', 'terminal', terminalAddress, {
    init: (): StubTerminalModel => ({ sessions: [] }),
    update: (model: { sessions: Array<string> }, message: { session?: string }) => ({
      model:
        message.session === undefined ? model : { sessions: [...model.sessions, message.session] },
    }),
    view: () => undefined,
  })
}

const panelSnapshot2 = UiSnapshot.make({
  assignments: [{ slot: 'panel', plugin: 'oru/terminal-ghostty', defId: 'terminal' }],
  bundles: [
    {
      plugin: 'oru/terminal-ghostty',
      defId: 'terminal',
      slot: 'panel',
      address: terminalAddress2,
      jsUrl: `/ui/${terminalAddress2}.js`,
      sdkMajor: UI_SDK_MAJOR,
    },
  ],
})

const urlForPath = (pathname: string): Url.Url => ({ ...homeUrl, pathname })

describe('the panel terminal tabs', () => {
  it('starts empty with the thread details showing', () => {
    const { model } = init(homeUrl)
    expect(model.panelTabs).toEqual([])
    expect(model.panelBundle).toBeUndefined()
    expect(model.panelCreating).toBe(false)
  })

  it('reconciles the panel bundle and loads its code once', () => {
    resetDefsForTest()
    const { model } = init(homeUrl)
    const first = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot }))
    expect(first.model.panelBundle?.address).toBe(terminalAddress)
    expect(first.commands ?? []).toHaveLength(1)

    // A repeated snapshot is a no-op.
    const second = update(first.model, Message.UiSnapshotArrived({ snapshot: panelSnapshot }))
    expect(second.commands ?? []).toHaveLength(0)
  })

  it('opens tabs as sessions arrive and closes them with cleanup', () => {
    resetDefsForTest()
    const { model } = init(homeUrl)
    const withBundle = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model

    const opened = update(
      withBundle,
      Message.PtySessionCreated({ sessionId: 's1', projectId: undefined, wsUrl: undefined }),
    ).model
    expect(opened.panelTabs.map((tab) => tab.sessionId)).toEqual(['s1'])
    expect(opened.panelActive).toBe('s1')
    expect(opened.panelTabs[0]?.title).toBe('Terminal 1')

    const second = update(
      opened,
      Message.PtySessionCreated({ sessionId: 's2', projectId: undefined, wsUrl: undefined }),
    ).model
    expect(second.panelTabs.map((tab) => tab.sessionId)).toEqual(['s1', 's2'])
    expect(second.panelActive).toBe('s2')

    const selected = update(second, Message.ClickedPanelTab({ sessionId: 's1' })).model
    expect(selected.panelActive).toBe('s1')

    const closed = update(selected, Message.ClickedClosePanelTab({ sessionId: 's1' }))
    expect(closed.model.panelTabs.map((tab) => tab.sessionId)).toEqual(['s2'])
    expect(closed.model.panelActive).toBe('s2')
    expect(closed.commands ?? []).toHaveLength(1)

    const emptied = update(closed.model, Message.ClickedClosePanelTab({ sessionId: 's2' }))
    expect(emptied.model.panelTabs).toEqual([])
    expect(emptied.model.panelActive).toBeUndefined()
  })

  it('mounts tab outlets when the bundle registers and folds child messages', () => {
    stubTerminalDef()
    const { model } = init(homeUrl)
    const withBundle = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model
    const opened = update(
      withBundle,
      Message.PtySessionCreated({ sessionId: 's1', projectId: undefined, wsUrl: undefined }),
    ).model
    // The def was registered, so the outlet mounted with the session absorbed.
    const ready = update(
      opened,
      Message.BundleReady({
        plugin: 'oru/terminal-ghostty',
        defId: 'terminal',
        slot: 'panel',
        address: terminalAddress,
      }),
    ).model
    expect(ready.panelOutlets['s1']?._tag).toBe('Ready')

    const folded = update(
      ready,
      Message.GotPanelUi({ sessionId: 's1', message: { session: 's1' } }),
    ).model
    const outlet = folded.panelOutlets['s1']
    expect(outlet?._tag).toBe('Ready')
    if (Predicate.isTagged(outlet, 'Ready')) {
      expect(outlet.childModel).toEqual({ sessions: ['s1'] })
    } else {
      expect.unreachable('terminal outlet should be ready')
    }
    resetDefsForTest()
  })

  it('reports a failed terminal bundle in the panel', () => {
    resetDefsForTest()
    const { model } = init(homeUrl)
    const withBundle = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model
    const failed = update(
      withBundle,
      Message.BundleFailed({
        plugin: 'oru/terminal-ghostty',
        defId: 'terminal',
        slot: 'panel',
        reason: 'no wasm',
      }),
    ).model
    expect(failed.panelError).toBe('terminal failed: no wasm')
  })

  it('carries the advertised ws url into the tab', () => {
    resetDefsForTest()
    const { model } = init(homeUrl)
    const opened = update(
      model,
      Message.PtySessionCreated({
        sessionId: 's1',
        projectId: 'p1',
        wsUrl: '/pty/s1',
      }),
    ).model
    expect(opened.panelTabs[0]).toMatchObject({ sessionId: 's1', wsUrl: '/pty/s1' })
  })

  it('remounts outlets fresh when the bundle generation changes', () => {
    stubTerminalDef()
    const { model } = init(homeUrl)
    const gen1 = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model
    const opened = update(
      gen1,
      Message.PtySessionCreated({ sessionId: 's1', projectId: undefined, wsUrl: undefined }),
    ).model
    const folded = update(
      opened,
      Message.GotPanelUi({ sessionId: 's1', message: { session: 's1' } }),
    ).model
    expect(folded.panelOutlets['s1']?._tag).toBe('Ready')

    // Generation two registers a new def: stale outlets drop, tabs remount.
    registerDef('oru/terminal-ghostty', 'terminal', terminalAddress2, {
      init: () => ({ generation: 2 }),
      update: (child: { generation: number }) => ({ model: child }),
      view: () => undefined,
    })
    const gen2 = update(folded, Message.UiSnapshotArrived({ snapshot: panelSnapshot2 }))
    expect(gen2.model.panelBundle?.address).toBe(terminalAddress2)
    expect(gen2.commands ?? []).toHaveLength(0)
    const outlet = gen2.model.panelOutlets['s1']
    expect(outlet?._tag).toBe('Ready')
    expect(outlet).toMatchObject({ address: terminalAddress2 })
    if (Predicate.isTagged(outlet, 'Ready')) {
      expect(outlet.childModel).toEqual({ generation: 2 })
    } else {
      expect.unreachable('terminal outlet should be ready')
    }
    resetDefsForTest()
  })

  it('keeps every open tab mounted with inactives hidden', () => {
    resetDefsForTest()
    const stubMarkerView = defineView<Record<string, never>, never, PanelProps>(
      (_model, props, h) => h.div([h.DataAttribute('stub-terminal', props.sessionId)], []),
    )
    registerDef('oru/terminal-ghostty', 'terminal', terminalAddress, {
      init: () => ({}),
      update: (child: Record<string, never>) => ({ model: child }),
      view: stubMarkerView,
    })
    const { model } = init(homeUrl)
    const withBundle = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model
    const first = update(
      withBundle,
      Message.PtySessionCreated({ sessionId: 's1', projectId: undefined, wsUrl: undefined }),
    ).model
    const second = update(
      first,
      Message.PtySessionCreated({ sessionId: 's2', projectId: undefined, wsUrl: undefined }),
    ).model
    Scene.scene(
      { update, view },
      Scene.given(second),
      Scene.expectAll(Scene.all.selector('[data-stub-terminal]')).toHaveCount(2),
      Scene.expect(Scene.selector('[data-panel-tab-body="s1"]')).toHaveAttr(
        'class',
        'hidden h-full min-h-0',
      ),
      Scene.expect(Scene.selector('[data-panel-tab-body="s2"]')).toHaveAttr(
        'class',
        'h-full min-h-0',
      ),
    )
    resetDefsForTest()
  })

  it('surfaces close failures instead of swallowing them', () => {
    resetDefsForTest()
    const { model } = init(homeUrl)
    const failed = update(
      model,
      Message.PtySessionCloseFailed({ reason: 'close failed (500)' }),
    ).model
    expect(failed.panelError).toBe('close failed (500)')
  })

  it('re-absorbs props when the thread changes', () => {
    resetDefsForTest()
    interface ThreadHolding {
      thread: string | undefined
    }
    registerDef('oru/terminal-ghostty', 'terminal', terminalAddress, {
      init: (): ThreadHolding => ({ thread: undefined }),
      update: (child: ThreadHolding) => ({ model: child }),
      absorb: (_child: ThreadHolding, props: { threadId?: string | undefined }) => ({
        thread: props.threadId,
      }),
      view: () => undefined,
    })
    const { model } = init(urlForPath('/thread/thread-1'))
    const withBundle = update(model, Message.UiSnapshotArrived({ snapshot: panelSnapshot })).model
    const opened = update(
      withBundle,
      Message.PtySessionCreated({ sessionId: 's1', projectId: undefined, wsUrl: undefined }),
    ).model
    const outlet = opened.panelOutlets['s1']
    if (Predicate.isTagged(outlet, 'Ready')) {
      expect(outlet.childModel).toEqual({ thread: 'thread-1' })
    } else {
      expect.unreachable('terminal outlet should be ready')
    }
    const moved = update(opened, Message.ChangedUrl({ url: urlForPath('/thread/thread-2') })).model
    const resynced = moved.panelOutlets['s1']
    if (Predicate.isTagged(resynced, 'Ready')) {
      expect(resynced.childModel).toEqual({ thread: 'thread-2' })
    } else {
      expect.unreachable('terminal outlet should be ready')
    }
    resetDefsForTest()
  })
})
