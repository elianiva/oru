export { inferencePlugin } from './plugin.ts'
export { Inference } from './inference.ts'
export { demoModelId, demoModelPlugin, mockModelPlugin, modelPlugin } from './demo-model.ts'
// Harness core lives in @oru/harness. Re-exported for convenience, so consumers
// do not need to import the package itself.
export {
  HarnessError,
  Harnesses,
  defaultCapabilities,
  defineHarness,
  turnFromStream,
  type HarnessCapabilities,
  type HarnessEvent,
  type HarnessMeta,
  type HarnessService,
  type HarnessTurnRequest,
  type ModelInfo,
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
export type { ThreadConfigurationInput, ThreadSignal } from './inference.ts'
export { ToolKind, defineTool, type ToolContribution, type ToolOutcome } from './tool-kind.ts'
