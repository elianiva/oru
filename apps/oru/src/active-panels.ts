import { HashMap, Option } from 'effect'

export const syncActivePanels = <P>(
  current: HashMap.HashMap<string, P>,
  active: ReadonlySet<string>,
  create: (id: string) => P,
): HashMap.HashMap<string, P> => {
  let next = HashMap.empty<string, P>()
  for (const id of active) {
    next = HashMap.set(
      next,
      id,
      Option.getOrElse(HashMap.get(current, id), () => create(id)),
    )
  }
  return next
}
