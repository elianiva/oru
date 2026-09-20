import { Stream } from 'effect'
import type { Host } from '@oru/kernel'
import type { PluginStore } from '../plugin-store.ts'

/**
 * The UI snapshot seam: a snapshot to start from, a stream that keeps it
 * current. Every host event re-reads the claims, so deactivating the plugin
 * behind a slot empties that slot in the app with no second mechanism.
 * Reloads arrive on the store signal, because a kernel cutover emits nothing.
 */
export const uiRpcHandlers = (host: Host, store: PluginStore) => {
  const snapshot = () => store.uiSnapshot()

  return {
    GetUi: () => snapshot(),
    WatchUi: () =>
      Stream.concat(
        Stream.fromEffect(snapshot()),
        Stream.merge(host.events, store.changes).pipe(Stream.mapEffect(() => snapshot())),
      ),
  }
}
