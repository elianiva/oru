import source from './oru-pi-extension.mjs?raw'

/**
 * The extension pi loads for us.
 *
 * `oru-pi-extension.mjs` is authored as a program and imported with `?raw`, so
 * the text pi receives is a real, linted file rather than a string literal. That
 * query is a bundler contract — vite and vitest resolve it; a bare node host
 * would import the module instead, leaving this constant a function — so this
 * package is loaded through a bundler.
 *
 * It runs inside pi's process, so it cannot import oru: everything it needs
 * arrives through the tools file and the fd 3/4 channel. The JSON Schema to
 * TypeBox conversion lives there because pi's tool contract is TypeBox, while
 * oru's tool contract is JSON Schema (draft 2020-12), and this is the one place
 * the two meet.
 */
export const ORU_PI_EXTENSION_SOURCE: string = source
