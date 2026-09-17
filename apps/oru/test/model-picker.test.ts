import { describe, expect, it } from 'vitest'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import type { HarnessHealth, ModelInfo } from '@oru/harness'
import type { ThreadOptions } from '@oru/rpc'
import * as ModelPicker from '../src/model-picker.ts'

const catalogue: ReadonlyArray<ModelInfo> = [
  {
    id: 'deepseek/deepseek-flash',
    label: 'DeepSeek Flash',
    provider: 'deepseek',
    reasoningLevels: ['off', 'low', 'high', 'max'],
  },
  { id: 'deepseek/deepseek-pro', label: 'DeepSeek Pro', provider: 'deepseek' },
  {
    id: 'github-copilot/gpt-5',
    label: 'Copilot Five',
    provider: 'github-copilot',
    isDefault: true,
  },
  { id: 'openrouter/x' },
]

/**
 * Scene refuses a view that returns null, and "the picker renders nothing" is
 * exactly that. The app's own test renders the root view, where the absence of
 * `[data-model-picker]` is the real assertion.
 */
const pickerView = (model: ModelPicker.Model, h: HtmlBuilder<ModelPicker.Message>): Html =>
  ModelPicker.view(model, h) ?? h.div([], [])

type Config = ThreadOptions['config']

const ready: HarnessHealth = { status: 'ready' }

const notInstalled: HarnessHealth = {
  status: 'not_installed',
  message: 'pi is not on PATH',
  installCommand: 'pi update self',
}

const unconfigured: Config = { harness: 'pi', model: undefined, reasoning: undefined }

const optionsFor = (health: HarnessHealth, config: Config): ThreadOptions => ({
  config,
  harness: 'pi',
  harnesses: [{ id: 'pi', label: 'pi', health }],
  models: catalogue,
})

const loaded = (health: HarnessHealth = ready, config: Config = unconfigured): ModelPicker.Model =>
  ModelPicker.update(
    ModelPicker.init(),
    ModelPicker.Message.OptionsArrived({ options: optionsFor(health, config) }),
  ).model

const opened = (health: HarnessHealth = ready, config: Config = unconfigured): ModelPicker.Model =>
  ModelPicker.update(loaded(health, config), ModelPicker.Message.Opened()).model

const flash: Config = { harness: 'pi', model: 'deepseek/deepseek-flash', reasoning: 'low' }

describe('the catalogue', () => {
  it('matches a model by its id and by its label', () => {
    expect(ModelPicker.matchingModels(catalogue, 'deepseek').map((model) => model.id)).toEqual([
      'deepseek/deepseek-flash',
      'deepseek/deepseek-pro',
    ])
    expect(ModelPicker.matchingModels(catalogue, 'FIVE').map((model) => model.id)).toEqual([
      'github-copilot/gpt-5',
    ])
    expect(ModelPicker.matchingModels(catalogue, '   ')).toHaveLength(4)
    expect(ModelPicker.matchingModels(catalogue, 'nothing')).toHaveLength(0)
  })

  it('groups by provider, in the order each provider first appears', () => {
    const groups = ModelPicker.groupByProvider(catalogue)
    expect(groups.map((group) => group.provider)).toEqual(['deepseek', 'github-copilot', 'unknown'])
    expect(groups.map((group) => group.models.map((model) => model.id))).toEqual([
      ['deepseek/deepseek-flash', 'deepseek/deepseek-pro'],
      ['github-copilot/gpt-5'],
      ['openrouter/x'],
    ])
  })

  it('reads the effective model from the chosen one, then the default, then the first', () => {
    expect(ModelPicker.effectiveModel(catalogue, unconfigured)?.id).toBe('github-copilot/gpt-5')
    expect(ModelPicker.effectiveModel(catalogue, flash)?.id).toBe('deepseek/deepseek-flash')
    expect(
      ModelPicker.effectiveModel([{ id: 'only/one', provider: 'only' }], unconfigured)?.id,
    ).toBe('only/one')
  })
})

describe('the panel', () => {
  it('narrows the rows as the query changes, and says so when nothing matches', () => {
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(opened()),
      Scene.expectAll(Scene.all.selector('[data-model-row]')).toHaveCount(4),
      Scene.type(Scene.selector('[data-model-search]'), 'deepseek'),
      Scene.expectAll(Scene.all.selector('[data-model-row]')).toHaveCount(2),
      Scene.expect(Scene.selector('[data-model-row="deepseek/deepseek-pro"]')).toExist(),
      Scene.expect(Scene.selector('[data-model-row="github-copilot/gpt-5"]')).not.toExist(),
      Scene.type(Scene.selector('[data-model-search]'), 'nothing'),
      Scene.expectAll(Scene.all.selector('[data-model-row]')).toHaveCount(0),
      Scene.expect(Scene.selector('[data-model-empty]')).toContainText('No model matches'),
    )
  })

  it('renders a header per provider with its own rows under it', () => {
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(opened()),
      Scene.expect(Scene.selector('[data-model-group-header="deepseek"]')).toHaveText('deepseek'),
      Scene.expect(Scene.selector('[data-model-group-header="github-copilot"]')).toHaveText(
        'github-copilot',
      ),
      Scene.expect(Scene.selector('[data-model-group-header="unknown"]')).toHaveText('unknown'),
      Scene.expect(
        Scene.selector('[data-model-group="deepseek"] [data-model-row="deepseek/deepseek-flash"]'),
      ).toExist(),
      Scene.expect(
        Scene.selector(
          '[data-model-group="github-copilot"] [data-model-row="deepseek/deepseek-flash"]',
        ),
      ).not.toExist(),
      Scene.expect(
        Scene.selector('[data-model-group="unknown"] [data-model-row="openrouter/x"]'),
      ).toExist(),
    )
  })

  it('marks the harness default and the chosen row', () => {
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(
        opened(ready, {
          harness: 'pi',
          model: 'deepseek/deepseek-pro',
          reasoning: undefined,
        }),
      ),
      Scene.expect(Scene.selector('[data-model-row="github-copilot/gpt-5"]')).toContainText(
        'Default',
      ),
      Scene.expect(Scene.selector('[data-model-row="deepseek/deepseek-pro"] svg')).toExist(),
      Scene.expect(Scene.selector('[data-model-row="deepseek/deepseek-flash"] svg')).not.toExist(),
    )
  })

  it('offers the levels a model reports, and none for the one that reports none', () => {
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(opened(ready, flash)),
      Scene.expect(Scene.selector('[data-reasoning="off"]')).toExist(),
      Scene.expect(Scene.selector('[data-reasoning="max"]')).toExist(),
      Scene.expect(Scene.selector('[data-reasoning="xhigh"]')).not.toExist(),
      Scene.expect(Scene.selector('[data-reasoning="low"]')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(Scene.selector('[data-reasoning="off"]')).toHaveAttr('aria-pressed', 'false'),
      Scene.click(Scene.selector('[data-reasoning="high"]')),
      Scene.expectOutMessage(
        ModelPicker.OutMessage.ConfigureRequested({
          harness: 'pi',
          model: 'deepseek/deepseek-flash',
          reasoning: 'high',
        }),
      ),
      Scene.expect(Scene.selector('[data-reasoning="high"]')).toHaveAttr('aria-pressed', 'true'),
    )

    const switched = ModelPicker.update(
      ModelPicker.update(
        opened(ready, flash),
        ModelPicker.Message.ChosenModel({ model: 'deepseek/deepseek-pro' }),
      ).model,
      ModelPicker.Message.Opened(),
    ).model
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(switched),
      Scene.expect(Scene.selector('[data-model-reasoning]')).not.toExist(),
      Scene.expect(Scene.selector('[data-reasoning="low"]')).not.toExist(),
    )
  })
})

describe('the harness fact', () => {
  it('renders the status, the message, and the install command, copyable and re-checkable', () => {
    Scene.scene(
      { update: ModelPicker.update, view: pickerView },
      Scene.given(loaded(notInstalled)),
      Scene.expect(Scene.selector('[data-harness-label]')).toHaveText('pi'),
      Scene.expect(Scene.selector('[data-harness-status]')).toContainText('not_installed'),
      Scene.expect(Scene.selector('[data-harness-message]')).toContainText('pi is not on PATH'),
      Scene.expect(Scene.selector('[data-harness-install]')).toContainText('pi update self'),
      Scene.expect(Scene.selector('[data-harness-copy]')).toContainText('Copy'),
      Scene.expect(Scene.selector('[data-harness-refresh]')).toContainText('Re-check'),
      Scene.click(Scene.selector('[data-harness-copy]')),
      Scene.expectOutMessage(ModelPicker.OutMessage.CopyRequested({ command: 'pi update self' })),
      Scene.click(Scene.selector('[data-harness-refresh]')),
      Scene.expectOutMessage(ModelPicker.OutMessage.OptionsRequested({ refresh: true })),
      Scene.expect(Scene.selector('[data-model-picker]')).not.toExist(),
    )
  })

  it('renders nothing while the harness is ready and the panel is closed', () => {
    Scene.scene(
      { update: ModelPicker.update, view: pickerView },
      Scene.given(loaded()),
      Scene.expect(Scene.selector('[data-model-picker]')).not.toExist(),
    )
    Scene.scene(
      { update: ModelPicker.update, view: pickerView },
      Scene.given(ModelPicker.init()),
      Scene.expect(Scene.selector('[data-model-picker]')).not.toExist(),
    )
    // The catalogue lives in the composer's `leading` slot now; the status
    // view keeps only the harness's health.
    Scene.scene(
      { update: ModelPicker.update, view: ModelPicker.triggerView },
      Scene.given(opened()),
      Scene.expect(Scene.selector('[data-harness-install]')).not.toExist(),
      Scene.expect(Scene.selector('[data-harness-copy]')).not.toExist(),
      Scene.expect(Scene.selector('[data-model-panel]')).toExist(),
    )
  })
})

describe('picking', () => {
  it('asks the host for options the first time it opens, and on a re-check', () => {
    const opening = ModelPicker.update(ModelPicker.init(), ModelPicker.Message.Opened())
    expect(opening.model.isOpen).toBe(true)
    expect(opening.outMessage).toEqual(ModelPicker.OutMessage.OptionsRequested({ refresh: false }))

    const reloaded = ModelPicker.update(loaded(), ModelPicker.Message.Opened())
    expect(reloaded.outMessage).toBeUndefined()

    const refreshed = ModelPicker.update(loaded(), ModelPicker.Message.RequestedRefresh())
    expect(refreshed.model.options).toEqual(ModelPicker.Loading.make({}))
    expect(refreshed.outMessage).toEqual(ModelPicker.OutMessage.OptionsRequested({ refresh: true }))
  })

  it('seeds its selection from the host, and clears the search on closing', () => {
    const arrived = ModelPicker.update(
      ModelPicker.init(),
      ModelPicker.Message.OptionsArrived({ options: optionsFor(ready, flash) }),
    )
    expect(arrived.model.selection).toEqual({
      harness: 'pi',
      model: 'deepseek/deepseek-flash',
      reasoning: 'low',
    })

    const searched = ModelPicker.update(
      arrived.model,
      ModelPicker.Message.ChangedQuery({ value: 'x' }),
    )
    const closed = ModelPicker.update(searched.model, ModelPicker.Message.Closed())
    expect(closed.model.isOpen).toBe(false)
    expect(closed.model.query).toBe('')

    const failed = ModelPicker.update(
      ModelPicker.init(),
      ModelPicker.Message.OptionsFailed({ reason: 'ThreadOptions: no host' }),
    )
    expect(failed.model.options).toEqual(
      ModelPicker.Unreachable.make({ reason: 'ThreadOptions: no host' }),
    )
  })

  it('closes on a chosen model and reports the harness it opened with', () => {
    const chosen = ModelPicker.update(
      loaded(ready, flash),
      ModelPicker.Message.ChosenModel({ model: 'deepseek/deepseek-pro' }),
    )
    expect(chosen.model.selection).toEqual({
      harness: 'pi',
      model: 'deepseek/deepseek-pro',
      reasoning: 'low',
    })
    expect(chosen.model.isOpen).toBe(false)
    expect(chosen.model.query).toBe('')
    expect(chosen.outMessage).toEqual(
      ModelPicker.OutMessage.ConfigureRequested({
        harness: 'pi',
        model: 'deepseek/deepseek-pro',
        reasoning: 'low',
      }),
    )
  })

  it('reports a copied command, and holds still when the copy fails', () => {
    const requested = ModelPicker.update(
      loaded(notInstalled),
      ModelPicker.Message.RequestedCopy({ command: 'pi update self' }),
    )
    expect(requested.model).toEqual(loaded(notInstalled))
    expect(requested.outMessage).toEqual(
      ModelPicker.OutMessage.CopyRequested({ command: 'pi update self' }),
    )

    const copied = ModelPicker.update(requested.model, ModelPicker.Message.CopiedCommand())
    expect(copied.model.copied).toBe(true)
    expect(ModelPicker.update(copied.model, ModelPicker.Message.CopyFailed()).model).toEqual(
      copied.model,
    )
  })

  it('names the chosen model from the catalogue', () => {
    expect(ModelPicker.selectionLabel(loaded(ready, flash))).toBe('DeepSeek Flash')
    expect(ModelPicker.selectionLabel(loaded())).toBeUndefined()
  })
})
