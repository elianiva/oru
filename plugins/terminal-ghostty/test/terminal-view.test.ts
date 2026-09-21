import { describe, expect, it } from 'vitest'
import type { HtmlBuilder } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import type { PanelProps } from '@oru/ui'
import { absorbProps, init, update, view, Message, type Model } from '../src/terminal.ts'

/**
 * The view contract the element depends on: literal `ws-url` /
 * `session-id` attributes (the element reads and observes exactly those;
 * `data-*` or JS properties never reach it). Rendered headlessly through
 * the real view — no DOM needed.
 */

const props: PanelProps = {
  sessionId: 's1',
  projectId: 'p1',
  threadId: 't1',
  title: 'Terminal 1',
  wsUrl: 'ws://test-host/pty/s1',
}

const sceneView = () => ({
  update,
  view: (current: Model, h: HtmlBuilder<Message>) => view(current, props, h),
})

describe('the terminal view', () => {
  it('renders literal ws-url and session-id attributes', () => {
    Scene.scene(
      sceneView(),
      Scene.given(absorbProps(init(), props)),
      Scene.expect(Scene.selector('[ws-url="ws://test-host/pty/s1"]')).toExist(),
      Scene.expect(Scene.selector('[session-id="s1"]')).toExist(),
      Scene.expectAll(Scene.all.selector('[data-ws-url]')).toHaveCount(0),
    )
  })

  it('prefers the advertised url and derives one only as a fallback', () => {
    expect(absorbProps(init(), props)).toEqual({ sessionId: 's1', wsUrl: 'ws://test-host/pty/s1' })
    // No advertised url and no `location` in node: nothing to connect to.
    expect(absorbProps(init(), { ...props, wsUrl: undefined }).wsUrl).toBeUndefined()
  })

  it('renders a placeholder with no session', () => {
    const empty: PanelProps = { ...props, sessionId: '' }
    Scene.scene(
      {
        update,
        view: (current: Model, h: HtmlBuilder<Message>) => view(current, empty, h),
      },
      Scene.given(init()),
      Scene.expectAll(Scene.all.selector('[data-terminal-tab]')).toHaveCount(0),
    )
  })

  it('keeps absorbed state across updates', () => {
    const mounted = absorbProps(init(), props)
    const advanced = update(mounted, Message.Noop())
    expect(advanced.model).toEqual(mounted)
  })
})
