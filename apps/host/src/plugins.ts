import { Context, Effect, Schema } from 'effect'
import { definePlugin, defineService } from '@oru/kernel'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import { harnessPiPlugin } from '@oru/harness-pi'
import { defineTool, demoModelPlugin, inferencePlugin, ToolKind } from '@oru/inference'
import { PanelUi } from './panel.ts'

interface LoggerService {
  readonly log: (message: string) => Effect.Effect<void>
}

export const Logger = defineService<LoggerService>('oru/logger')

interface GreeterService {
  readonly greet: (name: string) => Effect.Effect<string>
}

export const Greeter = defineService<GreeterService>('oru/greeter')

export const loggingPlugin = definePlugin({
  id: 'logging',
  provides: [Logger],
  ui: { title: 'Log' } satisfies PanelUi,
  server: {
    setup: () => Effect.succeed(Context.make(Logger, { log: () => Effect.void })),
  },
})

export const greeterPlugin = definePlugin({
  id: 'greeter',
  needs: [Logger],
  provides: [Greeter],
  ui: { title: 'Greet' } satisfies PanelUi,
  server: {
    setup: () =>
      Effect.succeed(
        Context.make(Greeter, {
          greet: (name) => Effect.succeed(`hello ${name}`),
        }),
      ),
  },
})

/**
 * The slice's two-plugin pair: `logging` provides, `greeter` consumes. Toggling
 * `logging` offline is what shows a coeffect doing its work, and it is the only
 * thing the panel view has to render before a thread exists.
 */
export const fixturePlugins = [greeterPlugin, loggingPlugin]

const EchoArgs = Schema.Struct({ text: Schema.String })

export const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    ToolKind.of(
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input) => Effect.succeed(JSON.stringify({ echoed: input.text })),
      }),
    ),
  ],
})

/**
 * The host's plugin set without the pi bridge.
 *
 * The bridge is the one plugin whose environment is a process, so it is the one
 * plugin a test swaps or leaves out: this is what the transport suite composes
 * to keep `pnpm test` hermetic.
 */
export const corePlugins = [
  ...fixturePlugins,
  harnessRegistryPlugin,
  echoToolPlugin,
  demoModelPlugin,
  harnessOruPlugin,
  inferencePlugin,
]

/**
 * The host's plugin set.
 *
 * The registry is what makes harnesses plural: any plugin that contributes
 * under `HarnessKind` shows up in the picker without the host knowing it
 * (ADR-0006). Only a node process can carry `oru/harness-pi`, because a bridge
 * spawns a process, and this is that process (ADR-0007).
 */
export const hostPlugins = [...corePlugins, harnessPiPlugin()]
