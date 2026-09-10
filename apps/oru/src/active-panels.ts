export const syncActivePanels = <P>(
  current: ReadonlyMap<string, P>,
  active: ReadonlySet<string>,
  create: (id: string) => P,
): ReadonlyMap<string, P> => {
  const next = new Map<string, P>()
  for (const id of active) {
    const existing = current.get(id)
    next.set(id, existing ?? create(id))
  }
  return next
}
