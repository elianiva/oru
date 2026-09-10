import { describe, expect, it } from "vitest"
import { Result } from "effect"
import { DuplicateProvider, GraphCycle, definePlugin, defineService, provide, resolve } from "../src/index"

const A = defineService<{ readonly a: () => void }>("oru/a")
const B = defineService<{ readonly b: () => void }>("oru/b")

const providerA = definePlugin({
  id: "provider-a",
  provides: [provide(A)],
})

const consumerB = definePlugin({
  id: "consumer-b",
  needs: [A],
  provides: [provide(B)],
})

describe("resolve", () => {
  it("orders a provider before its consumer and leaves unmet plugins blocked", () => {
    const Missing = defineService<{ readonly ping: () => void }>("oru/missing")
    const lonely = definePlugin({ id: "lonely", needs: [Missing] })
    const plan = resolve([consumerB, lonely, providerA], new Set())

    expect(Result.isSuccess(plan)).toBe(true)
    if (!Result.isSuccess(plan)) return
    expect(plan.success.order.map((plugin) => plugin.id)).toEqual(["provider-a", "consumer-b"])
    expect(plan.success.blocked.get("lonely")?.missing).toEqual(["oru/missing"])
  })

  it("fails when two plugins provide the same token", () => {
    const other = definePlugin({
      id: "other-a",
      provides: [provide(A)],
    })
    const plan = resolve([providerA, other], new Set())

    expect(plan).toEqual(Result.fail(new DuplicateProvider({ token: "oru/a", existing: "provider-a", incoming: "other-a" })))
  })

  it("fails when blocked plugins form a cycle", () => {
    const ping = definePlugin({
      id: "ping",
      needs: [B],
      provides: [provide(A)],
    })
    const pong = definePlugin({
      id: "pong",
      needs: [A],
      provides: [provide(B)],
    })
    const plan = resolve([ping, pong], new Set())

    expect(plan).toEqual(Result.fail(new GraphCycle({ plugins: ["ping", "pong"] })))
  })
})
