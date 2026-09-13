import { Context, Effect } from 'effect'
import { LanguageModel, type LanguageModelService } from '@effect-uai/core/LanguageModel'
import * as Items from '@effect-uai/core/Items'
import * as MockProvider from '@effect-uai/core/testing/MockProvider'
import type * as Turn from '@effect-uai/core/Turn'
import { definePlugin, type PluginId } from '@oru/kernel'

export const demoModelId = 'mock'

const demoTurns = [
  {
    items: [
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'echo',
        arguments: JSON.stringify({ text: 'hi' }),
      },
    ],
    usage: {},
    stop_reason: 'tool_calls',
  },
  {
    items: [Items.assistantText('done')],
    usage: {},
    stop_reason: 'stop',
  },
] as const satisfies ReadonlyArray<Turn.Turn>

export const modelPlugin = (id: PluginId, service: LanguageModelService) =>
  definePlugin({
    id,
    provides: [LanguageModel],
    server: {
      setup: () => Effect.succeed(Context.make(LanguageModel, service)),
    },
  })

export const mockModelPlugin = (id: PluginId, scriptedTurns: ReadonlyArray<Turn.Turn>) =>
  definePlugin({
    id,
    provides: [LanguageModel],
    server: {
      setup: () =>
        Effect.sync(() => Context.make(LanguageModel, MockProvider.make(scriptedTurns).service)),
    },
  })

export const demoModelPlugin = mockModelPlugin('oru/model-demo', demoTurns)
