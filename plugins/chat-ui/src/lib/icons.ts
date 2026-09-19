import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode, SVGProps } from 'lucide'
import {
  Bot,
  Brain,
  Cloud,
  CodeXml,
  Container,
  Cpu,
  FlaskConical,
  Gauge,
  Hexagon,
  Layers,
  Monitor,
  Mountain,
  Network,
  Sparkle,
  Sparkles,
  Terminal,
  Triangle,
  Users,
  Waves,
  Wind,
  Zap,
} from 'lucide'

/**
 * Render a lucide icon as Foldkit virtual DOM.
 *
 * Lucide ships each icon as a node tree: `[["path", { d: "..." }], ...]`.
 * This renders that tree with the `h` builder, so icons are first-class
 * Foldkit VNodes with no string parsing involved.
 *
 * ```ts
 * import { icon } from '@foldcn/registry/styles/default/lib/icons'
 * import { ChevronDown } from 'lucide'
 *
 * // Default size (size-4 shrink-0)
 * icon(h, ChevronDown)
 *
 * // Custom size
 * icon(h, ChevronDown, 'size-3')
 * ```
 */

const svgElement =
  <M>(tag: string, h: HtmlBuilder<M>) =>
  (attributes: ReadonlyArray<Attribute<M> | ChildAttribute>): Html => {
    switch (tag) {
      case 'path':
        return h.path(attributes)
      case 'circle':
        return h.circle(attributes)
      case 'rect':
        return h.rect(attributes)
      case 'line':
        return h.line(attributes)
      case 'polyline':
        return h.polyline(attributes)
      case 'polygon':
        return h.polygon(attributes)
      default:
        return h.path(attributes)
    }
  }

const svgAttributes = <M>(
  className: string,
  h: HtmlBuilder<M>,
): ReadonlyArray<Attribute<M> | ChildAttribute> => [
  h.AriaHidden(true),
  h.Class(className),
  h.Xmlns('http://www.w3.org/2000/svg'),
  h.Fill('none'),
  h.ViewBox('0 0 24 24'),
  h.StrokeWidth('2'),
  h.Stroke('currentColor'),
  h.StrokeLinecap('round'),
  h.StrokeLinejoin('round'),
]

const nodeToAttributes = <M>(
  attrs: SVGProps,
  h: HtmlBuilder<M>,
): ReadonlyArray<Attribute<M> | ChildAttribute> =>
  Object.entries(attrs).map(([name, value]) => h.Attribute(name, String(value)))

const defaultIconClass = 'size-4 shrink-0'

/**
 * Icon keys a harness may send over RPC, as lowercase Lucide names.
 * A key, never a component: harness metadata crosses the seam as JSON, so
 * the app resolves it here and falls back to a generic glyph for a key it
 * does not know. Keep in sync with the curated maps in the harness plugins.
 */
const iconKeys: Readonly<Record<string, IconNode>> = {
  bot: Bot,
  brain: Brain,
  cloud: Cloud,
  'code-xml': CodeXml,
  container: Container,
  cpu: Cpu,
  'flask-conical': FlaskConical,
  gauge: Gauge,
  hexagon: Hexagon,
  layers: Layers,
  monitor: Monitor,
  mountain: Mountain,
  network: Network,
  sparkle: Sparkle,
  sparkles: Sparkles,
  terminal: Terminal,
  triangle: Triangle,
  users: Users,
  waves: Waves,
  wind: Wind,
  zap: Zap,
}

/** The glyph for a harness-sent key, or undefined when the key names none. */
export const resolveIcon = (key: string | undefined): IconNode | undefined =>
  key === undefined ? undefined : iconKeys[key]

export const fallbackIcon = Cpu

export type IconPosition = 'inline-start' | 'inline-end'

export const icon = <M>(
  h: HtmlBuilder<M>,
  node: IconNode,
  className = defaultIconClass,
  position?: IconPosition,
): Html =>
  h.svg(
    [...svgAttributes(className, h), ...(position ? [h.DataAttribute('icon', position)] : [])],
    node.map(([tag, attrs]) => svgElement(tag, h)(nodeToAttributes(attrs, h))),
  )
