import { describe, it } from 'vitest'
import * as Scene from 'foldkit/scene'
import { Message, update, view } from '../src/root.ts'

describe('root view', () => {
  it('drops the consumer panel when the graph no longer lists it', () => {
    Scene.scene(
      { update, view },
      Scene.given({
        panels: [
          { plugin: 'logging', title: 'Log' },
          { plugin: 'greeter', title: 'Greet' },
        ],
      }),
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
})
