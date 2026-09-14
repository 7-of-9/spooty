# Spooty CLI

The CLI and website are first-class entry points to the same acquisition stack.
The CLI reads the saved Spotify library, resumes durable work, and emits JSON
progress. The website supplies playlist selection, queue controls and playback.
Neither needs an agent or manual browser search for individual tracks.

## Start here

From the repository root:

```sh
nvm use                         # .nvmrc pins Node 20.19.4
npm install
npm run acquire -- --help
npm run acquire -- doctor
npm run acquire -- plan          # read-only, including restart/skip decisions
npm run acquire -- run --limit 8 # at most eight NEW MP3s, then drain
npm run acquire -- status
```

`npm run acquire -- …`, `node bin/spooty.mjs …` and the historical
`node scripts/acquire.mjs …` invoke exactly the same implementation. The package
also declares the executable `spooty`; optionally use `npm link` for a local
shell command. There is no requirement to install or link it globally.
Run it from any directory with an absolute entry-point path; default data paths
are anchored to the repository, not the shell's working directory.

Prerequisites for this installation: the Node 20 npm workspaces (including
development dependencies for the TS loader), Redis, the Nest backend on
`127.0.0.1:3000`, saved playlist JSON and its durable SQLite database, the
reviewed macOS yt-dlp executable, Homebrew ffmpeg/ffprobe, and Node 22+ for
yt-dlp's JavaScript solver. `doctor` is entirely local and reports what it does
**not** check. Backend/Redis availability is checked before changing queues.
This is currently a supported local macOS workflow, not a standalone portable
binary or a promise that the historical Docker setup supports the CLI.

The known authenticated route additionally needs an existing private Netscape
cookie export and the pinned bgutil 2.0.0 plugin/provider on
`http://127.0.0.1:4416`. It is enabled explicitly:

```sh
npm run acquire -- doctor --authenticated --pot-recovery
npm run acquire -- run --authenticated --pot-recovery
```

If web jobs are active, use `run --takeover` only when a handoff is intended.
It stops new web admissions, lets active work finish, retains every queued job,
and transfers exclusive YouTube ownership to the CLI. Admission history and
cooldowns survive the transfer. On exit, originally paused queues stay paused;
originally running queues may resume only after successful pace handback.
Never run a second CLI against a live owner.

## Commands

| Command | Meaning |
| --- | --- |
| `plan` (default) | Offline catalog/disk/journal inspection. `resume` gives saved, Missing, no-candidate, exhausted-error, ready and pending counts. No writes or YouTube work. |
| `doctor` | Local prerequisite and pinned-client checks; no network, queue or library writes. |
| `run` | Resumable acquisition with exclusive ownership, checkpoints and graceful draining. |
| `status` | Last run's JSON snapshot plus a bounded live-owner check. Snapshot age is explicit; no active ETA when ownership cannot be verified. Use `plan` for fresh physical counts. |
| `benchmark` | Historical measured MP3 throughput, baseline comparison and complete 10/30-minute fixed-profile windows; not a live filesystem audit. |
| `pace` | Request explicit changes to a verified live owner's pace. At least one pace option is required. |
| `stop` | Stop new admissions, finish current batches, preserve saved work and return ownership. |
| `inspect-review` | Ask the live owner to inspect unresolved saved-source reviews; metadata inspection is metered, not an MP3 completion. |
| `review-work` | Ask the live owner to load explicit actions from `review-work.json`; advanced exception handling, not the normal ingest path. |

All live control commands reject stale or absent owners instead of writing a
control file nobody will consume. Controls target the recorded run ID and PID.
`Ctrl-C`/SIGTERM also drain the runner; a second signal force-stops its children.
The `stop` command does not cancel Bull jobs or delete media.

## Every option

Options are command-specific. Unknown options, extra positional arguments,
duplicate options, invalid numbers and unused combinations exit with an error.
Use `spooty run --help` for command-specific help. Numbers must be whole decimal
integers within the listed range.

| Option | Accepted commands | Default / range | Effect |
| --- | --- | --- | --- |
| `--takeover` | run | off | Authorize graceful handoff from active web queues. |
| `--limit N` | run | 0 / 0–1000000 | Maximum new MP3s; in search-only mode, successful searches. Zero is unlimited. Existing/local-reused files do not consume it. |
| `--minutes N` | run | 0 / 0–1000000 | Stop admissions after N minutes of acquisition, excluding initial drain; already admitted batches finish. Zero is unlimited, not an instant stop. |
| `--download-conc N` | run, pace | inherit / 1–12 | Maximum concurrent download **batches**. |
| `--search-conc N` | run, pace | inherit / 1–6 | Maximum concurrent search batches. |
| `--window N` | run, pace | inherit / 8–240 | Download/video admissions per **ten minutes**, not tracks/second. |
| `--batch-size N` | run | 8 / 1–8 | Maximum tracks in one yt-dlp batch. |
| `--search-buffer N` | run | 192 / 1–1000000 | Backpressure threshold for validated candidates awaiting download. In-flight batches may complete above it. |
| `--max-searches N` | run, plan | 10 / 1–50 | Ranked candidate results for a track query. Not a network retry count. Larger depth deliberately reopens exhausted selection. |
| `--network-retries N` | run | 5 / 0–20 | Additional workflow attempts after network failure; initial attempt plus N. Does not count individual internal yt-dlp HTTP requests. |
| `--search-only` | run | off | Select and save candidate URLs, but do not download audio. Cannot combine with review actions or POT download configuration. |
| `--retry-errors` | run, plan | off | Reopen exhausted network/operation failures. Does not reopen Missing or same-depth no-candidate records. |
| `--inspect-review` | run | off | Also schedule unresolved saved-source inspections inside this owner. |
| `--review-work` | run | off | Also load explicit catalog-scoped review actions. |
| `--authenticated` | run, doctor | off | Use isolated copies of the existing cookie export from the first request. |
| `--pot-recovery` | run, doctor | off | Enable the pinned local provider for cookie-bearing downloads, including post-block recovery. Does not start/install that provider. |
| `--help`, `-h` | all | — | Help without state or network changes. |
| `--version`, `-v` | alone | — | Package version without state or network changes. |

The current persisted profile is 4 download batches, 1 search batch,
240 download admissions/ten minutes, batch 8 and buffer 192. Omitting pace flags
preserves the current state; it does **not** blindly reapply that fast profile.
After a genuine YouTube 429/bot/API-page block, owned child processes stop
immediately and the shared gate falls to **one total process, 8 admissions/ten
minutes**, with its cooldown retained. Auto-raising is disabled. A pace change
is an explicit operator action, not automatic failure recovery.

```sh
npm run acquire -- plan --retry-errors       # preview reopening exhausted failures
npm run acquire -- plan --max-searches 20    # preview deeper candidate selection
npm run acquire -- pace --download-conc 3    # change one lever on a live owner
npm run acquire -- stop
```

`plan --retry-errors` still shows the complete library; its actionable count
includes normal pending work plus reopened errors. It does not filter output
to failures alone. `--limit` bounds successful new outputs, not total attempts
or wall-clock duration. Use `--minutes` as well when a time-bounded trial matters.

## Resume and failure semantics

1. A nonempty published local file wins: reuse it, fill missing playlist
   destinations with hardlinks/copies, reconcile durable status, no YouTube call.
2. A confirmed empty search is `missing`. An exhausted ranked search without
   acceptable duration is `no-candidate`, with its search depth saved.
3. Both outcomes are fast-skipped on an ordinary same-depth rerun. “No
   acceptable result among 10” is not proof that no source exists anywhere.
4. Wrong/unknown-length candidates are disqualified, and selection advances
   without incrementing network or operational failure counters.
5. Network failures use the separate configured retry budget and delayed
   backoff/global cooldown. Other operational failures have a separate
   five-failure cap. Missing Spotify duration never bypasses validation.
6. Published-file existence is authoritative across restarts. Deleting a
   previously saved file makes its saved-state record eligible again; a parked
   no-candidate/error record stays parked until deliberately reopened.

`plan.resume.actionable` is the useful automatic-work count. Parked exceptions
are disclosed separately and have no invented completion ETA. Disk GB counts
unique MP3 inodes, so multiple playlist hardlinks are not counted repeatedly.
During a live run, rates count newly verified, published MP3s, compared with
the 3/min baseline. ETAs cover actionable bulk work with a 25% buffer; they do
not promise completion of unresolved recording-identity reviews.

## Shared pipeline

```text
CLI catalog/journal adapter ─┐
                            ├─ shared acquisition core ─ verified, tagged MP3
Web Bull/HTTP/UI adapter ────┘
```

The common implementation lives in
[`src/backend/src/shared/acquisition/`](../../src/backend/src/shared/acquisition/).
It owns client and
process handling, private cookie copies, candidate/duration policy, source
metadata validation, batch search/download, final ffprobe validation and atomic
tagged publication. The old `scripts/acquire/*.mjs` modules are compatibility
adapters, not a second implementation. The existing `YoutubePace` and yt-dlp
protocol helpers remain shared. CLI and web retain their appropriate schedulers,
but use the same durable candidate/failure journal and rejection ledger.

For each track: local reuse → trusted Spotify duration → ranked YouTube
candidates → first acceptable candidate → pre-download duration filter → audio
extraction/conversion → independent ffprobe duration+MP3 check → tags → atomic
publication → playlist copies/links → durable completion/UI update.

Duration tolerance is **±5%, with a minimum 5 seconds and maximum 20 seconds**:
`min(20, max(5, spotifySeconds × 0.05))`. A 200-second source allows 190–210sec;
a 60-second source allows 55–65sec; a 600-second source allows 580–620sec.
Unknown source duration cannot pass. Nothing is silently trimmed. Length
matching does not prove the same recording/remix/performance, so separate
identity-review flags remain meaningful.

### Website entry point

At `http://127.0.0.1:4200/`, use **Search & download needed**, or select
playlists and press **Download**. Background Spotify discovery does not block
work from saved metadata. Expand **Acquisition options** for candidate depth
and additional network retries. Normal Download preserves parked outcomes;
the separate failed-work and exhausted-search actions explicitly reopen them.
CLI ownership disables web acquisition without disabling local playback.

Both `POST /api/library/download` (with a `uris` array) and
`POST /api/library/download-remaining` accept `maxSearches` (1–50),
`networkRetries` (0–20), and explicit boolean `retryMissing`,
`retryNoCandidate`, `retryErrors` options. All retry booleans default to false.
Unknown fields, wrong types and out-of-range values return HTTP 400.

The retained web profile uses eight-song batches and MP3 quality 0. Unsupported
`FORMAT`, `QUALITY`, or legacy `YT_SEARCH_BATCH_SIZE` /
`YT_DOWNLOAD_BATCH_SIZE` overrides fail before YouTube admission; they are not
silently ignored. The CLI additionally supports smaller batches with
`--batch-size`.

## Paths and configuration

Use absolute environment paths for predictable operation from any directory.
Credentials are never CLI flags or JSON output.

| Environment variable | Default in this checkout |
| --- | --- |
| `STATIC_PLAYLISTS_PATH` | `/Users/dom/src/spooty/PLAYLISTS_2026-09-08/playlists` |
| `DOWNLOADS_PATH` | `/Users/dom/src/spooty/downloads` |
| `DB_PATH` | `/Users/dom/src/spooty/data/spooty.sqlite` — never under `dist/` |
| `ACQUIRE_STATE_PATH` | `/Users/dom/src/spooty/data/acquire` |
| `COOKIES_PATH` | `/Users/dom/src/spooty/cookies.txt` — file metadata only in diagnostics |
| `SPOTIFY_TRACK_METADATA_PATH` | `/Users/dom/src/spooty/data/spotify-track-metadata` |
| `ACQUIRE_API_URL` | `http://127.0.0.1:3000/api/youtube/pace` — backend pace handoff endpoint |
| `REDIS_HOST`, `REDIS_PORT` | `127.0.0.1`, `6379` — use the same Redis as the web queues |
| `YT_JS_RUNTIME_PATH` | `/Users/dom/.nvm/versions/node/v22.13.0/bin/node` — yt-dlp solver only |
| `SPOTIFY_META_CONC`, `SPOTIFY_META_GAP_MS` | `2`, `250` — authenticated metadata gate; honors Retry-After |

State includes `work.sqlite` (per-track outcome, candidate depth, separate
failure counters), `duration-rejections.json`, `pace.json`, `status.json`,
`handoff.json`, `control.json`, per-run `events-*.jsonl` and `result-*.json`.
Do not wipe this directory to restart: that loses skip/rejection history.

Advanced `review-work.json` has `{"requests": [...]}` with at most 32 entries.
Each entry has a unique safe `id`, an existing normalized catalog `key`, and
`action: "search" | "inspect" | "download"`. Searches optionally supply a
`query`; inspect/download require an explicit 11-character `videoId`.
Downloads are staged outside the library and do not count as new acquisitions
or automatically replace files. Reusing an ID for different work is rejected.
See [ACQUIRE.md](../../ACQUIRE.md) for historical review/audit tooling, not the
normal restart command.

## Output, exits and tests

Data commands emit JSON; `run` emits JSON progress lines. Errors are JSON on
stderr. Help/version are plain text. Exit 0 means the command succeeded or the
run drained normally; it does **not** mean every song has a source. Inspect
`phase`, `actionableUnique` and parked outcomes. Exit 1 means runtime/ownership/
dependency failure; exit 2 means invalid usage or a failed local doctor check.

```sh
npm run test:acquire
npm run test -w backend -- --runInBand
```

Tests cover the option matrix, range boundaries, safe controls, resume semantics,
batch process handling, candidate selection, duration checks and publication.
The integration tests use isolated temporary state; they must not resume the
real queues or retry the accepted unresolved library as a test side effect.
