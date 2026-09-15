import { createServer } from 'node:http'
import { Effect, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { HttpRouter } from 'effect/unstable/http'
import { ServeError } from 'effect/unstable/http/HttpServerError'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { makeHost, sessionLogLayer, type AnyPlugin, type BootError, type Host } from '@oru/kernel'
import { rpcRoutes } from './routes.ts'

export interface HostOptions {
  readonly plugins: readonly AnyPlugin[]
  readonly hostname: string
  /** 0 asks the operating system for a free port, which is what a test wants. */
  readonly port: number
}

/** A host that is serving. Releasing the scope stops it. */
export interface RunningHost {
  readonly host: Host
  readonly url: string
  readonly hostname: string
  readonly port: number
}

/**
 * Assemble a kernel and serve its RPC boundary.
 *
 * The record is the memory journal until #12 gives the host a durable one, so
 * these facts live exactly as long as the process.
 */
export const serveHost = (
  options: HostOptions,
): Effect.Effect<RunningHost, BootError | ServeError, Scope.Scope> =>
  Effect.gen(function* () {
    const host = yield* makeHost(options.plugins)
    const httpEffect = yield* HttpRouter.toHttpEffect(rpcRoutes(host, options.plugins))
    const server = yield* NodeHttpServer.make(() => createServer(), {
      host: options.hostname,
      port: options.port,
    })
    yield* server.serve(httpEffect).pipe(Effect.forkScoped)

    const address = server.address
    if (address._tag !== 'TcpAddress') {
      return yield* Effect.fail(
        new ServeError({ cause: new Error('the host is not listening on a TCP address') }),
      )
    }
    return {
      host,
      url: `http://${address.hostname}:${address.port}`,
      hostname: address.hostname,
      port: address.port,
    }
  }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory))
