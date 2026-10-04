[![License](https://img.shields.io/github/license/7-of-9/spooty)](LICENSE.md)
[![Last commit](https://img.shields.io/github/last-commit/7-of-9/spooty)](https://github.com/7-of-9/spooty/commits/main)

![Spooty logo](assets/logo.svg)

# Spooty — library dashboard and acquisition CLI

This is **[7-of-9/spooty](https://github.com/7-of-9/spooty)**, a fork of
[dougchansan/spooty](https://github.com/dougchansan/spooty), originally derived
from [Dawson7777/spooty](https://github.com/Dawson7777/spooty).

Spooty reads Spotify metadata, finds corresponding YouTube audio, and builds a
local MP3 library. It does not download audio from Spotify. This fork extends
the original NestJS/Angular application into a resumable, duration-checked
library pipeline with **two first-class entry points: the website and CLI**.
They call the same acquisition implementation; no AI agent or manual browser
search is needed for individual songs.

## What this fork adds

| Extension | What it does |
| --- | --- |
| First-class CLI | `spooty` package executable, `npm run acquire`, command-specific help, strict argument validation, local doctor, offline plan, live status/control and benchmark reporting. |
| Shared acquisition engine | CLI and Nest adapters share YouTube transport, client selection, private cookie copies, candidate/duration policy, Spotify source identity and filename aliases, MP3 verification, tagging and atomic publication. They keep their own schedulers, not duplicate download implementations. |
| Durable resume and cross-entry history | A shared SQLite work journal and rejection ledger preserve saved, Missing, exhausted-search and failure outcomes across restarts and CLI/web ownership changes. Ordinary reruns fast-skip completed and parked work. |
| Ranked candidate selection | Configurable candidate depth, default **10** results per query across up to three query variants. Wrong-length candidates are disqualified and selection advances; they do not count as network failures. A deeper search deliberately reopens exhausted selection. |
| Spotify duration guard | Source-duration lookup/cache, candidate checks, a pre-download filter, and independent ffprobe validation of the final MP3. Tolerance is **±5%, with a 5-second minimum and 20-second maximum**. Unknown source duration cannot silently pass. |
| Batched, paced acquisition | Separate search/download pools, backpressure, metered admissions, graceful draining and exclusive YouTube ownership. Genuine block signals immediately terminate owned work and preserve the safety floor/cooldown. |
| Spotify session integration | Logged-in Chrome web-player metadata through a persistent loopback bridge, private-playlist support, paginated metadata, cache reuse and bounded request pacing. The supported library path does not require Spotify Developer credentials or playlist HTML scraping. |
| Saved-library-first dashboard | Filter/sort/select playlists; show actionable and running work first; distinguish physical files, Missing, exhausted searches and operational errors. Discovery/resync runs in the background without blocking work from saved metadata. |
| Non-blocking local file checks | Browse saved playlists while audio is checked in the background. One Current activity indicator shows checked/total tracks; opening a playlist prioritizes its checks. Unchecked files are not labelled missing or counted as new downloads. Progress reads reuse the same scan; connection loss and failed checks have explicit recovery. |
| Live saved-file updates | Local file and workflow changes notify open dashboards. Only affected tracks are rechecked; unchanged playlists retain their saved counts. Added, removed, renamed and hardlinked MP3s use the same source-aware index as the CLI. An old completed job cannot invent a Play button. If filesystem watching fails or the watched folder moves, Current activity offers **Check saved files again**. These updates never start downloads or Spotify sync. |
| Source-aware local media | Same-named Spotify versions have separate work identities and safe new destinations. All local candidates are considered using shared fingerprint-cached duration evidence; incompatible files are preserved but do not count as saved/copyable for that source. Unknown historical source duration stays unverified. |
| Playlist owner attribution | The sidebar and playlist header show the owner. Discovery retains Spotify's public owner name, ID and profile link. Older dumps use their saved library subtitle as a labeled fallback; personalized “Made for…” labels remain separate, and unknown owners are not invented. This is ownership, not original-creator history. |
| Clear playlist freshness | The header distinguishes **Saved locally** from a track list **Checked with Spotify**. Invalid/missing dates do not break the page or invent a check. One saved-progress summary replaces duplicate completion labels; local files are not claimed as newly downloaded. |
| Persistent download folder | Open **Library tools → Download folder** in the sidebar, enter an existing absolute directory, and **Save & rescan**. Scanning, playback and new CLI/web downloads use the same saved location. Files are never moved/deleted and running acquisition cannot be redirected. |
| Clear work controls | Saved, not queued, queued/paused and running work are separate. **Queue N for search & download** stays usable alongside existing playlist work. **Resume web downloads** explicitly confirms the entire preserved web queue, including older batches; it respects CLI ownership and safety cooldowns. Refresh, retry and enqueue never implicitly resume it. |
| Local playback and reuse | Actual MP3 filenames, browser playback with range requests, cross-playlist reuse and hardlinks/copy fallback. Shared filename handling supports long Unicode titles. Physical saved files take priority over stale error records. |
| Explicit recovery controls | Candidate depth and network retries are separate options. Normal Download preserves parked outcomes; separate actions reopen failed work or exhausted searches. CLI controls verify the live owner/run before writing requests. |
| Full-library audit and repair tools | Resumable local duration audits, source-identity coverage, review ledgers, staged candidate inspection and scoped repair/deletion tools with fingerprint checks and manifests. Historical reviews follow explicit Spotify IDs across key changes; replacing one version cannot clear a multi-version review. Normal ingest never runs historical deletion scripts. |
| Measured operational reporting | Newly published MP3s/minute versus a **3/min** baseline, unique-inode disk usage, durable outcomes, owner/queue/cooldown state, actionable-work ETAs and a 25% time buffer. Parked exceptions get no invented ETA. |
| Regression and operator tooling | CLI, backend and real-browser frontend tests; isolated queue-handoff tests; local ffprobe/tagging fixtures; queue-recovery and process-monitoring scripts; documented product/operations contracts. |

## Pipeline

```text
CLI catalog/journal adapter ─┐
                            ├─ shared acquisition core ─ verified, tagged MP3
Web HTTP/Bull/UI adapter ────┘
```

1. Read saved Spotify metadata and deduplicate acquisition by source ID while retaining playlist occurrences.
2. Reuse duration-compatible published local files; fast-skip Missing and same-depth exhausted
   outcomes unless the operator explicitly reopens them.
3. Resolve the Spotify duration and inspect ranked YouTube candidates.
4. Select an acceptable candidate, pass the pre-download duration check, and
   download/convert under the shared admission and concurrency limits.
5. Verify the actual MP3 codec/duration, write tags, and publish atomically.
   Make playlist links/copies, then persist completion for either entry point.
   If another file occupies a destination during publication, preserve it and
   save under a source-specific numbered filename. The web records and plays
   the actual resulting filename, never the unrelated file that won the race.

The duration allowance is `min(20, max(5, spotifySeconds * 0.05))` seconds.
A 200-second song allows 190–210 seconds. No automatic trimming is performed.
**Matching duration does not prove the same recording, remix or performance**;
recording-identity reviews are tracked separately.

Implementation: [`src/backend/src/shared/acquisition/`](src/backend/src/shared/acquisition/).
The older `scripts/acquire/*.mjs` transport/policy modules are compatibility
exports of this core, not a parallel implementation.

## CLI quick reference

```sh
npm run acquire -- --help
npm run acquire -- doctor
npm run acquire -- plan
npm run acquire -- run --limit 8
npm run acquire -- status
npm run acquire -- benchmark
npm run acquire -- stop
```

`node bin/spooty.mjs` and the historical `node scripts/acquire.mjs` are equivalent
entry points. Optional `npm link` exposes the `spooty` shell command.

- `plan` shows what a restart would actually do without changing media, queues or journals. It may populate the private local ffprobe cache; no Chrome, Spotify or YouTube calls are made.
- `run --takeover` stops new web admissions, drains current work and takes
  exclusive ownership. Queued jobs and existing cooldown/admission history
  survive; originally paused queues remain paused on handback.
- `--max-searches 10` means up to 10 ranked candidates **per query**, with up to
  3 automatic query variants and video-ID deduplication—not network retries.
  Search checks title/artist/edition as well as duration, and stops on a match.
  At most 2 credible candidates with missing duration get a paced metadata check.
  The web track row's **Search evidence** shows query/rank/video/length/reasons;
  both entry points save the latest report in `data/acquire/search-diagnostics/`.
- `--network-retries 5` permits five additional workflow attempts after network
  failure. Operational failures have a separate five-failure cap.
- `plan --max-searches 20` previews deeper selection;
  `plan --retry-errors` previews reopening exhausted operational/network work.
- `pace`, `stop`, `inspect-review` and `review-work` require a verified live owner.
  Review actions are advanced exception handling, not the normal ingest path.

**[Complete CLI README: every command, option, range, environment setting and
resume rule](scripts/acquire/README.md).** Invalid, duplicate, unknown or
command-inapplicable arguments are rejected rather than silently ignored.

## Setup and current support boundary

The verified deployment is **local macOS**, Node **20.19.4**, Redis, NestJS on
`127.0.0.1:3000` and Angular on `127.0.0.1:4200`. The acquisition tooling still
contains installation-specific defaults, including the macOS yt-dlp binary and
Homebrew ffmpeg paths. This is not yet a portable, fresh-clone, one-command
installer. Personal playlists, media, cookies, caches and provider binaries are
deliberately **not included** in the repository.

Prerequisites:

- Node **20.19.4** via nvm; development dependencies are required for the CLI's
  shared TypeScript loader.
- Redis, ffmpeg and ffprobe. The verified ffmpeg/ffprobe location is
  `/opt/homebrew/bin/`.
- A separate **Node 22+** executable for yt-dlp's JavaScript solver, supplied
  through `YT_JS_RUNTIME_PATH`; this does not change the application's Node pin.
- The reviewed `ytdlp-nodejs/bin/yt-dlp_macos` binary. Compatibility is checked
  against a reviewed SHA-256; an unreviewed update fails closed.
- Saved playlist metadata and a durable library database, populated through
  the website's Spotify integration or supplied from an existing installation.
- For private Spotify metadata: the logged-in main Chrome profile and the
  persistent bridge in `scripts/cdp-keepalive.mjs` on `127.0.0.1:17331`.
- For the retained authenticated YouTube route: a private Netscape cookie file
  and the pinned bgutil **2.0.0** plugin/provider on `127.0.0.1:4416`.
  `--pot-recovery` enables use of an existing provider; it does not install or
  launch it. The plugin/provider files are local-only.

### Source checkout

```sh
git clone https://github.com/7-of-9/spooty.git
cd spooty
nvm install 20.19.4
nvm use
npm ci
cp -n src/backend/.env.default src/backend/.env
```

Use absolute paths so the CLI and backend operate on the same files. For
example, run these exports from the repository root in **each application
terminal**, adjusting the Node 22 path for your installation:

```sh
export SPOOTY_ROOT="$PWD"
export DB_PATH="$SPOOTY_ROOT/data/spooty.sqlite"
export DOWNLOADS_PATH="$SPOOTY_ROOT/downloads"
export STATIC_PLAYLISTS_PATH="$SPOOTY_ROOT/PLAYLISTS_2026-09-08/playlists"
export ACQUIRE_STATE_PATH="$SPOOTY_ROOT/data/acquire"
export COOKIES_PATH="$SPOOTY_ROOT/cookies.txt"
export YT_JS_RUNTIME_PATH="/absolute/path/to/node22/bin/node"
mkdir -p data/acquire downloads PLAYLISTS_2026-09-08/playlists
```

The dated metadata-directory name is a compatibility default, not bundled data.
Set `STATIC_PLAYLISTS_PATH` to your own metadata directory if preferred. The CLI
reads exported environment variables; do not assume it loads the backend `.env`.

With Redis available, start the backend and frontend in separate terminals:

```sh
npm run start:be
```

```sh
npm run start -w frontend -- --host 127.0.0.1 --port 4200
```

Open **http://127.0.0.1:4200/**. The backend initializes the database.

- **Sync Spotify library** (visible above the playlist list) discovers your
  playlists and updates their track lists. **Sync this playlist** updates only
  the selected playlist. Both update metadata, not MP3s.
- On narrow screens, **Choose playlist** expands the navigator; library sync
  stays outside that disclosure. Type to filter, then use Up/Down to browse
  results, Enter to open a playlist, or Escape to close the chooser. Space in
  the list selects a visible playlist for a batch; browsing never starts one.
- While connected, the open dashboard checks the whole library every15 minutes,
  so newly followed playlists appear without a page reload. It avoids duplicate
  work and respects Spotify request limits. Disconnected background checks
  never request Chrome permission; the first explicit Sync click explains the
  required connection without submitting a doomed metadata job.
- Library discovery validates Spotify's
  [pagination contract](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists)
  before publishing results. An incomplete/malformed library response preserves
  saved playlists and reports **Spotify sync incomplete**, not an empty library.
- Tracks removed on Spotify disappear from the saved playlist after two
  matching, complete API reads. That playlist folder's copies of the dropped
  tracks are unlinked, and their queued work for this playlist is dropped.
  Incomplete/inconsistent responses keep the previous list and files. Empty
  playlists are distinguished from track lists that have not been loaded yet.
- Whole playlists no longer returned by a complete library check stay saved.
  Their header says **Kept locally**, with the check date; files are unchanged.
  **Sync Spotify library** rechecks library presence. **Sync this playlist**
  refreshes its tracks but does not claim it is back in your library. Failed or
  partial library checks never mark playlists absent.
- Replacements and reordering are detected even when track counts stay the
  same. Sync checks track membership when revision evidence is missing, and
  leaves verified unchanged playlist files untouched. Spotify is the source of
  truth for each playlist: a verified removal unlinks that playlist folder's
  copies of the dropped tracks. Other playlists' hardlinks stay.
- **Current activity** shows which playlist is being checked, the result, or
  why sync cannot proceed. **Activity details** contains technical errors and
  the last Spotify-sync time. Saved playlists remain usable when Spotify is
  unavailable. Library, individual-playlist and saved-playlist bulk sync share
  one durable operation: reloads keep its scope/result and interrupted server
  restarts are reported honestly. Open tabs observe sync started elsewhere.
  A lost submission response is checked against the actual operation, never
  reported as success using an older result or automatically submitted again.
- Use the playlist download action, **Library tools → Search & download
  needed**, or the CLI to obtain MP3s separately.

### Download submissions and recovery

**Current activity** shows preparation and the confirmed result: tracks queued,
existing MP3s added locally, or no new work. Queuing is not a completed download.
After a lost reply or page reload, the dashboard reads the saved result for
that exact submission. **Check submission** only checks status; it never sends
the download request again. Quiet Spotify sync does not erase this acknowledgement.

If the backend restarts or preparation fails, some tracks may already be
queued. The dashboard reports that uncertainty; files and queued work are kept.
It does not automatically replay the request or invent partial counts.

For HTTP clients, optional `X-Spooty-Request-Id: <UUID>` on
`POST /api/library/download` or `POST /api/library/download-remaining` enables
durable receipts. `GET /api/library/download-requests/<UUID>` returns
`preparing`, `completed`, `interrupted`, or `failed`, with counts only for
completed preparation. Reusing the same ID and payload returns its original
completed result; conflicting payloads and unfinished old requests return409.
An old whole-library request never acquires newly added tracks: use a new ID
for a new explicit submission. Existing callers without the header are unchanged.

Receipts are private, Git-ignored JSON files in `download-requests/` beside
`DB_PATH`. The dashboard remembers its pending ID in that tab's session storage
(reloads, not a guarantee after closing the tab); if storage is blocked, it
warns you to keep the tab open. Queue execution does not depend on the tab.
The receipt store assumes one backend process per database and does not replay
admissions after crashes. This is process-restart recovery, not a power-loss
durability or multi-writer guarantee.

Spotify uses one persistent authorized [Chrome bridge](scripts/CDP.md). A
disconnected bridge never silently reconnects or opens another permission
prompt. **Connect Chrome…** explains and confirms a single connection request;
connecting alone does not sync playlists or download MP3s. Do not start a
direct Chrome MCP connection as a fallback.

For authenticated acquisition after the local prerequisites are installed:

```sh
npm run acquire -- doctor --authenticated --pot-recovery
npm run acquire -- run --authenticated --pot-recovery --limit 8
```

`doctor` checks local prerequisites, not session validity or remote availability.
Start with a bounded run; machine/network-specific throughput is not guaranteed.

### Configuration and safety

| Setting | Purpose |
| --- | --- |
| `DB_PATH` | Durable library SQLite path. Never put it under `dist/`, which watch builds may erase. |
| `DOWNLOADS_PATH` | Local MP3 root. Playlist destinations reuse files where possible. |
| `STATIC_PLAYLISTS_PATH` | Saved playlist metadata; shared by CLI and website. |
| `ACQUIRE_STATE_PATH` | Shared work journal, duration rejection ledger and CLI runtime reports. |
| `COOKIES_PATH` | Private Netscape-format cookie file; never a command-line credential value. |
| `REDIS_HOST`, `REDIS_PORT` | Shared queue/ownership Redis, normally `127.0.0.1:6379`. |
| `BIND_HOST`, `PORT` | Local backend binding, normally `127.0.0.1:3000`. |
| `YT_WEB_PROFILE` | Default `cli-proven`; `custom` opts into custom web settings, not out of quality/safety checks. Export before starting Nest. |
| `FORMAT`, `QUALITY` | Shared ingest requires `mp3` and quality `0`; unsupported settings fail before admission. |
| `YT_JS_RUNTIME_PATH` | Separate Node 22+ executable used by the yt-dlp solver. |
| `SPOTIFY_META_CONC`, `SPOTIFY_META_GAP_MS` | Authenticated metadata gate: two concurrent calls and 250 ms spacing by default; honors Retry-After. |

The retained profile is **4 download batches + 1 search batch**, batch size **8**,
candidate buffer **192**, and **240 download admissions per ten minutes**.
These are not tracks per second. Persisted pace/cooldown state takes precedence;
restarting must not silently restore a faster profile after a block.

Under **Activity details → Download settings & diagnostics**, **Restore tested
download limits** restores the concurrency/admission limits only. Both web
queues must be paused with active work finished; a paused backlog is preserved.
CLI ownership, preparation, cooldown and the safety floor prevent activation.
Already-selected limits are plain text. Progress/results appear in Current
activity; a missing reply is checked against fresh server state, never
automatically submitted again. This action does not resume queues, change
search options or touch existing MP3s.

The developer-only read-only identity audit is
`node scripts/ux/track-identity-audit.mjs --help`. It checks saved Spotify
metadata for filename collisions and probes conflicting recordings locally;
it never searches Spotify/YouTube, changes queues or deletes media. Its JSON
output can contain private playlist names/local paths: keep reports out of Git.
It is diagnostic evidence, not a replacement for the shared ingest guards or
proof that unexamined recordings are correct. The source-identity repair it
exposed is tracked in `WEBSITE_AUDIT.md`.

The first genuine YouTube 429/bot-check/API-page block immediately terminates
owned processes and trips to **one total process and 8 admissions/ten minutes**,
with a retained cooldown. Automatic pace escalation is disabled. Candidate
disqualification is a normal selection outcome, not a network failure.

Current reviewed routes are `visionos` anonymously, `web_creator` for
authenticated search, and `mweb` with the pinned local provider for authenticated
downloads. The reviewed release does not support `android_sdkless`.

The API has **no built-in authentication**. Keep it, Redis, the Chrome bridge
and the POT provider on loopback; do not expose them directly to the internet.
Cookies are sensitive session credentials. Keep them private, never commit or
paste them, and never bake them into an image. Each yt-dlp invocation gets an
isolated writable copy rather than modifying the master export.

### Docker status

The inherited Dockerfile and release automation are retained for reference,
but **the consolidated CLI/web pipeline has not been validated in Docker**.
The Dockerfile still uses a different Node patch version and a Linux layout;
the current CLI validates Node 20.19.4 and macOS tool paths. Do not treat the old
Docker recipe or dependency auto-release workflow as a supported deployment
path for these extensions. No Docker image for this fork is published here.

## Verification and performance evidence

The consolidation checkpoint passed **440 tests**: 157 CLI, 182 backend and
101 frontend, plus backend typechecking and the frontend production build.
Tests include isolated Redis handoff/resume controls, shared-code identity,
candidate/failure separation, and real local ffprobe/ID3/publication fixtures.
YouTube protocol subprocesses are mocked in these regression tests; passing
tests is not a live YouTube authentication or throughput guarantee.

```sh
npm run test:acquire
npm run test -w backend -- --runInBand
npm run test:ux
npm run test:dom
npm run test:cdp
npx tsc -p src/frontend/tsconfig.spec.json --noEmit
npm run build
```

`test:ux` executes pure status helpers and the Angular component's sync lifecycle
with controlled service responses, without rendering a DOM. Its stylesheet
checks compare the selected Bulma modules with the full framework's relevant
cascade, preserve CSS-variable references, reject retired UI styles and check
activity-row text/hover contrast. These are not visual browser acceptance.
It also tests real
Nest shutdown against scratch SQLite/download folders and a separate loopback
Redis: HTTP/polling/WebSocket clients, idle Redis failure and recovery, preserved
queued jobs, completed batches and graceful completion of a controlled in-flight
handler. The recovered-Redis case holds that handler beyond ten seconds to
prove that the blocking-wait protection is not a download execution deadline.
It also exercises
dev-proxy polling/WebSocket upgrades, cancelled status observations and an
unfinished HTTP body during shutdown. A read-only shutdown trace names which
worker/producer is still closing after five seconds; it never terminates work
or logs track data, connection arguments or raw errors. Bounded owner-local
traces are kept beside the database in `shutdown-traces/<pid>.jsonl`. The trace
stops at the application shutdown hook and cannot diagnose an earlier hook that
never reaches it. A reproduced Redis-reconnect shutdown hang is covered by
ioredis's [blocking-command timeout](https://github.com/redis/ioredis#blocking-command-timeout):
finite marker waits use their normal timeout plus 500ms; offline/indefinite
blocking waits use a 10s fallback. Normal Redis commands and active downloads
have no added deadline. This is a fix for the reproduced wait, not proof that
every possible shutdown failure has been eliminated.
The tests also exercise
real HTTP download submissions across backend restarts: completed counts,
same-ID duplicate suppression, partial queued work on interruption/failure,
changed library membership and unchanged metadata/media. These lifecycle tests
require the local `/opt/homebrew/bin/redis-server`; they block application
subprocesses and all network access except the fixture's Redis. They never
restart the running backend or touch its database, media or queue.
`test:dom` compiles
the real Angular templates/styles and runs the root with actual application
providers plus its component interaction suite in
JSDOM, including sync controls, loading/recovery, filtering, queue actions and
playback-control events. Connection-recovery checks cover stale health replies,
expired confirmations and disposal when the dashboard closes; none requests a
real Chrome connection. Browser fetch/XHR/WebSocket entry points are blocked;
service calls and the media engine are substituted. Neither command opens a
browser or contacts Spotify. JSDOM does not verify pixel layout, real audio
playback or live Spotify behavior; passing it is not full browser acceptance.
Run live UI/Angular browser verification only through the existing authorized
Chrome bridge. Do not launch ChromeHeadless, direct CDP, or an extra browser as
a workaround for a disconnected bridge; see [the connection rules](scripts/CDP.md).

Real website checks exercised library selection, playback, Spotify resync and
normal Download: a playlist with 17 saved tracks and one exhausted search
returned **0 queued / 18 unchanged**. A subsequent Spotify discovery 429 did
not prevent the saved-library workflow. The current global production stylesheet
is about479KB (previously760KB). Supported Sass modules preserve the reset,
themes, icons and current/legacy component helpers. The Sass-deprecation and
component-style budget warnings are resolved. Unused Angular routing was also
removed from the single-screen bootstrap: main JavaScript is about462KB rather
than537KB, with no deferred library/sync controls or lazy-loading shell.
The total initial bundle is about976KB and still
exceeds its warning budget. That budget has not been raised to hide the warning.

The completed duration-guarded CLI run produced **8,881 new MP3s in 941.08
minutes: 9.44 MP3/min, 3.15× the 3/min baseline**, with zero genuine blocks.
This is measured whole-run performance from one installation, including cached
URLs and exception handling—not a clean-start guarantee or proof of recording
identity. **The web adapter has not been separately throughput-benchmarked
after consolidation.** Earlier unguarded 21/min windows are not the quality-
guarded baseline.

## Documentation and repository contents

- [CLI reference](scripts/acquire/README.md): supported commands, all flags,
  paths, resume rules, review requests and exit codes.
- [Dashboard principles](OPERATOR_DASHBOARD_PRINCIPLES.md): product/UX contract.
- [Website audit](WEBSITE_AUDIT.md): implementation evidence and remaining work.
- [Acquisition notes](ACQUIRE.md) and [handover](HANDOVER.md): historical trials,
  duration audits and operations checkpoints. Old PIDs, machine paths, live
  status claims and recovery commands are historical, not fresh instructions.
- [Agent rules](AGENTS.md): repository working conventions and ownership safety.
- [Security and publication checks](SECURITY.md): exclusions, threat boundaries
  and the narrowly reviewed upstream scanner exception.

The repository includes code, tests, documentation and non-secret configuration
templates. `.gitignore` excludes MP3s (including copies outside `downloads/`),
downloads, private environment files, cookies/session exports, databases,
playlist dumps, runtime caches, audit outputs and local provider installations.
Historical one-off scrape/recovery scripts remain available for provenance;
they are not required by the normal per-track CLI or web workflow.

## License and attribution

[MIT](LICENSE.md). Original copyright and upstream attribution are preserved.
The upstream projects supplied the NestJS/Angular Spotify-to-YouTube application;
this fork's extensions are described above.
