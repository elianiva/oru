/** A bundler's `?raw` import: the imported file's text, verbatim. */
declare module '*.mjs?raw' {
  const source: string
  export default source
}
