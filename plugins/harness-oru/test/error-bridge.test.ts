import { describe, expect, it } from 'vitest'
import { Effect, Stream } from 'effect'
import * as AiError from '@effect-uai/core/AiError'
import type { CommonRequest, LanguageModelService } from '@effect-uai/core/LanguageModel'
import * as Items from '@effect-uai/core/Items'
import { HarnessError } from '@oru/harness'
import { harnessFromLanguageModel } from '../src/index.ts'

/** A provider whose every call fails with `error`. */
const failingWith = (error: AiError.AiError): LanguageModelService => ({
  streamTurn: () => Stream.fail(error),
  turn: () => Effect.fail(error),
})

const turnOf = (error: AiError.AiError) =>
  harnessFromLanguageModel(failingWith(error))
    .turn({ threadId: 't1', history: [], model: 'mock' })
    .pipe(Effect.flip)

describe('harness-oru provider bridge', () => {
  it('reports a rate limit as a retryable harness error carrying the provider tag', async () => {
    const error = await Effect.runPromise(
      turnOf(new AiError.RateLimited({ provider: 'mock', raw: undefined })),
    )
    expect(error).toBeInstanceOf(HarnessError)
    expect(error.code).toBe('RateLimited')
    expect(error.retryable).toBe(true)
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('reports a rejected request as non-retryable', async () => {
    const error = await Effect.runPromise(
      turnOf(new AiError.InvalidRequest({ provider: 'mock', raw: undefined })),
    )
    expect(error.code).toBe('InvalidRequest')
    expect(error.retryable).toBe(false)
  })

  it('maps stream failures through the same bridge', async () => {
    const harness = harnessFromLanguageModel(
      failingWith(new AiError.Timeout({ provider: 'mock', raw: undefined })),
    )
    const error = await Effect.runPromise(
      harness
        .streamTurn({ threadId: 't1', history: [], model: 'mock' })
        .pipe(Stream.runDrain, Effect.flip),
    )
    expect(error).toBeInstanceOf(HarnessError)
    expect(error.code).toBe('Timeout')
  })

  it('forwards only the members the model contract declares', async () => {
    let captured: CommonRequest | undefined
    const harness = harnessFromLanguageModel({
      streamTurn: (request) => {
        captured = request
        return Stream.empty
      },
      turn: () => Effect.die('the turn path is not under test'),
    })
    const history = [Items.userText('hello')]
    await Effect.runPromise(
      harness
        .streamTurn({ threadId: 't1', history, model: 'mock', temperature: 0.5 })
        .pipe(Stream.runDrain),
    )
    expect(Object.keys(captured ?? {})).toEqual(['history', 'model', 'temperature'])
    expect(captured?.history).toEqual(history)
    expect(captured?.model).toBe('mock')
    expect(captured?.temperature).toBe(0.5)
  })
})
