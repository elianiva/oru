import { Stream } from 'effect'
import type { Host } from '@oru/kernel'
import { uiSnapshotOf, type UiBundles, type UiOverrides } from '../ui.ts'

/**
 * The UI snapshot seam: a snapshot to start from, a stream that keeps it
 * current. Every host event re-reads the claims, so deactivating the plugin
 * behind a slot empties that slot in the app with no second mechanism.
 */
export const uiRpcHandlers = (host: Host, built: UiBundles, overrides: UiOverrides) => {
  const snapshot = () => uiSnapshotOf(host, built, overrides)

  return {
    GetUi: () => snapshot(),
    WatchUi: () =>
      Stream.concat(
        Stream.fromEffect(snapshot()),
        Stream.mapEffect(host.events, () => snapshot()),
      ),
  }
}
