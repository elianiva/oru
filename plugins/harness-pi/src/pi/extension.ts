import { readFileSync } from 'node:fs'

/**
 * The extension pi loads for us.
 *
 * `oru-pi-extension.mjs` is authored as a program and read from disk, so the
 * text pi receives is a real, linted file rather than a string literal, and a
 * node host reaches it without a bundler.
 *
 * It runs inside pi's process, so it cannot import oru: everything it needs
 * arrives through the tools file and the fd 3/4 channel. The JSON Schema to
 * TypeBox conversion lives there because pi's tool contract is TypeBox, while
 * oru's tool contract is JSON Schema (draft 2020-12), and this is the one place
 * the two meet.
 */
export const ORU_PI_EXTENSION_SOURCE: string = readFileSync(
  new URL('./oru-pi-extension.mjs', import.meta.url),
  'utf8',
)
