import { Predicate } from 'effect'
import { describe, expect, it } from 'vitest'
import { ComposerOptionsLoaded, ComposerOptionsLoading, type ComposerProps } from '@oru/ui'
import type { ThreadOptions } from '@oru/rpc'
import * as Composer from './composer.ts'
import * as ComposerArea from './composer-area.ts'

const project = { id: 'p1', name: 'P', cwd: '/tmp' }

const propsOf = (projects: ComposerProps['projects']): ComposerProps => ({
  placeholder: 'Ask anything',
  projects,
  projectsLoading: false,
  options: ComposerOptionsLoading.make({}),
})

describe('composer-area', () => {
  it('emits the submit intent with the picked project and the text', () => {
    const init = ComposerArea.absorbProps(ComposerArea.init(), propsOf([project]))
    const drafted = ComposerArea.update(
      init,
      ComposerArea.Message.GotComposer({ message: Composer.Message.ChangedDraft({ value: 'hi' }) }),
    )
    const submitted = ComposerArea.update(
      drafted.model,
      ComposerArea.Message.GotComposer({ message: Composer.Message.ClickedSubmit() }),
    )
    if (
      submitted.outMessage === undefined ||
      !Predicate.isTagged(submitted.outMessage, 'Submitted')
    ) {
      expect.fail('expected a Submitted out-message')
    }
    expect(submitted.outMessage.text).toBe('hi')
    // The raw selection travels; root applies the list fallback.
    expect(submitted.outMessage.project).toBeUndefined()
  })

  it('selects a project added after mount, the way a creation did', () => {
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), propsOf([project]))
    expect(mounted.projectPicker.selected).toBeUndefined()
    const added = ComposerArea.absorbProps(
      mounted,
      propsOf([project, { id: 'p2', name: 'Q', cwd: '/tmp' }]),
    )
    expect(added.projectPicker.selected).toBe('p2')
  })

  it('folds a catalogue that beat the bundle to mount', () => {
    const options: ThreadOptions = {
      config: { harness: 'pi', model: 'deepseek/deepseek-pro', reasoning: 'off' },
      harness: 'pi',
      harnesses: [{ id: 'pi', label: 'pi', icon: 'terminal', health: { status: 'ready' } }],
      providers: [],
      models: [{ id: 'deepseek/deepseek-pro', label: 'DeepSeek Pro', provider: 'deepseek' }],
    }
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), {
      ...propsOf([project]),
      options: ComposerOptionsLoaded.make({ options }),
    })
    expect(mounted.picker.selection?.model).toBe('deepseek/deepseek-pro')
  })

  it('restores a draft root refused to send', () => {
    const init = ComposerArea.absorbProps(ComposerArea.init(), propsOf([project]))
    const drafted = ComposerArea.update(
      init,
      ComposerArea.Message.GotComposer({ message: Composer.Message.ChangedDraft({ value: 'hi' }) }),
    )
    const submitted = ComposerArea.update(
      drafted.model,
      ComposerArea.Message.GotComposer({ message: Composer.Message.ClickedSubmit() }),
    )
    expect(submitted.model.composer.draft).toBe('')
    const restored = ComposerArea.signal(submitted.model, {
      type: 'restore-draft',
      text: 'hi',
    })
    expect(restored.composer.draft).toBe('hi')
  })

  it('returns the identical model when props carry nothing new', () => {
    const props = propsOf([project])
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), props)
    expect(ComposerArea.absorbProps(mounted, props)).toBe(mounted)
  })
})
