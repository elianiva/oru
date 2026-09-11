import type { Html, HtmlBuilder } from 'foldkit/html'
import { Empty } from '@/components/ui/empty.ts'

export type TwoPaneSlots = Readonly<{
  rail: ReadonlyArray<Html>
  pane: Html | undefined
}>

export const twoPane = <M>(h: HtmlBuilder<M>, slots: TwoPaneSlots): Html =>
  h.div(
    [h.Class('grid min-h-svh grid-cols-[16rem_minmax(0,1fr)] bg-background text-foreground')],
    [
      h.aside(
        [
          h.Class(
            'flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border-seam bg-sidebar text-sidebar-foreground',
          ),
        ],
        [
          h.div([h.Class('flex h-8 shrink-0 items-center px-4 text-sm font-semibold')], ['oru']),
          h.div([h.Class('flex min-h-0 flex-1 flex-col gap-0.5 px-2 py-1')], slots.rail),
        ],
      ),
      h.main(
        [h.Class('flex min-h-0 min-w-0 flex-col bg-background')],
        [
          h.div(
            [
              h.Class(
                'flex h-10 shrink-0 items-center border-b border-border-seam px-4 text-sm font-medium',
              ),
            ],
            [slots.pane === undefined ? 'No thread' : 'Thread'],
          ),
          h.div(
            [h.Class('flex min-h-0 flex-1 flex-col')],
            [
              slots.pane ??
                Empty({}, [Empty.header({}, [Empty.title({}, ['No thread'], h)], h)], h),
            ],
          ),
        ],
      ),
    ],
  )
