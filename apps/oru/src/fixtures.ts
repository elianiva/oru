import { Context, Effect, Option, Schema, Stream } from 'effect'
import { contribute, definePlugin, defineService, provide } from '@oru/kernel'
import { inferencePlugin, Model, ToolKind } from '@oru/inference'

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

const EchoArgs = Schema.Struct({ text: Schema.String })

export const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    contribute(ToolKind, {
      name: 'echo',
      description: 'Return the text that was passed in.',
      execute: (argumentsJson) =>
        Effect.try({
          try: () => JSON.parse(argumentsJson),
          catch: () => new Error('invalid tool arguments'),
        }).pipe(
          Effect.flatMap((raw) => Schema.decodeUnknownEffect(EchoArgs)(raw)),
          Effect.map((input) => ({ ok: true, result: JSON.stringify({ echoed: input.text }) })),
          Effect.catch(() => Effect.succeed({ ok: false, result: 'tool failed' })),
        ),
    }),
  ],
})

export const fakeModelPlugin = definePlugin({
  id: 'model/fake',
  provides: [provide(Model)],
  server: {
    setup: () =>
      Effect.succeed(
        Context.make(Model, {
          streamTurn: (history) => {
            if (history.some((item) => item._tag === 'tool')) {
              return Effect.succeed(Stream.succeed({ _tag: 'text' as const, text: 'done' }))
            }
            return Effect.succeed(
              Stream.succeed({
                _tag: 'tool' as const,
                name: 'echo',
                call: 'call_1',
                arguments: JSON.stringify({ text: 'hi' }),
              }),
            )
          },
        }),
      ),
  },
})

export const hostPlugins = [...fixturePlugins, echoToolPlugin, fakeModelPlugin, inferencePlugin]

export const fixtureTitles: ReadonlyMap<string, string> = new Map(
  fixturePlugins.flatMap((plugin) =>
    Option.match(decodePanelUi(plugin.ui), {
      onNone: () => [],
      onSome: (ui) => [[plugin.id, ui.title] as const],
    }),
  ),
)
