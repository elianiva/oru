import { describe, expect, it } from 'vitest'
import { HashMap } from 'effect'
import * as Scene from 'foldkit/scene'
import { CreateThread, Message, update, wiredView as view } from '../src/root.ts'
import * as PluginPanel from '../src/plugin-panel.ts'
import * as ThreadPanel from '../src/thread-panel.ts'
import {
  AssistantLine,
  ToolCompletedLine,
  ToolRequestedLine,
  TurnLine,
  UserLine,
} from '../src/transcript.ts'

describe('root view', () => {
  const bothPanels = HashMap.fromIterable([
    ['logging', PluginPanel.init({ title: 'Log' })],
    ['greeter', PluginPanel.init({ title: 'Greet' })],
  ])
  const idle = { panels: bothPanels, thread: undefined }

  it('drops the consumer panel when the graph no longer lists it', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.expect(Scene.text('Greet')).toExist(),
      Scene.expect(Scene.text('Log')).toExist(),
      Scene.Subscription.emit(
        Message.GraphArrived({
          graph: { active: [{ plugin: 'logging', title: 'Log' }] },
        }),
      ),
      Scene.expect(Scene.text('Greet')).not.toExist(),
      Scene.expect(Scene.text('Log')).toExist(),
    )
  })

  it('keeps both panels when the graph still lists them', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.Subscription.emit(
        Message.GraphArrived({
          graph: {
            active: [
              { plugin: 'logging', title: 'Log' },
              { plugin: 'greeter', title: 'Greet' },
            ],
          },
        }),
      ),
      Scene.expect(Scene.text('Greet')).toExist(),
      Scene.expect(Scene.text('Log')).toExist(),
    )
  })

  it('keeps the same child model when the graph still lists the plugin', () => {
    const previous = HashMap.getUnsafe(bothPanels, 'logging')
    const { model } = update(
      idle,
      Message.GraphArrived({
        graph: {
          active: [
            { plugin: 'logging', title: 'Log' },
            { plugin: 'greeter', title: 'Greet' },
          ],
        },
      }),
    )
    expect(HashMap.getUnsafe(model.panels, 'logging')).toBe(previous)
    expect(HashMap.getUnsafe(model.panels, 'greeter')).toBe(
      HashMap.getUnsafe(bothPanels, 'greeter'),
    )
  })

  it('folds a child click into the same update loop', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.click(Scene.text('Greet')),
      Scene.expect(Scene.text('acked')).toExist(),
      Scene.expect(Scene.text('Greet')).toExist(),
    )
  })

  it('opens a thread panel when inference becomes active', () => {
    const next = update(
      idle,
      Message.GraphArrived({
        graph: {
          active: [
            { plugin: 'logging', title: 'Log' },
            { plugin: 'oru/inference', title: 'oru/inference' },
          ],
        },
      }),
    )
    expect(next.model.thread).toEqual(ThreadPanel.init())
    expect('commands' in next ? next.commands : undefined).toHaveLength(1)
  })

  it('shows a turn and a tool call on the thread panel', () => {
    const thread = {
      threadId: 't1',
      draft: '',
      lines: [
        UserLine.make({ body: 'hello' }),
        TurnLine.make({}),
        ToolRequestedLine.make({ name: 'echo' }),
        ToolCompletedLine.make({ name: 'echo' }),
        AssistantLine.make({ body: 'done' }),
      ],
    }
    Scene.scene(
      { update, view },
      Scene.given({ panels: bothPanels, thread }),
      Scene.expect(Scene.text('user: hello')).toExist(),
      Scene.expect(Scene.text('turn/started')).toExist(),
      Scene.expect(Scene.text('tool/requested echo')).toExist(),
      Scene.expect(Scene.text('tool/completed echo')).toExist(),
      Scene.expect(Scene.text('assistant: done')).toExist(),
    )
  })

  it('does not mount a title panel for plugins without ui', () => {
    Scene.scene(
      { update, view },
      Scene.given({ panels: HashMap.empty(), thread: undefined }),
      Scene.Subscription.emit(
        Message.GraphArrived({
          graph: {
            active: [
              { plugin: 'model/fake', title: 'model/fake' },
              { plugin: 'oru/inference', title: 'oru/inference' },
            ],
          },
        }),
      ),
      Scene.Command.resolve(
        CreateThread,
        Message.GotThreadMessage({
          message: ThreadPanel.Message.Opened({ threadId: 't1' }),
        }),
      ),
      Scene.expect(Scene.text('model/fake')).not.toExist(),
      Scene.expect(Scene.text('Send')).toExist(),
    )
  })
})
