import * as Items from '@effect-uai/core/Items'
import * as MockProvider from '@effect-uai/core/testing/MockProvider'

export const demoModelId = 'mock'

export const demoModelLayer = MockProvider.layer([
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
])
