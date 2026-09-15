import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as Scene from 'foldkit/scene'
import { init, update, view } from '../src/root.ts'

const entrySource = readFileSync(new URL('../src/entry.ts', import.meta.url), 'utf8')

describe('shipped view', () => {
  it('the page entry imports view from root.ts', () => {
    expect(entrySource).toMatch(/import \{[^}]*\bview\b[^}]*\} from '\.\/root\.ts'/u)
  })

  it('the shipped view is the live graph, not a chat stub', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(Scene.selector('[data-logging-toggle]')).toExist(),
      Scene.expect(Scene.text('Turn logging on')).toExist(),
      Scene.expect(Scene.text('chat stub')).not.toExist(),
    )
  })
})
