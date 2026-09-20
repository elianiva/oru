import { Option, Predicate, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import * as Update from 'foldkit/update'
import { type ComposerProps, type UiSignal } from '@oru/ui'
import { PERSONAL_PROJECT_ID } from '@oru/kernel'
import * as AccessPicker from './access-picker.ts'
import * as BranchPicker from './branch-picker.ts'
import * as Composer from './composer.ts'
import * as ModelPicker from './model-picker.ts'
import * as ProjectPicker from './project-picker.ts'
import * as WorkspacePicker from './workspace-picker.ts'

/**
 * The composer slot's definition: the draft, every picker, and the submit
 * intent, owned end to end. This is root's former composer logic lifted
 * across the slot boundary: the folds, the submit intent, and the slot
 * wiring are unchanged, but host facts arrive as props and forwarded
 * messages instead of sibling submodels, and the submit emits an intent
 * instead of executing a command.
 */

export const Model = Schema.Struct({
  composer: Composer.Model,
  picker: ModelPicker.Model,
  projectPicker: ProjectPicker.Model,
  workspace: WorkspacePicker.Model,
  branch: BranchPicker.Model,
  access: AccessPicker.Model,
  /**
   * What the last absorbed props carried. Props are facts for the view;
   * `absorbProps` diffs them against this snapshot to fold edge-triggered
   * state (a fresh catalogue, a created project) without a second channel.
   */
  mounted: Schema.Boolean,
  seen: Schema.Struct({
    projects: Schema.Array(Schema.String),
    options: Schema.Unknown,
  }),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  GotComposer: { message: Composer.Message },
  GotPicker: { message: ModelPicker.Message },
  GotProjectPicker: { message: ProjectPicker.Message },
  GotWorkspace: { message: WorkspacePicker.Message },
  GotBranch: { message: BranchPicker.Message },
  GotAccess: { message: AccessPicker.Message },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  /**
   * The picks travel with the text; `project` is the picker's raw
   * selection and may be absent, so root applies the list fallback
   * (picked-while-listed, otherwise the host's first) before sending.
   */
  Submitted: {
    project: Schema.optional(Schema.NonEmptyString),
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
    cwd: Schema.optional(Schema.String),
    text: Schema.NonEmptyString,
  },
  OptionsRequested: { refresh: Schema.Boolean },
  ConfigureRequested: {
    harness: Schema.UndefinedOr(Schema.String),
    model: Schema.UndefinedOr(Schema.String),
    reasoning: Schema.UndefinedOr(Schema.String),
  },
  CopyRequested: { command: Schema.String },
  RequestedCreateDialog: {},
})
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  composer: Composer.init(),
  picker: ModelPicker.init(),
  projectPicker: ProjectPicker.init(),
  workspace: WorkspacePicker.init(),
  branch: BranchPicker.init(),
  access: AccessPicker.init(),
  mounted: false,
  seen: { projects: [], options: undefined },
})

type AreaReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>
type AreaStep = Update.StepWithOutMessage<Model, Message, OutMessage>

const submitIntent = (model: Model, text: string): AreaReturn => {
  const options = ModelPicker.loadedOptions(model.picker)
  const cwd = WorkspacePicker.selectedCwd(model.workspace)
  return {
    model,
    outMessage:
      cwd === undefined
        ? OutMessage.Submitted({
            project: model.projectPicker.selected,
            harness: model.picker.selection.harness ?? options?.harness,
            model: model.picker.selection.model ?? options?.config.model,
            reasoning: model.picker.selection.reasoning ?? options?.config.reasoning,
            text,
          })
        : OutMessage.Submitted({
            project: model.projectPicker.selected,
            harness: model.picker.selection.harness ?? options?.harness,
            model: model.picker.selection.model ?? options?.config.model,
            reasoning: model.picker.selection.reasoning ?? options?.config.reasoning,
            cwd,
            text,
          }),
  }
}

const foldComposer = Update.foldChild({
  update: Composer.update,
  read: (model: Model) => Option.some(model.composer),
  write: (model, nextChild) => evo(model, { composer: () => nextChild }),
  toParentMessage: (message: Composer.Message) => Message.GotComposer({ message }),
  foldOutMessage: (outMessage: Composer.OutMessage): AreaStep =>
    Composer.OutMessage.match<AreaStep>(outMessage, {
      Submitted:
        ({ text }) =>
        (current) =>
          submitIntent(current, text),
    }),
})

const foldPicker = Update.foldChild({
  update: ModelPicker.update,
  read: (model: Model) => Option.some(model.picker),
  write: (model, nextChild) => evo(model, { picker: () => nextChild }),
  toParentMessage: (message: ModelPicker.Message) => Message.GotPicker({ message }),
  foldOutMessage: (outMessage: ModelPicker.OutMessage): AreaStep =>
    ModelPicker.OutMessage.match<AreaStep>(outMessage, {
      OptionsRequested:
        ({ refresh }) =>
        (model) => ({
          model,
          outMessage: OutMessage.OptionsRequested({ refresh }),
        }),
      // A picker on home has no thread to configure yet: the selection it
      // stored is the choice that thread is created with.
      ConfigureRequested:
        ({ harness, model: chosen, reasoning }) =>
        (model) => ({
          model,
          outMessage: OutMessage.ConfigureRequested({ harness, model: chosen, reasoning }),
        }),
      CopyRequested:
        ({ command }) =>
        (model) => ({
          model,
          outMessage: OutMessage.CopyRequested({ command }),
        }),
    }),
})

const foldProjectPicker = Update.foldChild({
  update: ProjectPicker.update,
  read: (model: Model) => Option.some(model.projectPicker),
  write: (model, nextChild) => evo(model, { projectPicker: () => nextChild }),
  toParentMessage: (message: ProjectPicker.Message) => Message.GotProjectPicker({ message }),
  foldOutMessage: (outMessage: ProjectPicker.OutMessage): AreaStep =>
    ProjectPicker.OutMessage.match<AreaStep>(outMessage, {
      RequestedCreateDialog: () => (model) => ({
        model,
        outMessage: OutMessage.RequestedCreateDialog(),
      }),
    }),
})

const foldWorkspace = Update.foldChild({
  update: WorkspacePicker.update,
  read: (model: Model) => Option.some(model.workspace),
  write: (model, nextChild) => evo(model, { workspace: () => nextChild }),
  toParentMessage: (message: WorkspacePicker.Message) => Message.GotWorkspace({ message }),
  foldOutMessage: (): AreaStep => (model) => ({ model }),
})

const foldBranch = Update.foldChild({
  update: BranchPicker.update,
  read: (model: Model) => Option.some(model.branch),
  write: (model, nextChild) => evo(model, { branch: () => nextChild }),
  toParentMessage: (message: BranchPicker.Message) => Message.GotBranch({ message }),
})

const foldAccess = Update.foldChild({
  update: AccessPicker.update,
  read: (model: Model) => Option.some(model.access),
  write: (model, nextChild) => evo(model, { access: () => nextChild }),
  toParentMessage: (message: AccessPicker.Message) => Message.GotAccess({ message }),
})

export const update = (model: Model, message: Message): AreaReturn =>
  Message.match<AreaReturn>(message, {
    GotComposer: ({ message: childMessage }) => foldComposer(model, childMessage),
    GotPicker: ({ message: childMessage }) => foldPicker(model, childMessage),
    GotProjectPicker: ({ message: childMessage }) => foldProjectPicker(model, childMessage),
    GotWorkspace: ({ message: childMessage }) => foldWorkspace(model, childMessage),
    GotBranch: ({ message: childMessage }) => foldBranch(model, childMessage),
    GotAccess: ({ message: childMessage }) => foldAccess(model, childMessage),
  })

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * Point an undecided composer at Personal: the host seeds it, so a submit
 * with no explicit pick carries its id instead of failing on no project.
 */
const selectPersonal = (area: Model, ids: readonly string[]): Model =>
  area.projectPicker.selected === undefined && ids.includes(PERSONAL_PROJECT_ID)
    ? foldProjectPicker(area, ProjectPicker.Message.SelectedOption({ option: PERSONAL_PROJECT_ID }))
        .model
    : area

/**
 * Fold host facts that arrived as props into state, silently and without
 * out-messages: a fresh catalogue replays the picker's arrival arms, a
 * project added after mount selects itself the way a creation did, and a
 * selection the list no longer carries clears the way a deletion did. An
 * unchanged props value returns the identical model, so memoization holds.
 */
const workspacePaths = (model: Model): readonly string[] =>
  model.workspace.workspaces.map((row) => row.path)

const syncWorkspaces = (current: Model, props: ComposerProps): Model => {
  const rows = props.workspaces.map((row) => ({
    path: row.path,
    branch: row.branch,
    isCurrent: row.isCurrent,
    provider: row.provider,
  }))
  const prev = workspacePaths(current)
  const next = rows.map((row) => row.path)
  if (sameIds([...prev], [...next])) return current
  return foldWorkspace(current, WorkspacePicker.Message.WorkspacesArrived({ workspaces: rows }))
    .model
}

export const absorbProps = (model: Model, props: ComposerProps): Model => {
  const ids = props.projects.map((project) => project.id)
  if (model.mounted && props.options === model.seen.options && sameIds(model.seen.projects, ids)) {
    return syncWorkspaces(model, props)
  }
  if (!model.mounted) {
    // Mount is not a creation: every project looks added against the empty
    // snapshot, so only the options arrival folds here. The catalogue often
    // wins the race against the bundle import, and recording it without
    // folding would leave the picker on Loading with a snapshot that says
    // Loaded, so a reload shows the fallback label forever.
    let current: Model = evo(model, { mounted: () => true })
    if (Predicate.isTagged(props.options, 'Loaded')) {
      current = foldPicker(
        current,
        ModelPicker.Message.OptionsArrived({ options: props.options.options }),
      ).model
    } else if (Predicate.isTagged(props.options, 'Unreachable')) {
      current = foldPicker(
        current,
        ModelPicker.Message.OptionsFailed({ reason: props.options.reason }),
      ).model
    }
    const mounted = selectPersonal(
      evo(current, {
        seen: () => ({ projects: ids, options: props.options }),
      }),
      ids,
    )
    return syncWorkspaces(mounted, props)
  }
  let current = model
  if (props.options !== model.seen.options) {
    if (Predicate.isTagged(props.options, 'Loaded')) {
      current = foldPicker(
        current,
        ModelPicker.Message.OptionsArrived({ options: props.options.options }),
      ).model
    } else if (Predicate.isTagged(props.options, 'Unreachable')) {
      current = foldPicker(
        current,
        ModelPicker.Message.OptionsFailed({ reason: props.options.reason }),
      ).model
    } else {
      current = evo(current, { picker: () => ModelPicker.init() })
    }
  }
  const prev = new Set(model.seen.projects)
  const added = ids.filter((id) => !prev.has(id))
  const created = added.length === 0 ? undefined : props.projects.find((p) => p.id === added[0])
  if (created !== undefined) {
    current = foldProjectPicker(
      current,
      ProjectPicker.Message.ProjectCreated({ project: created }),
    ).model
  }
  const selected = current.projectPicker.selected
  if (selected !== undefined && !ids.includes(selected)) {
    current = foldProjectPicker(
      current,
      ProjectPicker.Message.ProjectDeleted({ project: selected }),
    ).model
  }
  const settled = selectPersonal(
    evo(current, {
      seen: () => ({ projects: ids, options: props.options }),
    }),
    ids,
  )
  return syncWorkspaces(settled, props)
}

/** Deliver a one-shot signal root cannot construct messages for. */
export const signal = (model: Model, incoming: UiSignal): Model => {
  if (incoming.type !== 'restore-draft') return model
  return foldComposer(model, Composer.Message.ChangedDraft({ value: incoming.text })).model
}

/**
 * What the composer box holds. Every slot is a submodel the area owns;
 * adding a picker is one `h.submodel` line here, never a change to the
 * composer. The project list is plain props, so it crosses the slot
 * boundary while the picker's selection stays inside it.
 */
const composerInputs = (
  model: Model,
  props: ComposerProps,
  h: HtmlBuilder<Message>,
): Composer.ViewInputs => {
  const inputs: Composer.ViewInputs = {
    placeholder: props.placeholder,
    toLeading: () =>
      h.submodel({
        slotId: 'model-picker-trigger',
        model: model.picker,
        view: ModelPicker.triggerView,
        toParentMessage: (childMessage) => Message.GotPicker({ message: childMessage }),
      }),
    toChipsLeft: () =>
      h.div(
        [h.Class('flex flex-wrap items-center gap-1')],
        [
          h.submodel({
            slotId: 'project-picker',
            model: model.projectPicker,
            view: ProjectPicker.view,
            viewInputs: {
              projects: props.projects,
              isLoading: props.projectsLoading,
            },
            toParentMessage: (childMessage) => Message.GotProjectPicker({ message: childMessage }),
          }),
          h.submodel({
            slotId: 'workspace-picker',
            model: model.workspace,
            view: WorkspacePicker.view,
            toParentMessage: (childMessage) => Message.GotWorkspace({ message: childMessage }),
          }),
          h.submodel({
            slotId: 'branch-picker',
            model: model.branch,
            view: BranchPicker.view,
            toParentMessage: (childMessage) => Message.GotBranch({ message: childMessage }),
          }),
        ],
      ),
    toChipsRight: () =>
      h.submodel({
        slotId: 'access-picker',
        model: model.access,
        view: AccessPicker.view,
        toParentMessage: (childMessage) => Message.GotAccess({ message: childMessage }),
      }),
  }
  if (props.headline === undefined) return inputs
  return { ...inputs, headline: props.headline }
}

const composerSlot = (model: Model, props: ComposerProps, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'composer',
    model: model.composer,
    view: Composer.view,
    viewInputs: composerInputs(model, props, h),
    toParentMessage: (childMessage) => Message.GotComposer({ message: childMessage }),
  })

/**
 * The harness's health, above the composer. The picker's catalogue lives in
 * the composer's `leading` slot; a harness that is not ready still renders
 * here without opening anything.
 */
const pickerStatusSlot = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'model-picker-status',
    model: model.picker,
    view: ModelPicker.view,
    toParentMessage: (childMessage) => Message.GotPicker({ message: childMessage }),
  })

export const view = defineView<Model, Message, ComposerProps>((model, props, h) =>
  h.div(
    [h.Class('flex w-full flex-col items-center gap-6')],
    [pickerStatusSlot(model, h), composerSlot(model, props, h)],
  ),
)
