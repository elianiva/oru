import { Predicate } from 'effect'
import { describe, expect, it } from 'vitest'
import { ComposerOptionsLoaded, ComposerOptionsLoading, type ComposerProps } from '@oru/ui'
import type { ThreadOptions } from '@oru/rpc'
import * as Composer from './composer.ts'
import * as ComposerArea from './composer-area.ts'
import * as ProjectPicker from './project-picker.ts'
import * as WorkspacePicker from './workspace-picker.ts'

const project = { id: 'p1', name: 'P', cwd: '/tmp' }

const propsOf = (projects: ComposerProps['projects']): ComposerProps => ({
  placeholder: 'Ask anything',
  projects,
  projectsLoading: false,
  options: ComposerOptionsLoading.make({}),
  workspaces: [],
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

  it('points an undecided composer at Personal and carries its id', () => {
    const personal = { id: 'personal', name: 'Personal', cwd: '/tmp/personal' }
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), propsOf([personal]))
    expect(mounted.projectPicker.selected).toBe('personal')
    const drafted = ComposerArea.update(
      mounted,
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
    expect(submitted.outMessage.project).toBe('personal')
  })

  it('keeps an explicit pick over Personal', () => {
    const personal = { id: 'personal', name: 'Personal', cwd: '/tmp/personal' }
    const other = { id: 'p1', name: 'P', cwd: '/tmp' }
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), propsOf([personal, other]))
    expect(mounted.projectPicker.selected).toBe('personal')
    const picked = ComposerArea.update(
      mounted,
      ComposerArea.Message.GotProjectPicker({
        message: ProjectPicker.Message.SelectedOption({ option: 'p1' }),
      }),
    )
    expect(picked.model.projectPicker.selected).toBe('p1')
    const settled = ComposerArea.absorbProps(picked.model, propsOf([personal, other]))
    expect(settled.projectPicker.selected).toBe('p1')
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

  it('carries the selected workspace path into the submit intent as cwd', () => {
    const workspaces = [
      {
        path: '/tmp/oru/workspaces/one',
        branch: undefined,
        isCurrent: false,
        provider: 'worktree',
      },
    ]
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), {
      ...propsOf([project]),
      workspaces,
    })
    const picked = ComposerArea.update(
      mounted,
      ComposerArea.Message.GotWorkspace({
        message: WorkspacePicker.Message.SelectedOption({ option: '/tmp/oru/workspaces/one' }),
      }),
    )
    const drafted = ComposerArea.update(
      picked.model,
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
    expect(submitted.outMessage.cwd).toBe('/tmp/oru/workspaces/one')
  })

  it('leaves cwd absent when the current workspace stays selected', () => {
    const mounted = ComposerArea.absorbProps(ComposerArea.init(), propsOf([project]))
    const drafted = ComposerArea.update(
      mounted,
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
    expect(submitted.outMessage.cwd).toBeUndefined()
  })
})
