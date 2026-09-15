# oru

oru is an agent control plane: a kernel of composable plugins that runs on effect-uai for the model-facing agent loop, and owns its own tools, sessions, and UI. Everything is a plugin. For the view, everything is a submodel.

## Language

**Kernel** (`@oru/kernel`):
The Effect-based composition runtime. It holds contexts, resolves coeffects, activates plugins, and reverses their contributions on deactivation.
_Avoid_: framework, core, engine

**Context**:
The per-plugin handle used to declare coeffects and register contributions. Activation and reversal are mediated through it.
_Avoid_: environment, container, service locator

**Plugin**:
An independently loadable unit with one identity that contributes runtime services, UI, or both. A plugin is composed of one or more facets.
_Avoid_: extension, module, addon

**Facet**:
A part of a plugin bundled for one environment, such as a server facet or a presentation facet. Facets of one plugin share its identity and coeffects but load separately.
_Avoid_: entrypoint, bundle

**Service**:
A typed capability registered on the kernel and addressed by a stable token. One provider, many consumers.
_Avoid_: module, dependency, API

**Provider** / **Consumer**:
The two roles a plugin takes toward a service. The provider registers an implementation; consumers require it.
_Avoid_: server/client (those name facet kinds)

**Coeffect**:
A dependency a plugin declares. The kernel activates the plugin only while every coeffect is satisfied, and deactivates it when one disappears.
_Avoid_: requirement, dependency, injection

**Contribution**:
Everything a plugin adds to the context: services, tools, submodels, listeners. Every contribution is reversible on deactivation.
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

**Runtime**:
The agent execution layer: effect-uai's model and tool primitives, used by a built-in inference plugin that folds the session log. Distinct from the Kernel, which composes plugins.
_Avoid_: engine; calling the Runtime itself a harness — a harness is what reaches it

**Harness**:
The seam through which the agent loop reaches a model or another agent. The runtime is one harness; a bridge to a foreign agent is another. A host registers many, and a thread picks one.
_Avoid_: provider, adapter

**Bridge**:
A harness that drives something outside the runtime — a foreign agent's process and protocol — and translates its events into oru's vocabulary. A bridge may own its conversation, in which case the session log is its trace rather than its memory.
_Avoid_: integration, connector

**Agent**:
A running agent loop scoped to one session. It streams model turns, runs tool calls, and holds live state by folding the session log. Continuation is that fold, not effect-uai's `Loop`.
_Avoid_: worker, actor, bot

**Tool**:
A model-facing capability registered as a contribution and exposed to the agent loop as an effect-uai `Tool`.
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
