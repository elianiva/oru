# oru's tools become pi tools; pi keeps its own

The bridge renders oru's toolkit into pi tool definitions — JSON Schema draft-2020-12 to TypeBox, the conversion bb's extension already carries — and registers them in the injected extension. A pi call for one of those tools is forwarded to the bridge, executed there through effect-uai's toolkit (`Tool.decodeCallInput` plus `Toolkit.run`), and the result is returned to pi over the channel. pi's built-in tools stay enabled, and their executions are translated into the same facts. `--no-builtin-tools` is the opt-out for when oru ships coding tools of its own; the bridge passes it when `ORU_PI_NO_BUILTIN_TOOLS` is set, and pi's extension and custom tools stay loaded either way.

The runtime rule that keeps both execution paths honest: a tool call that arrives in an assembled turn paired with its `tool_call_output` (same `call_id`) was executed by the harness. The runtime appends `tool/requested` and `tool/completed` in turn order and derives no `RunTool` work from it. A call without an output stays the runtime's work, so `harness-oru` and every model-turn harness keep working unchanged. Whether a call succeeded is pi's to report: `tool_execution_end` carries `isError`, and the bridge forwards it as a lifecycle `ToolResult`, which is what lets `tool/completed` say a tool failed instead of assuming it did not.

## Considered options

- **Disable pi's built-ins until oru owns coding tools**: one execution path and uniform log semantics, but a coding agent that cannot read a file on day one.
- **Keep pi's built-ins and hide oru's tools from pi**: the agent does its own thing and oru's tool plugins stop mattering.
- **Both, with the bridge executing oru's tools and translating pi's internal ones** (chosen): bb's behaviour, and both paths land in the log as the same vocabulary.

## Consequences

- Two execution paths coexist and are told apart by who runs the call, not by how it is recorded. pi writes every call and its result into its own session, so pi's built-ins and the calls the extension forwards land in oru's log as the same paired facts. A tool oru executes also reports progress through `ToolEvent.Progress`; the bridge forwards that as a live `ToolCallArgsDelta` signal, so a long call is visible while it runs. That reuse is deliberate: effect-uai's turn vocabulary has no tool-progress variant, so the alternative was dropping it. Progress is never a log fact.
- pi's own streaming tool output (`tool_execution_update`, a bash command's live output) has no variant to reuse and is understood-and-dropped rather than reported as unhandled. A host that wants it needs a progress item in the turn vocabulary, which belongs upstream.
- pi's built-ins run under pi's own permission model, which oru's approval story does not yet cover. That is a known gap, not an accident.
- The JSON Schema to TypeBox converter is a fidelity surface: it carries descriptions, defaults, and the numeric and string keywords, and degrades unsupported shapes to `Type.Unknown` rather than throwing. It is tested against oru's real descriptors.
- Order matters when appending a turn's facts. Walking the turn's items in order leaves the fold idle when the run ends on an assistant message, and leaves exactly the unexecuted calls pending.
- Live output needs a consumer, so `ThreadRpc` gains a turn-event stream and the thread pane renders text, thinking, and tool output as they arrive. `tool_execution_end` becomes a `tool end` signal to the pane and a `ToolResult` lifecycle fact to the runtime, from the same event.
