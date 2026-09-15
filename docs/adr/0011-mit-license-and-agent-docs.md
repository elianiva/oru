# MIT license, and no AGENTS.md

The repository is public. Without a license the default is all rights reserved, so nobody can legally reuse the code. Agents already have CONTEXT.md and docs/adr/. A second agent primer would duplicate them.

## Considered options

- **Keep the default (all rights reserved)**: the public clone cannot be reused. Rejected.
- **A copyleft license (GPL family)**: would force derivative hosts onto the same terms. oru is a control plane others may embed. Rejected.
- **Apache-2.0**: patent grant with more text than this repo needs. Rejected for now.
- **MIT** (chosen): the same terms bb uses. Short, permissive, enough for a public unfinished project.
- **Add AGENTS.md**: a third onboarding file next to CONTEXT.md and docs/adr/. Rejected.
- **CONTEXT.md plus docs/adr/** (chosen): the glossary and the decisions already tell an agent how to work here.

## Consequences

`LICENSE` at the repo root is MIT, copyright Dicha Zelianivan Arkana, 2026. The root `package.json` declares `"license": "MIT"`. Do not add AGENTS.md unless CONTEXT.md and the ADRs stop being enough.
