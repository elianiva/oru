/**
 * The host's projects, as the app knows them.
 *
 * `ListProjects` is the app's first call and its liveness probe: the state this
 * model is in is the state the app is in. A host that does not answer, or
 * answers that it has no projects, is a fact to render — with a retry — not a
 * defect to die on.
 */
import { Match, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import { FolderGit } from 'lucide'
import { Project } from '@oru/rpc'
import { button } from '@/components/ui/button.ts'
import { Empty } from '@/components/ui/empty.ts'
import { icon } from '@/lib/icons.ts'

export const Loading = Schema.TaggedStruct('Loading', {})
export const Loaded = Schema.TaggedStruct('Loaded', { projects: Schema.Array(Project) })
export const Unreachable = Schema.TaggedStruct('Unreachable', { reason: Schema.String })

export const Model = Schema.Union([Loading, Loaded, Unreachable])
export type Model = typeof Model.Type

export const isUnreachable = (model: Model): boolean => Predicate.isTagged(model, 'Unreachable')

export const Message = defineMessageUnion({
  ProjectsArrived: { projects: Schema.Array(Project) },
  HostUnreachable: { reason: Schema.String },
  ClickedRetry: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedRetry: {},
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => Loading.make({})

export const update = (
  model: Model,
  message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    ProjectsArrived: ({ projects }) => ({ model: Loaded.make({ projects }) }),
    HostUnreachable: ({ reason }) => ({ model: Unreachable.make({ reason }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedRetry() }),
  })

const projectRow = (project: Project, h: HtmlBuilder<Message>): Html =>
  h.li(
    [
      h.DataAttribute('project', project.id),
      h.Class(
        'flex items-baseline gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-sm',
      ),
    ],
    [
      icon(h, FolderGit, 'size-4 shrink-0 self-center text-muted-foreground'),
      h.span([h.Class('truncate text-sm font-medium')], [project.name]),
      h.span([h.Class('min-w-0 truncate font-mono text-xs text-muted-foreground')], [project.cwd]),
    ],
  )

const emptyState = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.DataAttribute('projects-empty', ''), h.Class('flex-none')],
    [
      Empty(
        { className: 'flex-none' },
        [
          Empty.header(
            {},
            [
              Empty.media({ variant: 'icon' }, [icon(h, FolderGit, 'size-4')], h),
              Empty.title({}, ['No projects yet'], h),
              Empty.description({}, ['This host has recorded no projects.'], h),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
  )

const unreachableState = (reason: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('host-unreachable', ''),
      h.Class(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
      ),
    ],
    [
      h.p([h.Class('text-lg font-medium')], ['Host unreachable']),
      h.p(
        [h.Class('text-sm text-muted-foreground')],
        ['The app is a client of a running host, and this host did not answer.'],
      ),
      h.code(
        [h.DataAttribute('host-unreachable-reason', ''), h.Class('font-mono text-xs')],
        [reason],
      ),
      button(
        {
          onClick: Message.ClickedRetry(),
          variant: 'outline',
          className: 'mt-1',
          attributes: [h.DataAttribute('host-retry', '')],
        },
        'Retry',
        h,
      ),
    ],
  )

export const view = defineView<Model, Message>((model, h) =>
  h.div(
    [h.DataAttribute('projects', ''), h.Class('w-full')],
    Match.value(model).pipe(
      Match.tagsExhaustive({
        Loading: (): ReadonlyArray<Html> => [],
        Loaded: ({ projects }): ReadonlyArray<Html> =>
          projects.length === 0
            ? [emptyState(h)]
            : [
                h.ul(
                  [
                    h.DataAttribute('projects-list', ''),
                    h.AriaLabel('Projects on this host'),
                    h.Class('flex flex-col gap-1.5'),
                  ],
                  projects.map((project) => projectRow(project, h)),
                ),
              ],
        Unreachable: ({ reason }): ReadonlyArray<Html> => [unreachableState(reason, h)],
      }),
    ),
  ),
)
