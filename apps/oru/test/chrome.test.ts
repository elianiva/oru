import { describe, expect, it } from 'vitest'
import * as Scene from 'foldkit/scene'
import { Message, init, update, view } from '../src/root.ts'
import * as Composer from '../src/composer.ts'

describe('chrome', () => {
  it('renders the sidebar nav and the main pane', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(Scene.text('oru')).toExist(),
      Scene.expect(Scene.text('Threads')).toExist(),
      Scene.expect(Scene.text('Projects')).toExist(),
      Scene.expect(Scene.text('Settings')).toExist(),
      Scene.expect(Scene.selector('[data-main]')).toExist(),
    )
  })

  it('toggles the sidebar from the header trigger', () => {
    const { model } = init()
    expect(model.sidebar.isOpen).toBe(true)
    Scene.scene(
      { update, view },
      Scene.given(model),
      Scene.click(Scene.selector('[data-slot="sidebar-trigger"]')),
      Scene.expect(Scene.selector('[data-slot="sidebar"][data-state="collapsed"]')).toExist(),
    )
  })
})

describe('composer', () => {
  it('renders centered with headline, input, actions, and context chips', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.expect(Scene.selector('[data-composer]')).toExist(),
      Scene.expect(Scene.text('What should we build in oru?')).toExist(),
      Scene.expect(Scene.selector('[data-composer-input]')).toExist(),
      Scene.expect(Scene.selector('[data-composer-submit]')).toExist(),
      Scene.expect(Scene.text('Medium')).toExist(),
      Scene.expect(Scene.text('oru')).toExist(),
      Scene.expect(Scene.text('Worktree')).toExist(),
      Scene.expect(Scene.text('Branch from: origin/master')).toExist(),
      Scene.expect(Scene.text('Full Access')).toExist(),
    )
  })

  it('submits a draft through the root loop, clearing the box', () => {
    const typed = update(
      init().model,
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
        chips: [{ id: 'repo', label: 'oru' }],
      },
    )
    expect(merged.placeholder).toBe('Ask anything')
    expect(merged.headline).toBe('Build something')
    expect(merged.leading).toHaveLength(1)
    expect(merged.chips).toHaveLength(1)
  })
})
