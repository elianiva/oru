import type { Effect } from 'effect'
import { defineContributionKind } from './contribution.ts'

/**
 * Work a host runs once its plugin graph is assembled.
 *
 * Boot retries the inject-blocked set until it stops progressing, so a plugin
 * can activate before the plugins it uses without depending on them: the graph
 * is whole by the time these run, and never before (ADR-0010).
 */
export const BootKind = defineContributionKind<Effect.Effect<void>>('oru/boot')
