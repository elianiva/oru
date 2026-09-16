# A host that stops, in a real browser

One agent-browser run against `pnpm dev`'s two halves started by hand (host on
7417, Vite on 5499 with `ORU_PROXY_TARGET=http://127.0.0.1:7417`). The host was
killed with the page open, then reloaded; the page errors and console were read
straight after the `Host unreachable` state appeared.

```
$ agent-browser open http://127.0.0.1:5499/
$ agent-browser wait --text "What should we build in oru?"
$ agent-browser console --clear
$ agent-browser errors --clear
$ kill <host pid>
$ agent-browser reload
$ agent-browser wait --text "Host unreachable"

$ agent-browser errors
                                  # no page errors at all

$ agent-browser console
[debug] [vite] connecting...
[debug] [vite] connected.
                                  # nothing from the app: no defect, no crash
```

Then the host was started again on the same journal, `[data-host-retry]` was
clicked, and the app came back:

```
$ agent-browser click "[data-host-retry]"
$ agent-browser wait --text "What should we build in oru?"
$ agent-browser get count '[data-host-unreachable]'
0
$ agent-browser get count '[data-main]'
1
$ agent-browser errors
                                  # still no page errors
```

`screenshots 04-host-unreachable.png` and `05-retry-recovered.png` are from the
same run.
