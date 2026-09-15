import './index.css'
import { Effect } from 'effect'
import { clientsFor } from '@oru/rpc'
import { Runtime } from 'foldkit'
import { Model, init, subscriptions, update, view } from './root.ts'

/**
 * The app is a client of a running host, not a host itself. A host that is not
 * the origin serving this page is named by `VITE_ORU_HOST_URL`; by default the
 * page talks to its own origin, which is the dev server's proxy to the host.
 */
const hostUrl = import.meta.env.VITE_ORU_HOST_URL ?? ''

const program = Effect.gen(function* () {
  const container = document.getElementById('root')
  const application = Runtime.makeElement({
    Model,
    init,
    update,
    view,
    subscriptions,
    container,
    resources: clientsFor(hostUrl),
  })
  Runtime.run(application)
  yield* Effect.never
})

Effect.runFork(Effect.scoped(program))
