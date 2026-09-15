# Missed invariants

Every bug that escaped gets a row. The row names the invariant, why existing tests missed it, and the guard that now fails when it happens again. Add a row when a hotfix lands. Do not add hypotheticals.

## Ledger

### The shipped view was a chat stub while tests imported the real composition

- **Commit.** `969eb5b` (`oru: render the live plugin graph instead of the chat stub`), issue #11.
- **Invariant missed.** The Foldkit `view` the browser mounts is the live plugin graph: logging toggle, keyed plugin panels, thread pane, services. A `chatStub` that paints fixture chrome is not that view.
- **Why tests and the manual runbook missed it.** `apps/oru/test/root-view.test.ts` imported `wiredView` (later `view`) from `root.ts` and asserted the composition. `apps/oru/src/entry.ts` mounted `chatStub`. The Scene tests stayed green. PLAN.md asked for a browser check and none ran in CI, so the stub shipped.
- **Guard.** `apps/oru/test/shipped-view.test.ts` asserts a UI outcome on `view` (`[data-logging-toggle]` and `Turn logging on`) and asserts the stub copy is absent (`chat stub` is not in the tree). Both assertions fail if `view` returns the stub. The same file reads `entry.ts` and requires that file to import `view` from `./root.ts`, so pointing the runtime at a different function fails too. Playwright `apps/oru/e2e/browser.spec.ts` drives the logging toggle and send a message on the page `entry.ts` actually mounts.
