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
| Shared acquisition engine | CLI and Nest adapters share YouTube transport, client selection, private cookie copies, candidate/duration policy, filename identity, MP3 verification, tagging and atomic publication. They keep their own schedulers, not duplicate download implementations. |
| Durable resume and cross-entry history | A shared SQLite work journal and rejection ledger preserve saved, Missing, exhausted-search and failure outcomes across restarts and CLI/web ownership changes. Ordinary reruns fast-skip completed and parked work. |
| Ranked candidate selection | Configurable candidate depth, default **10** results per track. Wrong-length candidates are disqualified and selection advances; they do not count as network failures. A deeper search deliberately reopens exhausted selection. |
| Spotify duration guard | Source-duration lookup/cache, candidate checks, a pre-download filter, and independent ffprobe validation of the final MP3. Tolerance is **±5%, with a 5-second minimum and 20-second maximum**. Unknown source duration cannot silently pass. |
| Batched, paced acquisition | Separate search/download pools, backpressure, metered admissions, graceful draining and exclusive YouTube ownership. Genuine block signals immediately terminate owned work and preserve the safety floor/cooldown. |
| Spotify session integration | Logged-in Chrome web-player metadata through a persistent loopback bridge, private-playlist support, paginated metadata, cache reuse and bounded request pacing. The supported library path does not require Spotify Developer credentials or playlist HTML scraping. |
| Saved-library-first dashboard | Filter/sort/select playlists; show actionable and running work first; distinguish physical files, Missing, exhausted searches and operational errors. Discovery/resync runs in the background without blocking work from saved metadata. |
| Local playback and reuse | Actual MP3 filenames, browser playback with range requests, cross-playlist reuse and hardlinks/copy fallback. Shared filename handling supports long Unicode titles. Physical saved files take priority over stale error records. |
| Explicit recovery controls | Candidate depth and network retries are separate options. Normal Download preserves parked outcomes; separate actions reopen failed work or exhausted searches. CLI controls verify the live owner/run before writing requests. |
| Full-library audit and repair tools | Resumable local duration audits, source-identity coverage, review ledgers, staged candidate inspection and scoped repair/deletion tools with fingerprint checks and manifests. Normal ingest never runs historical deletion scripts. |
| Measured operational reporting | Newly published MP3s/minute versus a **3/min** baseline, unique-inode disk usage, durable outcomes, owner/queue/cooldown state, actionable-work ETAs and a 25% time buffer. Parked exceptions get no invented ETA. |
| Regression and operator tooling | CLI, backend and real-browser frontend tests; isolated queue-handoff tests; local ffprobe/tagging fixtures; queue-recovery and process-monitoring scripts; documented product/operations contracts. |

## Pipeline

```text
CLI catalog/journal adapter ─┐
                            ├─ shared acquisition core ─ verified, tagged MP3
Web HTTP/Bull/UI adapter ────┘
```

1. Read saved Spotify metadata and deduplicate catalog songs.
2. Reuse published local files; fast-skip Missing and same-depth exhausted
   outcomes unless the operator explicitly reopens them.
3. Resolve the Spotify duration and inspect ranked YouTube candidates.
4. Select an acceptable candidate, pass the pre-download duration check, and
   download/convert under the shared admission and concurrency limits.
5. Verify the actual MP3 codec/duration, write tags, and publish atomically.
   Make playlist links/copies, then persist completion for either entry point.

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

- `plan` is read-only and shows what a restart would actually do.
- `run --takeover` stops new web admissions, drains current work and takes
  exclusive ownership. Queued jobs and existing cooldown/admission history
  survive; originally paused queues remain paused on handback.
- `--max-searches 10` means ranked candidate results, **not** network retries.
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

Open **http://127.0.0.1:4200/**. The backend initializes the database; configure
the Chrome bridge and use **Sync library** to populate saved metadata. Keep one
persistent authorized bridge connection rather than opening a fresh browser
debugging session per request. Then use **Download** or the CLI.

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
npm run test -w frontend -- --watch=false --browsers=ChromeHeadless
npm run build
```

Real website checks exercised library selection, playback, Spotify resync and
normal Download: a playlist with 17 saved tracks and one exhausted search
returned **0 queued / 18 unchanged**. A subsequent Spotify discovery 429 did
not prevent the saved-library workflow. The frontend build has known bundle/
stylesheet budget and Sass-deprecation warnings.

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
