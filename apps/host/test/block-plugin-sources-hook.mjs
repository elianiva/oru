/**
 * Resolve hook proving a test never touches workspace plugin sources. The
 * packed host ships no plugin packages, so `@oru/chat-ui` and the bridges
 * must not resolve; library specifiers resolve untouched.
 */
export const resolve = async (specifier, context, next) => {
  if (
    specifier === '@oru/chat-ui' ||
    specifier === '@oru/harness-pi' ||
    specifier === '@oru/harness-claude-code'
  ) {
    // oxlint-disable-next-line anti-slop-effect/no-error-constructor -- SAFETY: ESM resolve hooks report failure by throwing; there is no Effect channel here.
    throw new Error(`blocked workspace source resolution: ${specifier}`)
  }
  return next(specifier, context)
}
