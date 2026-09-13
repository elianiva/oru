import { Match } from 'effect'
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode, SVGProps } from 'lucide'

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
    const element = Match.value(tag).pipe(
      Match.when('circle', () => h.circle),
      Match.when('rect', () => h.rect),
      Match.when('line', () => h.line),
      Match.when('polyline', () => h.polyline),
      Match.when('polygon', () => h.polygon),
      Match.orElse(() => h.path),
    )
    return element(attributes)
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
