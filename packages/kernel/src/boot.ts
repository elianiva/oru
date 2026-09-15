import type { Effect } from 'effect'
import { defineContributionKind } from './contribution.ts'

/**
 * Work a host runs once its plugin graph is assembled.
 *
 * Activation order follows declared needs, so a plugin can activate before the
 * plugins it uses without depending on them: the graph is whole by the time
 * these run, and never before (ADR-0009).
 */
export const BootKind = defineContributionKind<Effect.Effect<void>>('oru/boot')
