# One persistent Chrome connection

## Current checkpoint — 17 September, 14:25 Bangkok

The user granted stopping the specific old Codex session and one singleton
connection. Codex40383 had already exited: the PID/start identity no longer
matches and no process needed stopping. No direct browser tools/runtimes were
found. Future-session settings remain disabled/native-only. Plugin enumeration
timed out in the combined preflight but a separate bounded query confirmed
both Chrome and Browser plugins disabled; the other six checks passed.

Exactly one authorized POST /connect was made through the existing PID14004
singleton. OS inspection saw only that one Chrome client while it was pending.
The attempt timed out without a connection. Subsequent health reports
disconnected/not connecting, and OS inspection at14:25:06 found zero clients.
No automatic retry, permission click, proxy restart or other-session stop was
performed. Another attempt requires fresh authorization while the user is at
Chrome to approve its prompt. The old parent is no longer the blocker; live
browser acceptance remains unavailable. Keep the historical incident record:
exited PID/start identities no longer trigger it, without erasing evidence.

### Historical recurrence — 15 September, 18:36 Bangkok

Another user-reported recurrence found direct Chrome tools85009/85052 and
browser-enabled runtimes85006/85030 under the same Codex40383. Its exact UTC
start identity and cwd `/Users/dom/src/heimdall-mr` still match the recorded
incident. After fresh ancestry checks, TERM was sent to85009,85006,85030;
worker85052 had already exited when rechecked. Parent40383, Chrome1337,
singleton14004 and Spooty's queues/media were preserved. No browser connection
or approval action was requested.

After containment all35 simulated/source tests pass. Live/config preflight is
6pass/1fail: the known stale parent remains, correctly preventing a clean bill
of health between child launches. All four saved-configuration checks pass.
The singleton is disconnected/not connecting. This is another confirmed live
bypass, not proof attributing an individual visible prompt. The parent's old
tool configuration still needs a verified reload or authorized session stop;
repeating child cleanup is not the permanent fix. Do not clear the incident
record, patch installed tool binaries, or silently restart the other session.

### Previous recurrence — 15 September, 17:48 Bangkok

The same parent40383 again launched direct Chrome tools77229/77271 and
browser-enabled runtimes77225/77249. All four were attributed to that parent
and their identities were rechecked before TERM was sent to those browser tools
only. At17:48:33 both live tool inspectors were empty; the singleton14004 was
still disconnected/not connecting, and the OS socket snapshot showed only
Chrome's listener. Saved configuration checks passed. The existing stale-parent
record correctly remains unresolved. Chrome, the parent agent and download
workers were not restarted. This is another containment action, not a permanent
fix or attribution of an individual displayed prompt. Restart/reload of the
specific older Codex session still needs authorization; do not treat another
empty child snapshot as resolution.

### Previous recurrence — 15 September, 17:10 Bangkok

Codex40383 in `/Users/dom/src/heimdall-mr` remains alive with the same start
time (14September12:46:17 Bangkok). During this recheck it again launched direct
Chrome connector20746/20876 and browser-enabled runtimes20741/20851. The launcher's
auto-connect flag was verified without exposing arguments. Exact ownership was
checked, then TERM was sent only to these four browser-tool processes. Parent
agent, Chrome, singleton and download workers were not restarted.

The previous six checks could all pass between these launches. The preflight
now also reads the owner's private `.codex/browser-session-quarantine.json`
incident record and matches PID **and UTC process start time**. It remains
non-green until the known stale parent exits or its tool configuration has a
verified reload. Exited/replaced/reused PIDs do not falsely flag a new process.
This record is a diagnostic gate, not an OS quarantine or automatic process
killer. Do not remove it merely to clear the warning.

All35 simulated/source regressions pass, including five stale-parent identity,
PID reuse and redaction tests. Live preflight correctly detected the recurring
tools and unresolved parent, while all four saved-configuration checks passed.
The singleton is disconnected/not connecting; no Chrome connection or permission
action was requested. A specific displayed prompt has not been correlated with
a socket event. Permanent remediation still requires a verified reload or
authorized restart of the other Codex session; repeated child termination is
containment only. Persistent server/plugin disablement follows the
[official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

All Chrome automation, including localhost UI QA, must use the existing HTTP
bridge at `http://127.0.0.1:17331`. Do not use direct Chrome MCP tools, a fresh
DevTools WebSocket, a second browser/profile, or an auto-connect fallback.

The bridge outlives agent sessions. First check `GET /health`; do not restart a
healthy bridge. Start it with Node20 only if no process owns the port:

```sh
node scripts/cdp-keepalive.mjs
```

Startup is disconnected and does **not** request Chrome permission. Health
checks and ordinary requests never connect. If Chrome was closed, restarted,
denied permission or the connection was lost, return a clear unavailable state
and continue non-browser work. Do not automatically reconnect in a loop.

Only after explicit user authorization for one Chrome connection:

```sh
curl --max-time 125 -sS http://127.0.0.1:17331/connect \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"allow-one-chrome-connection"}'
```

The user may need to approve Chrome once. Never click permission on their
behalf. Concurrent requests share the same pending connection. A timed-out
handshake is terminated, not left behind. Repeated explicit calls after failure
are not authorized by the original request.

## Existing HTTP interface

- `GET /health`: connection state and PID only; no browser side effect.
- `GET /targets`: inspect existing tabs over the singleton.
- `GET /tab`: reuse one background work tab; never steal focus.
- `POST /eval`: `{targetId, expression}`; result is `{value}`.
- `POST /cdp`: `{method, params, sessionId?}`; CDP response envelope.
- `POST /connect`: explicitly authorized single connection, as above.

Ordinary requests return503 while disconnected. Foreground target activation
is rejected. Cookies, tokens and other session material must never enter logs,
chat or Git. Avoid navigating any user/other-agent tab.

## Regression check

```sh
npm run test:cdp
```

Tests use simulated sockets and make no real Chrome connection. They cover
shared concurrent connection attempts, timeout cleanup, late approval/close
races, early failures, active disconnect, and read-only health checks. A polling
storm regression also sends100 ordinary HTTP requests after a failed handshake
and verifies that no second Chrome socket is created.

The same command also checks all application/script source for direct Chrome
connections outside this singleton. `.github/workflows/cdp-boundary.yml` runs
that dependency-free boundary check on pushes and pull requests. It does not
launch Chrome or access private data. This is a regression guard against known
bypass patterns, not a system-wide firewall against unrelated applications.

## Retired diagnostic scripts

Five historical helpers are intentionally inert (exit 2 with an explanation):
`attach-main-chrome.mjs`, `find-scroll.mjs`, `scrape-playlist-tracks.mjs`,
`resync-playlist-page.mjs`, and `audit-resync-one-tab.mjs`. They no longer contain
direct socket/isolated-browser code or write session/playlist files. The old
audit's unused direct-socket class is removed too. The supported CLI downloader,
web downloader and Spotify session API do not call these helpers.

- Metadata inspection: `node scripts/spotify-session.mjs playlist <id>`.
- Saved-library updates: **Sync Spotify library** / **Sync this playlist**.
- Browser diagnostics or explicitly requested cookie export: the existing
  authorized HTTP bridge only; never revive a historical attachment helper.

The web **Connect Chrome…** action asks separately before requesting one
connection. Page load, sync, status polling and failure recovery do not request
it. Approval in Chrome remains the user's action. Connecting alone does not
start metadata sync or MP3 downloads. This UI has unit/typecheck coverage;
live approval-flow verification remains intentionally pending.

On15September2026 the old singleton held five leaked sockets. It was replaced
while downloads and Spotify sync were idle. Direct Codex Chrome MCP processes
were stopped, and the persistent `claude-in-chrome` MCP and Chrome plugin were
disabled in `/Users/dom/.codex/config.toml`. The direct MCP launch command is
also `/usr/bin/false` with no auto-connect arguments, so it fails closed even
if a client ignores the disabled flag. Codex's `mcp get claude-in-chrome --json`
confirmed the effective configuration. The global
`/Users/dom/.codex/AGENTS.md` records the same rule for future sessions.

### Repeat-prompt investigation — 15 September, 13:37 Bangkok

The user reported more prompts. Read-only checks found the same singleton
PID14004, disconnected/not connecting. Its log had no connection attempt since
the replacement started at12:40 Bangkok. Over45 seconds,82 socket snapshots
showed only Chrome's listening socket and no debugging client. Effective Codex
configuration still reported the direct connector disabled with command
`/usr/bin/false`. All14 CDP/boundary tests passed, including the new failed-
handshake polling-storm regression. No real Chrome connection was requested.

These checks do **not** identify the source of a fresh prompt outside that
observation window, or prove a previously displayed prompt has disappeared.
Other running debugging tools were not connected to main Chrome in the sample;
do not blame or terminate unrelated sessions without evidence. Do not describe
this as a system-wide guarantee against every application's permission prompt.

### Alternate Codex browser routes — 15 September, 14:00 Bangkok

The earlier direct-connector disablement did not remove every available browser
route. Effective configuration still enabled the Browser plugin, a generic Node
REPL trusted browser service, and the unified CUA browser surface. These were
configuration gaps, not proof that one caused the newly reported prompt.

Global user configuration now disables the Browser plugin, removes the generic
REPL's trusted browser service, and overrides unified CUA to native-app-only
(`CUA_REPL_ENABLED_SURFACES=computer`). Native app control is preserved. The
Chrome plugin/direct MCP stay disabled. The override includes the installed
launcher path; if a product update changes that path, update the path while
preserving native-only mode, never restore the browser surface as a fallback.

```sh
npm run test:cdp-config
```

This additional local-only check inspects effective Codex settings and exercises
the installed launcher with a harmless stand-in executable. It verifies that
the runtime exposes no browser APIs/services without starting any browser or
native service. All4 configuration checks and14 existing CDP checks passed.
Do not run this owner-specific check in public CI or dump full MCP configuration
(unrelated servers can contain secrets).

The singleton PID14004 was left untouched and disconnected. A90-second passive
watch ending14:00:27 Bangkok collected296 socket samples with no debugging
client. Other agents' processes were not stopped. Older already-open sessions
can retain their previously loaded tools; do not invoke their browser methods
or all-surface inventories. Global/repo agent instructions record this rule.
The source of a new prompt outside the observation period remains unproven.

### Passive attribution when prompts recur

Do not request a new connection to reproduce a reported prompt. Inspect the
existing listener with `lsof`, then use its numeric port for a bounded passive
watch (the port may change when Chrome restarts):

```sh
node scripts/cdp-socket-watch.mjs --port 64165 --seconds 120
```

This invokes only the OS socket listing. It records client PID, parent PID,
short process name and TCP state; no browser requests, protocol content, full
process arguments, cookies or tokens. It does not terminate processes. The
default is two minutes; the maximum is two hours. `--interval-ms` defaults to500
and accepts250–5000. A heartbeat reports observation coverage every minute.
Three parser/argument regression tests are included in `npm run test:cdp`.

A zero-client sample is not proof that Chrome has no outstanding prompt.
Short-lived connections between samples, extension-based debugging and a
changed browser port are outside this trace's coverage. A detected client is
attribution evidence, not automatic authority to terminate another user's
session. Resolve its ownership first. Never print unrestricted process arguments
or the full Codex configuration while investigating: unrelated entries can
contain credentials. Persistent config changes also do not remove tools already
loaded in older sessions; those browser methods remain prohibited.

### Stale live Codex connectors found — 15 September, 14:43 Bangkok

The saved configuration passed all4 previous checks, but OS process inspection
found three new direct `chrome-devtools-mcp` launchers with `--autoConnect`
under an already-running Codex session in `/Users/dom/src/heimdall-mr`.
The launchers99170/99171/99186 and workers99520/99564/99586 were started around
14:22, after the persistent disablement. Exact parent/command ownership was
checked before sending TERM to the browser connectors only. All six processes
exited; the parent Codex40383, this session33663, backend57049 and singleton14004
remained alive. Other agents' non-auto-connect MCP processes were untouched.

This proves a live bypass of the singleton rule, not which specific displayed
prompt it caused. The passive64165 trace had no client samples; no new Chrome
request was made to reproduce it. No browser session, MP3 or queued work was
changed. The bridge stayed disconnected/not connecting.

`npm run test:cdp-config` now includes a fifth, read-only live-process ancestry
check for direct Chrome MCPs owned by Codex, in addition to the saved settings
and native-only launcher checks. It emits only numeric process identities, not
command arguments. `npm run test:cdp` includes four classifier regressions
(21 total tests). All5 local configuration/runtime checks and21 regressions
passed after cleanup. The check does not terminate processes and is not a
system-wide blocker; unknown connectors or an old session respawning a tool
remain possible. Never promise that config changes alone retrofit live sessions.

### Repeated-prompt recheck — 15 September, 15:09 Bangkok

The singleton remains PID14004, disconnected and not connecting. Chrome1337
still listens on64165; the existing passive trace had5056 samples and zero
client samples through15:07:52 Bangkok. No connection was requested, and no
browser, proxy, agent, or download worker was restarted in this recheck.
This does not identify the latest reported prompt or dismiss its existence.

The process check had a coverage gap: a Node process can invoke the direct
connector's JavaScript entry point while its executable name is only `node`.
`inspectCodexChromeConnectors` now reads arguments privately for Node
executables and checks the actual script position, not arbitrary shell/eval
text. It retains Codex ancestry checks and emits numeric identities only.
Inspection failures fail the check, rather than claiming no connectors exist.
Four new regressions cover hidden Node entry points, diagnostic-text false
positives, argument privacy/changed parents, and failed OS inspection.

All25 CDP regressions and5 live/configuration checks passed. The enhanced
live check found no Codex-owned direct connector at this checkpoint. Four
other agents' Chrome MCP trees were present without auto-connect flags;
none was observed connected to main Chrome. They were not attributed as
the cause or terminated. The existing bounded passive watcher remains in
place; no duplicate watcher was started.

Global and repository instructions now require this read-only preflight
before browser work in each future session, as well as after a repeated
prompt report. The native-only/disabled Codex settings remain unchanged.
Never print old bridge logs verbatim: older versions logged session endpoints.

### Stale browser-enabled tool runtimes closed — 15 September, 15:33 Bangkok

The direct-connector and saved-settings checks passed, but a further private
inspection found16 live Codex REPL processes with `browser` still present in
`NODE_REPL_TRUSTED_SERVICES`. Eight were generic REPLs and eight were unified
CUA runtimes. Their loaded browser settings had survived the saved native-only
configuration. This is a confirmed bypass risk, not proof of which runtime
caused a particular Chrome prompt.

After checking exact process identities/parents, TERM was sent only to those16
tool runtimes. They and their child workers exited. Parent Codex processes
33663/40383/69403, Chrome1337, singleton14004, backend15237 and passive watcher
89653 remained alive. No Chrome connection, approval, proxy restart, agent
restart, download admission or media mutation was requested. The singleton
remained disconnected/not connecting. Native-only app control stays enabled
in the configuration for fresh sessions, but old tool-session state was closed.

`npm run test:cdp-config` now has a sixth check: inspect **live** Codex REPL
environments, not only saved settings or named Chrome MCP processes. It reads
only Codex-owned REPL environments, returns numeric identities, and fails
closed on uninspectable configuration. Never output raw environments. Five
additional dependency-free regressions cover attribution, native-only and
unrelated-process exclusion, privacy, changed parents and inspection failures.
All30 regressions and6 live/configuration checks passed after cleanup.

Global/repo agent rules require this expanded preflight in future browser
sessions and on recurring prompts. It is read-only, not an automatic process
killer or a system-wide firewall. An older parent can still hold stale launch
configuration; never invoke or relaunch its old browser tools. The existing
bounded passive watcher continues without duplication. Do not claim that
green configuration tests prove a displayed prompt disappeared or that every
possible prompt source has been attributed.

### Passive trace completed — 15 September, 16:24 Bangkok

The existing two-hour trace finished at16:20:41 Bangkok:12,826 OS socket samples,
zero client samples. No watcher remains from that run. Do not describe it as
ongoing or start duplicates based on old handovers. A fresh recheck found the same
disconnected/not-connecting singleton14004, Chrome1337 listener64165, and all6
saved/live Codex checks and30 CDP regressions passing. No browser connection or
permission action was requested. This does not identify the latest reported
prompt; older/extremely brief/extension-originated requests remain outside what
the trace can prove. Do not call the repeat-prompt problem conclusively fixed.

### Confirmed stale-parent recurrence — 15 September, 16:46 Bangkok

Live inspection found another direct auto-connect launcher4881/worker4923 and
browser-enabled REPLs4877/4901 below the same Codex40383 in
`/Users/dom/src/heimdall-mr`. The parent started14September12:46:17 Bangkok.
Exact ancestry and loaded browser flags were checked before TERM was sent only
to those four tool processes. Their launcher4876 also exited. Codex40383,
this session33663, Chrome and singleton14004 were preserved. No browser
connection, permission action, queue mutation or media operation was requested.

At16:46:36 the live inspectors found no Codex Chrome connectors or
browser-enabled REPLs. The singleton was still disconnected/not connecting;
the OS socket check showed only Chrome's listener. All30 simulated/source
regressions passed. Five of six local configuration checks passed; plugin
enumeration exceeded the15-second test deadline. A separate30-second bounded
enumeration succeeded and confirmed both Browser and Chrome plugins disabled.

This proves another live violation of the singleton rule and shows why the
previous child cleanup did not prevent recurrence. It does not attribute a
particular displayed prompt. **Containment is complete; permanent remediation
of this older parent remains open.** Its tool configuration needs a verified
reload or a safely authorized session restart. A clean child-process snapshot
must not erase that outstanding requirement. No unrelated parent agent was
restarted, and no hook-trust or Chrome permission boundary was bypassed.
