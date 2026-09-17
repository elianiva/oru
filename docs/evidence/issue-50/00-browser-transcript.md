# The harness and the model, in a real browser

Two agent-browser runs against a real host and a hand-started Vite. The first
host had `pi` 0.85.1 on `PATH` and an `ORU_HOME` of its own (no
`~/.oru/config.json`), so the picker drew pi's real catalogue. The second host
was started with `ORU_PI_COMMAND=/nonexistent/pi`, so the same app had to render
a harness that is not ready.

## The picker over pi's real catalogue

```
$ ORU_HOME=/tmp/oru-evidence-50/home node apps/host/src/main.ts --port 0 --journal …/oru.db
oru host listening on http://127.0.0.1:53699
$ ORU_PROXY_TARGET=http://127.0.0.1:53699 pnpm exec vite --port 5200
$ node seed-evidence.mjs http://127.0.0.1:53699       # a real project and thread
mu4m4k03-ymkykiai

$ agent-browser open http://127.0.0.1:5200/thread/mu4m4k03-ymkykiai
$ agent-browser click "[data-composer-action=model]"
$ agent-browser get count "[data-model-row]"
528
$ agent-browser get count "[data-model-group]"
7
$ agent-browser fill "[data-model-search]" "deepseek"
$ agent-browser get count "[data-model-row]"
31
$ agent-browser click "[data-model-row='deepseek/deepseek-v4-pro']"
$ agent-browser get text "[data-composer-action=model]"
DeepSeek V4 Pro
$ agent-browser reload
$ agent-browser get text "[data-composer-action=model]"
DeepSeek V4 Pro
```

The harness was the host's default, not the scripted double: a separate probe of
the same host with no configuration returned `harness: "pi"` and 507 models
across `deepseek`, `github-copilot`, `kimi-coding`, `openai-codex`, `opencode`,
`opencode-go`, and `openrouter`, with the account's default marked
`isDefault: true` on `opencode-go/muse-spark-1.3-contributor`.

- `01-picker-open-real-pi-catalogue.png` — the harness fact (`pi`, `ready`), the
  search box, the reasoning levels for the effective model, and the first
  provider groups.
- `02-picker-search-deepseek.png` — the search narrows 528 rows to 31 across four
  providers, and never shows a model the harness did not report.
- `03-model-chosen.png` — the panel closes and the composer names
  `DeepSeek V4 Pro`.
- `04-reloaded-same-model-selected.png` — after a reload the same model is still
  named, because it is the thread's own `thread/configured` fact.
- `07-harness-default-marked.png` — a query of `1.3-contributor` groups three
  providers and marks the harness default with `Default`.

## A harness that is not ready

```
$ ORU_HOME=/tmp/oru-evidence-50/home-degraded ORU_PI_COMMAND=/nonexistent/pi \
    node apps/host/src/main.ts --port 0 --journal …/degraded.db
oru host listening on http://127.0.0.1:54294
$ ORU_PROXY_TARGET=http://127.0.0.1:54294 pnpm exec vite --port 5201
$ node seed-evidence.mjs http://127.0.0.1:54294
mu4m6y7q-slmbyckj

$ agent-browser open http://127.0.0.1:5201/thread/mu4m6y7q-slmbyckj
$ agent-browser get text "[data-harness-status]"
not_installed
$ agent-browser get text "[data-harness-message]"
pi is not on PATH
$ agent-browser get text "[data-harness-install]"
pi update self
$ agent-browser get text "[data-harness-copy]"
Copy
$ agent-browser get text "[data-harness-refresh]"
Re-check
$ agent-browser click "[data-harness-refresh]"                # re-reads past the health cache
$ agent-browser get url
http://127.0.0.1:5201/thread/mu4m6y7q-slmbyckj                # same page, no host restart
$ agent-browser click "[data-composer-action=model]"
$ agent-browser get text "[data-harness-label]"
pi
$ agent-browser get text "[data-model-empty]"
This harness reported no models
```

- `05-harness-not-ready-install-command.png` — the status, the message, the
  install command, Copy, and Re-check, above the composer.
- `06-harness-fact-and-empty-catalogue.png` — the picker with the harness fact
  and no catalogue, because the harness itself could not answer.

The command is rendered and copyable. Nothing in oru executes it (ADR-0007).
