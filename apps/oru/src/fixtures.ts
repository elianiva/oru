import { Context, Effect, Option, Schema } from 'effect'
import { definePlugin, defineService } from '@oru/kernel'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import { defineTool, demoModelPlugin, inferencePlugin, ToolKind } from '@oru/inference'

interface LoggerService {
  readonly log: (message: string) => Effect.Effect<void>
}

export const Logger = defineService<LoggerService>('oru/logger')

interface GreeterService {
  readonly greet: (name: string) => Effect.Effect<string>
}

export const Greeter = defineService<GreeterService>('oru/greeter')

export const PanelUi = Schema.Struct({
  title: Schema.String,
})
export type PanelUi = typeof PanelUi.Type

export const decodePanelUi = Schema.decodeUnknownOption(PanelUi)

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
 * The app's host.
 *
 * The registry is what makes harnesses plural: any plugin that contributes
 * under `HarnessKind` shows up in the picker without the host knowing it
 * (ADR-0017). A bridge that spawns a process — `oru/harness-pi` — belongs to a
 * node host, so the browser app carries the registry and the in-process bridge,
 * and a node host is where the others are added.
 */
export const hostPlugins = [
  ...fixturePlugins,
  harnessRegistryPlugin,
  echoToolPlugin,
  demoModelPlugin,
  harnessOruPlugin,
  inferencePlugin,
]

export const fixtureTitles: ReadonlyMap<string, string> = new Map(
  fixturePlugins.flatMap((plugin) =>
    Option.match(decodePanelUi(plugin.ui), {
      onNone: () => [],
      onSome: (ui) => [[plugin.id, ui.title] as const],
    }),
  ),
)
