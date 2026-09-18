export {
  harnessClaudeCodePlugin,
  openClaudeCodeHarness,
  plugin,
  type ClaudeHarness,
} from './plugin.ts'
export { ClaudeCodeConfig, type ClaudeCodeConfigValue } from './config.ts'
export { default } from './plugin.ts'
export { ClaudeCodeSession, ClaudeCodeBridgeError } from './claude/session.ts'
export {
  MINIMUM_CLAUDE_CODE_VERSION,
  parseClaudeCodeVersion,
  probeClaudeCodeVersion,
} from './claude/launch.ts'
