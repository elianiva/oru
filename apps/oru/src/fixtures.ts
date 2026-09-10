import { Context, Effect, Option, Schema } from 'effect'
import { definePlugin, defineService, provide } from '@oru/kernel'

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
  provides: [provide(Logger)],
  ui: { title: 'Log' } satisfies PanelUi,
  server: {
    setup: () => Effect.succeed(Context.make(Logger, { log: () => Effect.void })),
  },
})

export const greeterPlugin = definePlugin({
  id: 'greeter',
  needs: [Logger],
  provides: [provide(Greeter)],
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

export const fixtureTitles: ReadonlyMap<string, string> = new Map(
  fixturePlugins.flatMap((plugin) =>
    Option.match(decodePanelUi(plugin.ui), {
      onNone: () => [],
      onSome: (ui) => [[plugin.id, ui.title] as const],
    }),
  ),
)
