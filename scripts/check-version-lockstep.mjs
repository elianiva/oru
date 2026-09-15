import { lockstepError, repoRoot } from './version.mjs'

const error = lockstepError(repoRoot)
if (error !== undefined) {
  process.stderr.write(`${error}\n`)
  process.exitCode = 1
}
