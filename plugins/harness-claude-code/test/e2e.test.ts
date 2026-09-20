import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Effect, Predicate, Stream } from 'effect'
import { isAssistantMessage, userText } from '@oru/harness'
import { openClaudeCodeHarness } from '../src/index.ts'

/**
 * The bridge against the real `claude` CLI and a real model: one tiny turn,
 * and the assistant text plus usage it reports.
 *
 * This spends real money, so it only runs when a model is named and the CLI
 * is installed, signed in, and new enough: otherwise the suite reports a skip
 * rather than pointing at somebody's account by default.
 *
 *   ORU_CLAUDE_E2E_MODEL=claude-sonnet-5 \
 *     pnpm --filter @oru/harness-claude-code e2e
 *
 * Only the model is real and shared: the session pointer lands in a temporary
 * directory, so the run never touches the user's own threads.
 */

const MODEL = process.env['ORU_CLAUDE_E2E_MODEL']

const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface E2EReadiness {
  readonly run: boolean
  readonly reason: string
}

const readiness: E2EReadiness = await Effect.runPromise(
  Effect.gen(function* () {
    if (MODEL === undefined || MODEL === '') {
      return { run: false, reason: 'ORU_CLAUDE_E2E_MODEL is not set' } satisfies E2EReadiness
    }
    const dir = mkdtempSync(join(tmpdir(), 'oru-claude-e2e-probe-'))
    cleanups.push(dir)
    const probe = yield* openClaudeCodeHarness({
      env: { ...process.env, ORU_CLAUDE_SESSION_DIR: join(dir, 'sessions') },
      log: () => undefined,
    })
    try {
      const health = yield* probe.service.health!()
      if (health.status !== 'ready') {
        return { run: false, reason: `Muse is ${health.status}` } satisfies E2EReadiness
      }
      return { run: true, reason: '' } satisfies E2EReadiness
    } finally {
      probe.shutdown()
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.succeed({ run: false, reason: String(cause) } satisfies E2EReadiness),
    ),
  ),
)

if (!readiness.run) {
  process.stdout.write(`Muse e2e skipped: ${readiness.reason}\n`)
}

describe.runIf(readiness.run)('oru driving Claude Code, for real', () => {
  it('runs one tiny turn and reports its text and usage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oru-claude-e2e-'))
    const cwd = mkdtempSync(join(tmpdir(), 'oru-claude-e2e-cwd-'))
    cleanups.push(dir, cwd)
    const model = MODEL ?? ''
    const harness = await Effect.runPromise(
      openClaudeCodeHarness({
        env: { ...process.env, ORU_CLAUDE_SESSION_DIR: join(dir, 'sessions') },
        log: (message: string) => process.stdout.write(`Muse: ${message}\n`),
      }),
    )
    try {
      const collected = await Effect.runPromise(
        Stream.runCollect(
          harness.service.streamTurn({
            threadId: crypto.randomUUID(),
            history: [userText('Reply with exactly the word DONE and nothing else.')],
            model,
            cwd,
          }),
        ),
      )
      const complete = collected.find((event) => Predicate.isTagged(event, 'TurnComplete'))
      if (!Predicate.isTagged(complete, 'TurnComplete')) expect.fail('Claude Code reported no turn')
      expect(complete.turn.items.length).toBe(1)
      const [item] = complete.turn.items
      if (item === undefined || !isAssistantMessage(item)) {
        expect.fail('the turn did not end with assistant text')
      }
      expect(item.text.length).toBeGreaterThan(0)
      expect(complete.turn.stop_reason).toBe('stop')
      expect(complete.turn.usage?.input_tokens).toBeGreaterThan(0)
      expect(complete.turn.usage?.output_tokens).toBeGreaterThan(0)
    } finally {
      harness.shutdown()
    }
  })
})
