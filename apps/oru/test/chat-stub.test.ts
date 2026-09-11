import { describe, it } from 'vitest'
import { HashMap } from 'effect'
import * as Scene from 'foldkit/scene'
import { update, view } from '../src/root.ts'

describe('chat stub', () => {
  const idle = { panels: HashMap.empty(), thread: undefined }

  it('shows the fixture rail, thread, and info pane', () => {
    Scene.scene(
      { update, view },
      Scene.given(idle),
      Scene.expect(Scene.text('New thread')).toExist(),
      Scene.expect(Scene.text('Wire foldcn chrome')).toExist(),
      Scene.expect(Scene.text('Kernel host replay')).toExist(),
      Scene.expect(Scene.text('Send')).toExist(),
      Scene.expect(Scene.text('Info')).toExist(),
      Scene.expect(
        Scene.text('Make the host look like a basic bb chrome, light mode, foldcn only.'),
      ).toExist(),
    )
  })
})
