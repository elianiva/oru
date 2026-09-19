/**
 * Side-effect import: registers block-plugin-sources-hook for the importing
 * test file, so workspace plugin sources cannot resolve while it runs. A
 * host that boots under this hook runs on prebuilt facets alone, the way
 * the packed host does.
 */
import { register } from 'node:module'

register('./block-plugin-sources-hook.mjs', import.meta.url)
