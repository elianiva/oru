import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { ThreadOptions } from '../src/thread-options.ts'

const ready = { status: 'ready' } as const

/** A host predating provider metadata answers without the key. */
const withoutProviders = {
  config: { harness: 'pi', model: undefined, reasoning: undefined },
  harness: 'pi',
  harnesses: [{ id: 'pi', label: 'pi', health: ready }],
  models: [],
}

describe('ThreadOptions providers', () => {
  it('reads an answer from a host that predates provider metadata', () => {
    const decoded = Schema.decodeUnknownSync(ThreadOptions)(withoutProviders)
    expect(decoded.providers).toEqual([])
  })

  it('keeps the providers a current host reports', () => {
    const decoded = Schema.decodeUnknownSync(ThreadOptions)({
      ...withoutProviders,
      providers: [{ id: 'deepseek', label: 'DeepSeek', icon: 'waves' }],
    })
    expect(decoded.providers).toEqual([{ id: 'deepseek', label: 'DeepSeek', icon: 'waves' }])
  })
})
