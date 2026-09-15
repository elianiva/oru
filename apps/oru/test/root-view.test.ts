import { describe, expect, it } from 'vitest'
import { HashMap } from 'effect'
import * as Scene from 'foldkit/scene'
import {
  CreateThread,
  ListProjects,
  Message,
  RefreshThreadOptions,
  SetLogging,
  update,
  view,
  init,
} from '../src/root.ts'
import * as PluginPanel from '../src/plugin-panel.ts'
import { LiveSettled, LiveToolStart } from '@oru/rpc'
import * as ThreadPanel from '../src/thread-panel.ts'
import {
  AssistantLine,
  FailedLine,
  ToolCompletedLine,
  ToolRequestedLine,
  TurnLine,
  UserLine,
} from '../src/transcript.ts'

const demoProject = { id: 'p1', name: 'demo', cwd: '/tmp/demo' }

const emptyOptions = (threadId: string) => ({
  threadId,
  project: demoProject,
  options: {
    config: { harness: undefined, model: undefined, reasoning: undefined },
    harnesses: [],
    models: [],
  },
})

const idleThread = () => ({
  ...ThreadPanel.init(),
  projects: [demoProject],
  selected: demoProject.id,
  project: demoProject,
})

describe('root view', () => {
  const bothPanels = HashMap.fromIterable([
    ['logging', PluginPanel.init('Log')],
    ['greeter', PluginPanel.init('Greet')],
  ])
  const idle = { ...init().model, panels: bothPanels, thread: undefined }

  it('drops the consumer panel when the graph no longer lists it', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.expect(Scene.text('Greet')).toExist(),
      Scene.expect(Scene.text('Log')).toExist(),
      Scene.Subscription.emit(
        Message.GraphArrived({
          graph: { active: [{ plugin: 'logging', title: 'Log' }], tokens: [], agent: false },
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
            tokens: [],
            agent: false,
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
          tokens: [],
          agent: false,
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

  it('opens a thread panel when the host has an agent loop', () => {
    const next = update(
      idle,
      Message.GraphArrived({
        graph: {
          active: [
            { plugin: 'logging', title: 'Log' },
            { plugin: 'engines/stub', title: 'engines/stub' },
          ],
          tokens: [],
          agent: true,
        },
      }),
    )
    expect(next.model.thread).toEqual(ThreadPanel.init())
    expect('commands' in next ? next.commands : undefined).toHaveLength(1)
  })

  it('does not open a thread panel when no agent loop is live', () => {
    const next = update(
      idle,
      Message.GraphArrived({
        graph: {
          active: [{ plugin: 'oru/inference', title: 'oru/inference' }],
          tokens: [],
          agent: false,
        },
      }),
    )
    expect(next.model.thread).toBeUndefined()
  })

  it('shows a turn and a tool call on the thread panel', () => {
    const thread = {
      ...idleThread(),
      threadId: 't1',
      draft: '',
      lines: [
        UserLine.make({ body: 'hello' }),
        TurnLine.make({}),
        ToolRequestedLine.make({ name: 'echo' }),
        ToolCompletedLine.make({ name: 'echo' }),
        AssistantLine.make({ body: 'done' }),
      ],
      live: [],
      config: { harness: undefined, model: undefined, reasoning: undefined },
      harnesses: [],
      models: [],
    }
    Scene.scene(
      { update, view },
      Scene.given({ ...init().model, panels: bothPanels, thread }),
      Scene.expect(Scene.text('user: hello')).toExist(),
      Scene.expect(Scene.text('turn/started')).toExist(),
      Scene.expect(Scene.text('tool/requested echo')).toExist(),
      Scene.expect(Scene.text('tool/completed echo')).toExist(),
      Scene.expect(Scene.text('assistant: done')).toExist(),
    )
  })

  it('lists the services the graph provides', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.Subscription.emit(
        Message.GraphArrived({
          graph: {
            active: [{ plugin: 'logging', title: 'Log' }],
            tokens: ['oru/logger', 'oru/harnesses'],
            agent: false,
          },
        }),
      ),
      Scene.expect(Scene.text('Services')).toExist(),
      Scene.expect(Scene.text('oru/logger')).toExist(),
      Scene.expect(Scene.text('oru/harnesses')).toExist(),
    )
  })

  it('drops the consumer panel and the provider token when logging goes off', () => {
    Scene.scene(
      { update, view },
      Scene.given({ ...idle, tokens: ['oru/logger'] }),
      Scene.expect(Scene.text('Greet')).toExist(),
      Scene.expect(Scene.text('oru/logger')).toExist(),
      Scene.click(Scene.selector('[data-logging-toggle]')),
      Scene.Command.resolve(
        SetLogging,
        Message.GraphArrived({ graph: { active: [], tokens: [], agent: false } }),
      ),
      Scene.expect(Scene.text('Greet')).not.toExist(),
      Scene.expect(Scene.text('oru/logger')).not.toExist(),
    )
  })

  it('opens a thread from the rail header', () => {
    Scene.scene(
      { update, view },
      Scene.given({ ...idle, thread: idleThread() }),
      Scene.expect(Scene.selector('[data-thread-panel]')).toExist(),
      Scene.click(Scene.text('New thread')),
      Scene.Command.resolve(
        CreateThread,
        Message.GotThreadMessage({
          message: ThreadPanel.Message.Opened(emptyOptions('t1')),
        }),
      ),
      Scene.expect(Scene.selector('[data-thread-panel]')).toExist(),
      Scene.expect(Scene.selector('[data-thread-project]')).toExist(),
      Scene.expect(Scene.text('demo')).toExist(),
    )
  })

  it('lists projects in the thread pane', () => {
    Scene.scene(
      { update, view },
      Scene.given({ ...idle, thread: undefined }),
      Scene.click(Scene.text('New thread')),
      Scene.Command.resolve(
        ListProjects,
        Message.GotThreadMessage({
          message: ThreadPanel.Message.ProjectsArrived({ projects: [demoProject] }),
        }),
      ),
      Scene.expect(Scene.selector('[data-project-select]')).toExist(),
      Scene.expect(Scene.text('demo (/tmp/demo)')).toExist(),
    )
  })

  it('clears the live stream when the turn settles', () => {
    Scene.scene(
      { update, view },
      Scene.given({
        ...idle,
        thread: {
          ...ThreadPanel.init(),
          threadId: 't1',
          live: [LiveToolStart.make({ name: 'echo' })],
        },
      }),
      Scene.expect(Scene.text('tool echo running')).toExist(),
      Scene.Subscription.emit(
        Message.GotThreadMessage({
          message: ThreadPanel.Message.SignalArrived({ signal: LiveSettled.make({}) }),
        }),
      ),
      Scene.expect(Scene.text('tool echo running')).not.toExist(),
    )
  })

  it('shows a failed turn in the transcript', () => {
    const thread = {
      threadId: 't1',
      draft: '',
      lines: [
        UserLine.make({ body: 'hello' }),
        TurnLine.make({}),
        FailedLine.make({ reason: 'provider down' }),
      ],
      live: [],
      config: { harness: undefined, model: undefined, reasoning: undefined },
      harnesses: [],
      models: [],
      projects: [demoProject],
      selected: demoProject.id,
      project: demoProject,
      newName: '',
      newCwd: '',
    }
    Scene.scene(
      { update, view },
      Scene.given({ ...init().model, panels: bothPanels, thread }),
      Scene.expect(Scene.text('turn/failed provider down')).toExist(),
    )
  })

  it('shows a not-ready harness status, message, and install command', () => {
    const installCommand = 'npm install -g @earendil-works/pi-coding-agent@latest'
    Scene.scene(
      { update, view },
      Scene.given({
        ...idle,
        thread: {
          ...ThreadPanel.init(),
          threadId: 't1',
          config: { harness: 'pi', model: undefined, reasoning: undefined },
          harnesses: [
            {
              id: 'pi',
              label: 'Pi',
              health: {
                status: 'not_installed',
                message: 'pi is not on PATH',
                installCommand,
              },
            },
          ],
        },
      }),
      Scene.expect(Scene.text('not_installed')).toExist(),
      Scene.expect(Scene.text('pi is not on PATH')).toExist(),
      Scene.expect(Scene.text(installCommand)).toExist(),
      Scene.expect(Scene.selector('[data-harness-install-command]')).toExist(),
      Scene.click(Scene.selector('[data-harness-recheck]')),
      Scene.Command.resolve(
        RefreshThreadOptions,
        Message.GotThreadMessage({
          message: ThreadPanel.Message.OptionsArrived({
            config: { harness: 'pi', model: undefined, reasoning: undefined },
            harnesses: [
              {
                id: 'pi',
                label: 'Pi',
                health: { status: 'ready' },
              },
            ],
            models: [],
          }),
        }),
      ),
      Scene.expect(Scene.text(installCommand)).not.toExist(),
      Scene.expect(Scene.selector('[data-harness-health]')).not.toExist(),
    )
  })
})
