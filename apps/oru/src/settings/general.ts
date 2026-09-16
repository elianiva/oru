import { Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import * as Update from 'foldkit/update'
import { evo } from 'foldkit/struct'
import { Mic, RotateCw } from 'lucide'
import { badge } from '@/components/ui/badge.ts'
import { button } from '@/components/ui/button.ts'
import { icon } from '@/lib/icons.ts'
import { card, section, selectRow, textRow, toggleRow } from './controls.ts'

/**
 * The General settings page. It owns its controls' state as a skeleton;
 * wiring each field to real config lands here later, one field at a time.
 */
export const Model = Schema.Struct({
  navigateToThreads: Schema.Boolean,
  markdownFormatting: Schema.Boolean,
  followupBehavior: Schema.String,
  rewriteLocalhost: Schema.Boolean,
  branchPrefix: Schema.String,
  streamerMode: Schema.Boolean,
  microphone: Schema.String,
  showDiagnostics: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ToggledNavigateToThreads: { isChecked: Schema.Boolean },
  ToggledMarkdownFormatting: { isChecked: Schema.Boolean },
  SelectedFollowupBehavior: { value: Schema.String },
  ToggledRewriteLocalhost: { isChecked: Schema.Boolean },
  ChangedBranchPrefix: { value: Schema.String },
  ToggledStreamerMode: { isChecked: Schema.Boolean },
  SelectedMicrophone: { value: Schema.String },
  ToggledShowDiagnostics: { isChecked: Schema.Boolean },
  ClickedInstallSkills: {},
  ClickedRefreshMicrophones: {},
})
export type Message = typeof Message.Type

export const init = (): Model => ({
  navigateToThreads: true,
  markdownFormatting: false,
  followupBehavior: 'queue',
  rewriteLocalhost: true,
  branchPrefix: 'elianiva/',
  streamerMode: false,
  microphone: 'system',
  showDiagnostics: false,
})

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ToggledNavigateToThreads: ({ isChecked }) => ({
      model: evo(model, { navigateToThreads: () => isChecked }),
    }),
    ToggledMarkdownFormatting: ({ isChecked }) => ({
      model: evo(model, { markdownFormatting: () => isChecked }),
    }),
    SelectedFollowupBehavior: ({ value }) => ({
      model: evo(model, { followupBehavior: () => value }),
    }),
    ToggledRewriteLocalhost: ({ isChecked }) => ({
      model: evo(model, { rewriteLocalhost: () => isChecked }),
    }),
    ChangedBranchPrefix: ({ value }) => ({
      model: evo(model, { branchPrefix: () => value }),
    }),
    ToggledStreamerMode: ({ isChecked }) => ({
      model: evo(model, { streamerMode: () => isChecked }),
    }),
    SelectedMicrophone: ({ value }) => ({
      model: evo(model, { microphone: () => value }),
    }),
    ToggledShowDiagnostics: ({ isChecked }) => ({
      model: evo(model, { showDiagnostics: () => isChecked }),
    }),
    // Installing skills and probing microphones reach outside the page; the
    // commands that do that attach here once the backends exist.
    ClickedInstallSkills: () => ({ model }),
    ClickedRefreshMicrophones: () => ({ model }),
  })

const generalCard = (model: Model, h: HtmlBuilder<Message>): Html =>
  card(
    [
      toggleRow(
        {
          id: 'settings-navigate-to-threads',
          title: 'Navigate to threads on creation',
          isChecked: model.navigateToThreads,
          onToggle: (isChecked) => Message.ToggledNavigateToThreads({ isChecked }),
        },
        h,
      ),
      toggleRow(
        {
          id: 'settings-markdown-formatting',
          title: 'Markdown formatting in prompt box',
          isChecked: model.markdownFormatting,
          onToggle: (isChecked) => Message.ToggledMarkdownFormatting({ isChecked }),
        },
        h,
      ),
      selectRow(
        {
          id: 'settings-followup-behavior',
          title: 'Default thread followup behavior',
          description: 'What Enter does in the prompt box while the thread runs.',
          value: model.followupBehavior,
          options: [
            { value: 'queue', label: 'Queue' },
            { value: 'send', label: 'Send' },
            { value: 'new-thread', label: 'New thread' },
          ],
          onChange: (value) => Message.SelectedFollowupBehavior({ value }),
        },
        h,
      ),
      toggleRow(
        {
          id: 'settings-rewrite-localhost',
          title: 'Rewrite localhost links',
          description: 'Point localhost links at this host.',
          isChecked: model.rewriteLocalhost,
          onToggle: (isChecked) => Message.ToggledRewriteLocalhost({ isChecked }),
        },
        h,
      ),
      textRow(
        {
          id: 'settings-branch-prefix',
          title: 'New branch prefix',
          description:
            'bb puts this in front of every branch it creates for a worktree, such as elianiva/fix-login-flow-thr_ab12cd34ef. Leave it empty for no prefix.',
          value: model.branchPrefix,
          onInput: (value) => Message.ChangedBranchPrefix({ value }),
          isMonospace: true,
        },
        h,
      ),
      toggleRow(
        {
          id: 'settings-streamer-mode',
          title: 'Streamer mode',
          description:
            'Hide the custom models from config.json in every model picker, so a screen share does not show them.',
          isChecked: model.streamerMode,
          onToggle: (isChecked) => Message.ToggledStreamerMode({ isChecked }),
        },
        h,
      ),
    ],
    h,
    [h.Class('divide-y divide-border/60 px-4')],
  )

const skillsCard = (h: HtmlBuilder<Message>): Html =>
  card(
    [
      h.div(
        [h.Class('flex items-start justify-between gap-4 py-2.5')],
        [
          h.div(
            [h.Class('flex min-w-0 flex-col gap-0.5')],
            [
              h.div(
                [h.Class('flex items-center gap-2')],
                [
                  h.span([h.Class('text-sm')], ['bb CLI skills']),
                  badge({ variant: 'outline' }, ['Not installed'], h),
                ],
              ),
              h.span(
                [h.Class('text-xs text-muted-foreground')],
                [
                  'Install them into ~/.agents/skills and ~/.claude/skills so agents outside bb can use the bb CLI.',
                ],
              ),
            ],
          ),
          button(
            {
              onClick: Message.ClickedInstallSkills(),
              variant: 'outline',
              size: 'sm',
              attributes: [h.DataAttribute('settings-install-skills', '')],
            },
            ['Install'],
            h,
          ),
        ],
      ),
    ],
    h,
    [h.Class('px-4')],
  )

const voiceCard = (model: Model, h: HtmlBuilder<Message>): Html =>
  card(
    [
      h.div(
        [h.Class('flex items-start justify-between gap-4 py-2.5')],
        [
          h.div(
            [h.Class('flex min-w-0 flex-col gap-0.5')],
            [
              h.span([h.Class('text-sm')], ['Microphone']),
              h.span([h.Class('text-xs text-muted-foreground')], ['No microphones found.']),
            ],
          ),
          h.div(
            [h.Class('relative shrink-0')],
            [
              h.select(
                [
                  h.Id('settings-microphone'),
                  h.Value(model.microphone),
                  h.OnChange((value) => Message.SelectedMicrophone({ value })),
                  h.AriaLabel('Microphone'),
                  h.Class(
                    'h-8 appearance-none rounded-lg border border-border/60 bg-background pr-8 pl-8 text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  ),
                ],
                [{ value: 'system', label: 'System default' }].map((option) =>
                  h.option(
                    [
                      h.Value(option.value),
                      ...(option.value === model.microphone ? [h.Selected(true)] : []),
                    ],
                    [option.label],
                  ),
                ),
              ),
              h.span(
                [
                  h.Class(
                    'pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground',
                  ),
                ],
                [icon(h, Mic, 'size-3.5')],
              ),
            ],
          ),
        ],
      ),
    ],
    h,
    [h.Class('px-4')],
  )

const debugCard = (model: Model, h: HtmlBuilder<Message>): Html =>
  card(
    [
      toggleRow(
        {
          id: 'settings-show-diagnostics',
          title: 'Show diagnostic events',
          description:
            'Show provider environment resolution and unhandled provider events for troubleshooting.',
          isChecked: model.showDiagnostics,
          onToggle: (isChecked) => Message.ToggledShowDiagnostics({ isChecked }),
        },
        h,
      ),
    ],
    h,
    [h.Class('px-4')],
  )

const refreshButton = (h: HtmlBuilder<Message>): Html =>
  button(
    {
      onClick: Message.ClickedRefreshMicrophones(),
      variant: 'ghost',
      size: 'icon-sm',
      attributes: [
        h.AriaLabel('Refresh microphones'),
        h.DataAttribute('settings-refresh-microphones', ''),
      ],
    },
    [icon(h, RotateCw, 'size-4')],
    h,
  )

export const view = defineView<Model, Message>((model, h) =>
  h.div(
    [h.DataAttribute('settings-page', 'general'), h.Class('flex flex-col gap-6')],
    [
      h.section(
        [h.AriaLabel('General')],
        [section({ title: 'General' }, h), generalCard(model, h)],
      ),
      h.section([h.AriaLabel('Skills')], [section({ title: 'Skills' }, h), skillsCard(h)]),
      h.section(
        [h.AriaLabel('Voice Input')],
        [section({ title: 'Voice Input', action: refreshButton(h) }, h), voiceCard(model, h)],
      ),
      h.section([h.AriaLabel('Debug')], [section({ title: 'Debug' }, h), debugCard(model, h)]),
    ],
  ),
)
