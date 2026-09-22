export { harnessOpencodePlugin, default } from './plugin.ts'
export {
  openOpencodeHarness,
  syncToolsOf,
  type OpenedHarness,
  type OpenOpencodeHarnessInput,
  type ToolSyncDeps,
} from './opencode/host.ts'
export { OpenCodeConfig, OpenCodeEnv, envOf, type OpenCodeConfigValue } from './config.ts'
