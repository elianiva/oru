import { Match, Schema } from 'effect'

const CostObject = Schema.Struct({ total: Schema.Number })
const ReportedCost = Schema.Union([Schema.Number, CostObject])

/**
 * What a harness turn's `usage` bag may carry. Extra fields are ignored.
 * `cost` is either a number or `{ total }`, which is how pi reports it.
 */
export const ReportedUsage = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Number),
  output_tokens: Schema.optionalKey(Schema.Number),
  cost: Schema.optionalKey(ReportedCost),
})
export type ReportedUsage = typeof ReportedUsage.Type

export const decodeReportedUsage = Schema.decodeUnknownOption(ReportedUsage)

export interface RecordedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number | undefined
}

const costOf = (cost: typeof ReportedCost.Type): number =>
  Match.value(cost).pipe(
    Match.when(Match.number, (value) => value),
    Match.orElse((value) => value.total),
  )

export const recordedUsageOf = (usage: ReportedUsage): RecordedUsage | undefined => {
  const cost = usage.cost === undefined ? undefined : costOf(usage.cost)
  if (usage.input_tokens === undefined && usage.output_tokens === undefined && cost === undefined) {
    return undefined
  }
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cost,
  }
}
