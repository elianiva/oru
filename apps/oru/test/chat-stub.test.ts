import { describe, it } from 'vitest'
import { HashMap } from 'effect'
import * as Scene from 'foldkit/scene'
import { update, view, init } from '../src/root.ts'

describe('chat stub', () => {
  const idle = { ...init().model, panels: HashMap.empty(), thread: undefined }

  it('shows the fixture rail, thread, and info pane', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.expect(Scene.text('New thread')).toExist(),
      Scene.expect(Scene.text('Extensions')).toExist(),
      Scene.expect(Scene.text('Wire foldcn chrome')).toExist(),
      Scene.expect(Scene.text('Kernel host replay')).toExist(),
      Scene.expect(Scene.text('4 children')).toExist(),
      Scene.expect(Scene.text('Full Access')).toExist(),
      Scene.expect(Scene.text('Checks failing')).toExist(),
      Scene.expect(
        Scene.text(
          'no, like make the whole chat app with all components, just as a stub for now, no need to wire things up',
        ),
      ).toExist(),
    )
  })
})
