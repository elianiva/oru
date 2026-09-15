import { Layer } from 'effect'
import { RpcSerialization } from 'effect/unstable/rpc'

/**
 * Where each RPC group is mounted, and how it is framed.
 *
 * The host mounts what these name and a client appends them to its host URL, so
 * one module decides both ends. NDJSON is not a preference: the long-lived
 * streams (`WatchGraph`, `WatchThread`, `WatchSignals`) only travel when the
 * serialization declares its framing, because that is when the client reads the
 * response as a stream instead of buffering it to the end.
 */
export const hostRpcPath = '/rpc/host'
export const threadRpcPath = '/rpc/thread'
export const projectRpcPath = '/rpc/project'

export const rpcSerializationLayer: Layer.Layer<RpcSerialization.RpcSerialization> =
  RpcSerialization.layerNdjson
