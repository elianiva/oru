import { Schema } from 'effect'
import { ProjectId } from '@oru/kernel'

/** A named workspace on this host, as `project/created` recorded it. */
export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
})
export type Project = typeof Project.Type
