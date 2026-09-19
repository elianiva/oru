import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { UiSnapshot } from '@oru/ui'

/**
 * The UI graph, as a presentation facet sees it: a snapshot to start from
 * and a stream that keeps it current. The bundles it names are fetched
 * over HTTP from the same origin, so the app reconciles generations the
 * way bb reconciles plugin frontends (ADR-0020).
 */
export const UiRpc = RpcGroup.make(
  Rpc.make('GetUi', { success: UiSnapshot }),
  Rpc.make('WatchUi', { success: UiSnapshot, stream: true }),
)
