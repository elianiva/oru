import { Effect, Schema } from 'effect'
import { definePlugin, defineService, type AnyPlugin } from '@oru/kernel'
import { defineTool, runtimePlugin, ToolKind } from '@oru/harness'
import { harnessRegistryPlugin } from '@oru/harness-registry'

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
  panel: { title: 'Log' },
  apply: (ctx) => ctx.provide(Logger, { log: () => Effect.void }),
})

export const greeterPlugin = definePlugin({
  id: 'greeter',
  inject: [Logger],
  panel: { title: 'Greet' },
  apply: (ctx) =>
    ctx.provide(Greeter, {
      greet: (name) => Effect.succeed(`hello ${name}`),
    }),
})

/**
 * The slice's two-plugin pair: `logging` provides, `greeter` consumes. Toggling
 * `logging` offline is what shows an inject doing its work, and it is the only
 * thing the panel view has to render before a thread exists.
 */
export const fixturePlugins = [greeterPlugin, loggingPlugin]

const EchoArgs = Schema.Struct({ text: Schema.String })

export const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  apply: (ctx) =>
    ctx.contribute(
      ToolKind.of(
        defineTool({
          name: 'echo',
          description: 'Return the text that was passed in.',
          parameters: EchoArgs,
          execute: (input) => Effect.succeed(JSON.stringify({ echoed: input.text })),
        }),
      ),
    ),
})

/**
 * The host's plugin set without any bridge.
 *
 * A bridge is an external plugin now, so this is what the transport suite
 * composes to keep `pnpm test` hermetic. The registry reads its defaults from
 * the host's plugin configs: absent it carries no configured default, and a
 * composition that resolves `config.json` hands its own value over.
 */
export const corePlugins: readonly AnyPlugin[] = [
  ...fixturePlugins,
  harnessRegistryPlugin,
  echoToolPlugin,
  runtimePlugin,
]

/**
 * The host's plugin set.
 *
 * The registry is what makes harnesses plural: any plugin that contributes
 * under `HarnessKind` shows up in the picker without the host knowing it
 * (ADR-0006). A bridge spawns a process, so only a node process can carry one,
 * and this is that process (ADR-0007). The bridges load through the generic
 * plugin-source loader, the same path a third-party harness takes: the host
 * knows no harness by name. The caller appends whatever the sources resolve
 * to `corePlugins` and hands every plugin its config data.
 */
