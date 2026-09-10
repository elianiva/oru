import { describe, expect, it } from 'vitest'
import { MessageAppended, PluginActivated, ThreadCreated } from '../src/session-event.ts'
import { foldNamedThreads } from '../src/session-fold.ts'

describe('foldNamedThreads', () => {
  it('names a thread from thread/created without any messages', () => {
    const created = ThreadCreated.make({ id: 'e1', thread: 't1' })
    expect([...foldNamedThreads([created])]).toEqual(['t1'])
  })

  it('names a thread from later work facts and ignores plugin facts', () => {
    const events = [
      PluginActivated.make({ plugin: 'logging', scope: 'host' }),
      MessageAppended.make({ id: 'e2', thread: 't2', role: 'user', body: 'hi' }),
    ]
    expect([...foldNamedThreads(events)]).toEqual(['t2'])
  })
})
