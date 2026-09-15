import { createHash } from 'node:crypto'

export const addressOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')
