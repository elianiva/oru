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
            'flex flex-col gap-3 border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground',
          ),
        ],
        [h.p([h.Class('px-1 text-sm font-medium tracking-tight')], ['oru']), ...slots.rail],
      ),
      h.main(
        [h.Class('flex min-h-0 flex-col bg-background')],
        [slots.pane ?? Empty({}, [Empty.header({}, [Empty.title({}, ['No thread'], h)], h)], h)],
      ),
    ],
  )
