/**
 * The right sidebar: details of the selected thread.
 *
 * A pure view over the selection — no model, no messages. The rows come from
 * the same sections seam the left panel draws, resolved here so `root.ts`
 * only passes the selected id.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { statusLabel } from './thread-list.ts'
import { threadById, type ThreadSection } from './threads.ts'

export type ViewInputs = Readonly<{
  sections: ReadonlyArray<ThreadSection>
}>

const fact = <M>(label: string, value: string, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class('flex items-baseline justify-between gap-2')],
    [
      h.dt([h.Class('text-2xs text-muted-foreground')], [label]),
      h.dd([h.Class('min-w-0 truncate font-mono text-xs')], [value]),
    ],
  )

export const view = <M>(
  selected: Option.Option<string>,
  viewInputs: ViewInputs,
  h: HtmlBuilder<M>,
): Html => {
  const thread = Option.flatMap(selected, (id) =>
    Option.fromNullishOr(threadById(viewInputs.sections, id)),
  )
  return h.div(
    [
      h.DataAttribute('right-panel', ''),
      h.DataAttribute('detail', ''),
      h.Class('flex h-full min-h-0 flex-col text-sidebar-foreground'),
    ],
    [
      h.div(
        [h.Class('flex h-9 shrink-0 items-center px-3')],
        [h.span([h.Class('truncate text-sm font-medium')], ['Details'])],
      ),
      h.div(
        [h.Class('min-h-0 flex-1 overflow-y-auto px-3 py-2')],
        Option.match(thread, {
          onNone: () => [h.p([h.Class('text-xs text-muted-foreground')], ['No thread selected'])],
          onSome: (row) => [
            h.div([h.Class('mb-2 text-sm font-medium')], [row.title]),
            h.dl(
              [h.Class('flex flex-col gap-1.5')],
              [
                fact('Project', row.project.name, h),
                fact('Location', row.location.name, h),
                fact('Status', statusLabel(row.status) ?? 'Idle', h),
                ...(row.pullRequest === undefined
                  ? []
                  : [fact('Pull request', `#${String(row.pullRequest)}`, h)]),
              ],
            ),
          ],
        }),
      ),
    ],
  )
}
