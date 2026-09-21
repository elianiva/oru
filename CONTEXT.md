# oru

oru is an agent control plane: a kernel of composable plugins that owns its tools, sessions, and UI, and reaches models through harness bridges. Everything is a plugin. For the view, everything is a submodel.

## Language

**Kernel** (`@oru/kernel`):
The Effect-based composition runtime. It holds contexts, resolves coeffects, activates plugins, and reverses their contributions on deactivation.
_Avoid_: framework, core, engine

**Context**:
The per-plugin handle `apply` receives: it reads contributions, registers services and data, and runs disposers. Activation and reversal are mediated through it.
_Avoid_: environment, container, service locator

**Plugin**:
An independently loadable unit with one identity that reads services and contributes runtime services, UI, or both through `apply`. A plugin is composed of one or more facets.
_Avoid_: extension, module, addon

**Facet**:
A part of a plugin bundled for one environment, such as a server facet or a presentation facet. Facets of one plugin share its identity and inject but load separately.
_Avoid_: entrypoint, bundle

**Service**:
A typed capability registered on the kernel and addressed by a stable token. One provider, many consumers.
_Avoid_: module, dependency, API

**Provider** / **Consumer**:
The two roles a plugin takes toward a service. The provider registers an implementation through `ctx.provide`; consumers read it.
_Avoid_: server/client (those name facet kinds)

**Inject**:
A service a plugin reads. The kernel holds the plugin pending until every inject is satisfied, and unloads it when one disappears.
_Avoid_: coeffect, requirement, dependency, needs

**Contribution**:
Everything a plugin adds from `apply`: services, tools, submodels, listeners. Every contribution is reversible on deactivation.
_Avoid_: effect, registration, side effect

**Activation** / **Deactivation**:
The transitions that make a plugin's contributions live, and reverse them.
_Avoid_: mount/unmount, start/stop

**Scope**:
The level at which a plugin activates and its contributions apply: host-global or per-thread. Threads are flat and do not inherit from a parent thread.
_Avoid_: namespace, layer, realm

**Host**:
One assembled kernel instance with its resolved graph of plugins and services. A host process assembles and serves one, over a transport its clients speak; a presentation facet is a client of that process, not a co-resident.
_Avoid_: app, server, runtime

**Config**:
The host's Effect Config stack and `config.json` under `--home` / `ORU_HOME` / `~/.oru`. Flags beat the file, the file beats the environment, the environment beats defaults. Every stored key is startup-only.
_Avoid_: settings service, preferences

**Plugin config**:
The Schema a plugin declares as `Config` and the data the host decodes against it and hands to `apply`. Plain startup data, never services.
_Avoid_: config service, factory parameter

**Runtime**:
The host's turn driver, composed as a plugin: it folds the session log, derives turn work, asks the active harness for deltas, and records the facts. Distinct from the Kernel, which composes plugins.
_Avoid_: engine; calling the Runtime itself a harness

**Harness**:
The contract through which the runtime reaches a model or another agent. `@oru/harness` owns the vocabulary: history items, the delta grammar, tool descriptors, and the assembler that turns deltas into facts. A host registers many harnesses, and a thread picks one.
_Avoid_: provider, adapter

**Bridge**:
A harness that drives something outside the host — a foreign agent's process and protocol — and translates its events into oru's delta grammar. A bridge may own its conversation, in which case the session log is its trace rather than its memory.
_Avoid_: integration, connector

**Agent**:
A running agent loop scoped to one session. It streams model turns, runs tool calls, and holds live state by folding the session log. Continuation is that fold.
_Avoid_: worker, actor, bot

**Tool**:
A model-facing capability registered as a contribution: a name, a description, an Effect Schema, and a `runJson` that takes arguments JSON and returns result text. The runtime hands its JSON Schema to the harness; the harness renders it into its provider's own tool shape.
_Avoid_: action, function, command

**Session**:
An immutable, append-only log of an agent's work and the trace of its run. The kernel owns it; runtime state is a projection of it.
_Avoid_: conversation, transcript

**Projection**:
State derived by folding the session log rather than stored on its own.
_Avoid_: snapshot, cache

**Thread**:
The user-facing unit of work. A thread belongs to a project, owns a session tree, and may spawn a subagent thread. Threads are flat and do not inherit tools from a parent.
_Avoid_: conversation, task

**Project**:
A named workspace on the host: `name`, `cwd`, and later metadata. One host holds many projects. Every thread and its subagents use that project's cwd until a later per-thread override exists.
_Avoid_: repo, folder, workspace (the host is not the project)

**Subagent**:
A thread spawned by another thread, its parent. It uses the same machinery as a top-level thread and is seen through the parent relationship.
_Avoid_: child process, worker

**Submodel**:
The unit of UI composition: a Foldkit Model, Messages, update, and OutMessages. A plugin's presentation facet contributes one or more submodels.
_Avoid_: component, widget, view

**Slot**:
A named UI surface the host owns that plugin submodels mount into, such as the composer or the conversation. Exclusive slots hold one submodel, additive slots hold many in deterministic order.
_Avoid_: outlet, mount point, placeholder

**Panel**:
The host-owned tab strip beside a thread: the launcher, the tab order, and which tab is active. Plugin submodels fill tabs through the additive `panel` slot; the host never renders tab content itself.
_Avoid_: sidebar, drawer, right panel (as a bare noun — say what of it: strip, tab, launcher)

**Panel tab**:
One open instance of a panel-slot definition, such as a single terminal. The host owns its identity and lifetime; the plugin owns what it shows. Closing the tab ends the instance.
_Avoid_: window, pane, view

**Terminal**:
A panel tab showing a live shell: restty renders it in the browser from PTY bytes, one pane per tab. Splits inside a tab duplicate the tab strip and do not exist.
_Avoid_: console, shell (as a noun for the tab — the shell is the process it shows)

**PTY**:
The host-side shell process a terminal tab shows, spawned project-cwd-bound and killed when its tab closes. The browser never names a cwd; the host resolves it from the tab's project.
_Avoid_: tty, pty session (as a user word — the user sees a terminal)
