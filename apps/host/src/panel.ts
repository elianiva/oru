import { Schema } from 'effect'

/**
 * The panel a plugin declares in its `ui`.
 *
 * A plugin without one is live in the kernel and has nothing to show, so it
 * never reaches the view: the graph the presentation facet mirrors is a graph
 * of panels, not of plugins (ADR-0004).
 */
export const PanelUi = Schema.Struct({
  title: Schema.String,
})
export type PanelUi = typeof PanelUi.Type

export const decodePanelUi = Schema.decodeUnknownOption(PanelUi)
