export { inferencePlugin } from './plugin.ts'
export { Inference } from './inference.ts'
export { demoModelId, demoModelPlugin, mockModelPlugin, modelPlugin } from './demo-model.ts'
// Harness core is now @oru/harness — re-export for convenience so consumers
// don't need to know the package split.
export {
  Harness,
  HarnessError,
  defaultCapabilities,
  defineHarness,
  turnFromStream,
  type HarnessCapabilities,
  type HarnessEvent,
  type HarnessMeta,
  type HarnessService,
  type HarnessTurnRequest,
  type ModelInfo,
  type Turn,
} from '@oru/harness'
export {
  Idle,
  CallModel,
  RunTool,
  Work,
  foldThread,
  workOf,
  type PendingCall,
  type ThreadState,
} from './session-fold.ts'
export { ToolKind, defineTool, type ToolContribution, type ToolOutcome } from './tool-kind.ts'
