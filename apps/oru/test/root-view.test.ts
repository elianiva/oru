import { describe, expect, it } from 'vitest'
import { HashMap } from 'effect'
import * as Scene from 'foldkit/scene'
import { Message, update, view } from '../src/root.ts'
import * as PluginPanel from '../src/plugin-panel.ts'

describe('root view', () => {
  const bothPanels = HashMap.fromIterable([
    ['logging', PluginPanel.init({ title: 'Log' })],
    ['greeter', PluginPanel.init({ title: 'Greet' })],
  ])

  it('drops the consumer panel when the graph no longer lists it', () => {
    Scene.scene(
      { update, view },
      Scene.given({ panels: bothPanels }),
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
      Scene.given({ panels: bothPanels }),
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
      { panels: bothPanels },
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
      Scene.given({ panels: bothPanels }),
      Scene.click(Scene.text('Greet')),
      Scene.expect(Scene.text('acked')).toExist(),
      Scene.expect(Scene.text('Greet')).toExist(),
    )
  })
})
