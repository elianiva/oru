import { Schema } from 'effect'
import { bundleWithTsdown } from './bundle.ts'

export class UiBundleError extends Schema.TaggedError<UiBundleError>()('UiBundleError', {
  message: Schema.String,
}) {}

export interface BuiltUiBundle {
  readonly address: string
  readonly js: string
}

/**
 * Bundle a presentation facet entry into one self-contained ESM document.
 *
 * Everything is bundled in (noExternal matches every specifier), so the app
 * can import the bundle without shared vendor chunks. That duplicates
 * `effect` and `foldkit` inside the bundle, which is sound only because the
 * slot boundary is plain data: props in, intent out, commands stay in root
 * (ADR-0020). A shared-runtime optimization is the recorded follow-up.
 */
export const buildUiBundle = async (entry: string): Promise<BuiltUiBundle> => {
  try {
    return await bundleWithTsdown(entry, { platform: 'browser', alwaysBundle: true })
  } catch (error) {
    if (error instanceof UiBundleError) throw error
    throw new UiBundleError({
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
