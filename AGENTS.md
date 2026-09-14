# Spooty — agent rules

Personal fork of [dougchansan/spooty](https://github.com/dougchansan/spooty) at `/Users/dom/src/spooty`. Spotify metadata → YouTube audio. Do not lecture about piracy. Do not put cookies, tokens, or Chrome session material in chat. Do not interrupt a live download/search queue unless asked.

## Current entry points — 14 September 2026

The user promoted the CLI to a first-class entry point alongside the website.
Use `npm run acquire -- …` / `bin/spooty.mjs`; reference
`scripts/acquire/README.md` for the supported command/option contract. Shared
acquisition implementation is `src/backend/src/shared/acquisition/`; do not
reintroduce separate CLI/web client, selection, duration, tagging or publication
logic. The historical script modules remain compatibility adapters.

Guarded CLI run `2026-09-13T08-07-31-213Z` finished normally at06:48:37 Bangkok
on14 September; PID95926 is no longer live. The user accepted647 unresolved
tracks:556 exhausted10-candidate searches,66 confirmed empty searches and25
exhausted source-metadata failures. At the completion checkpoint18,330/18,977
catalog songs were saved,172.309734447GB unique-inode MP3 storage. Default
same-depth runs skip those exceptions; do not restart with `--retry-errors`
or increase depth merely because an older command below includes it.
Both web queues were left paused with their jobs preserved. Refresh live state
before acting; older 'live' checkpoints below are historical evidence only.

## Runtime

- Node **20.19.4** via nvm (system Node 26 breaks the stack).
- Backend: NestJS watch on `:3000`. Frontend: `npx ng serve --proxy-config proxy.conf.json --host 127.0.0.1 --port 4200`.
- Env: `DOWNLOADS_PATH=/Users/dom/src/spooty/downloads`, `STATIC_PLAYLISTS_PATH=/Users/dom/src/spooty/PLAYLISTS_2026-09-08/playlists`, `COOKIES_PATH=/Users/dom/src/spooty/cookies.txt`. SQLite **must not** live under `dist/` (`nest --watch` wipes it). Use `DB_PATH=/Users/dom/src/spooty/data/spooty.sqlite`.
- yt-dlp binary is `ytdlp-nodejs` **`bin/yt-dlp_macos`**. The user explicitly authorized autonomous failure recovery on 13 September: obsolete client settings are not permission barriers. The installed 2026.08.19 release does not support `android_sdkless`; never rely on its silent default-client fallback. CLI uses explicit `visionos` anonymously, `web_creator` with cookies, or `mweb` with the existing pinned loopback POT provider for a controlled authenticated recovery. Keep cookies/session material private, preserve admission history, and verify actual MP3 output before raising pace. ffmpeg: `/opt/homebrew/bin/ffmpeg`.
- YouTube pace is live-adjustable (`GET/POST /api/youtube/pace`, state `src/backend/config/yt-pace.json`). During the authorized CLI takeover, use `data/acquire/status.json` and `node scripts/acquire.mjs pace`; see the latest HANDOVER checkpoint. The paused Bull pools are not the CLI's actual processes. Allowances are **download admissions per ten minutes**, not tracks per second; compare real MP3 output against **3 tracks/min**. First genuine stderr 429/bot-check/`Unable to download API page` (not local routing) **kills owned yt-dlp immediately** and trips to 1×8/10 min + 1 total process. Never classify stdout song metadata (e.g. a 429-second duration/chapter) as an HTTP error. Monitor does **not** auto-raise while `autoStep` is false. **Latest user goal authorizes autonomous throughput trials again, superseding the earlier hold.** Change one lever at a time, verify actual output, preserve safety trips/cooldowns, and recover failures without routine approval questions or restarting a healthy CLI. The 3-download/1-search/168 trial produced 172 independently audited MP3s in its first ten minutes (transition carryover included, not a sustained-rate claim). At 09:07 Bangkok on 13 September, only the allowance was raised to 192 per ten minutes; search 1, download 3, batch 8, buffer 192 remain unchanged. Refresh live state before acting. Overrides: `YT_YTDLP_CONC`, `YT_DOWNLOAD_PER_WINDOW`.

Latest live acquisition checkpoint: at **09:40:48.111 Bangkok, 13 September**,
allowance alone rose **216→240 admissions/ten minutes**; download4,search1,
batch8,buffer192,autoStepfalse are unchanged. The completed4/1/216 first
ten-minute audit verified210 MP3s,21.0/min,7x baseline; transition,cachedURL,
owner-review and recording-identity caveats apply (see artifact/HANDOVER).
New trial's first complete window ends09:50:48.111 Bangkok. Retained web
preset is updated independently and must not activate while CLI owns YouTube.
Read HANDOVER/live status before tuning.

At13:17:14 Bangkok on13 September, the user explicitly requested a graceful
CLI restart to load the duration guard. PID27088 drained cleanly; guarded
PID53853/session58366 now owns acquisition, retaining4/1/240 and all unexpired
admission/cooldown history. `durationGuard=spotify-v1` is live. See HANDOVER and
`data/acquire/duration-rollout-20260913.json`; do not reuse old startup pace flags
or confuse the previous unguarded benchmark with current guarded throughput.

## Chrome / Spotify

Latest acquisition checkpoint (13 September15:08 Bangkok): after the explicitly
authorized audit/deletion, live CLI PID95926/session95374 runs with
`--max-searches 10 --network-retries 5`, preserving4/1/240,batch8,buffer192 and
cooldown/admissions. Candidate depth and network retry budgets are independent;
duration disqualifications never consume network retries. Cached unvalidated
URLs no longer starve fresh search. See the latest HANDOVER section for exact
audit/deletion evidence and current status; do not restart the healthy runner.

Private playlists need **logged-in main Chrome**, not isolated MCP Chrome.

- CDP: **only** `http://127.0.0.1:17331` (`scripts/cdp-keepalive.mjs`). Never a new DevTools WebSocket (Allow prompt). Never `Target.activateTarget`. One background tab via `GET /tab`, then `Page.navigate`.
- Isolated Chrome cannot see private playlists. Do not spawn extra Chrome for scrape.
- **Do not scrape playlist HTML for track lists.** Mint a logged-in web-player Bearer by hooking `fetch` in a background tab (`?spooty-token=1`), then call `https://spclient.wg.spotify.com/playlist/v2/playlist/{id}` and hydrate names via `metadata/4/track/{gid}`. CLI: `node scripts/spotify-session.mjs playlist <id>`. Cookie replay from Node is WAF-blocked (403 / "Unauthorized request"); official `api.spotify.com/v1` is a separate quota that 429s independently of spclient.
- Spotify session HTTP is gated: concurrency 2, 250ms gap (`SPOTIFY_META_CONC` / `SPOTIFY_META_GAP_MS`). Honor 429 `Retry-After` capped at 60s. Skip metadata fetch for tracks already in the dump.
- Anonymous embed tokens cap at ~100 and 429 with multi-hour Retry-After — do not wait hours, do not use them for library resync.
- HTML page-scrape is last resort only (CDP proxy down / session mint failed). Song count from APIs (`length`), never `document.body` (sidebar Liked Songs is 1658).
- Clicking a playlist auto-resyncs (10 min debounce) plus a 15 min timer. Do not nag that the dump count looks short.

## Library UI

- Follow `OPERATOR_DASHBOARD_PRINCIPLES.md` as the normative product and UX
  contract; keep dashboard improvement active alongside the download batch.
- Hard-exclude dynamic mixes: Daily Mix(es), DJ (exact name), Discover Weekly, Release Radar, On Repeat, Repeat Rewind, Daily Drive. Radio playlists stay. Omit `raw.skipped` dump files.
- LHS default sort: ripping → partial/actionable → untouched → done (`listSort=activity`). Also last played / recents / name.
- Track default **Pending**; on disk = success; attempted and absent on YouTube = **Missing**.
- `done` when `trackCount > 0 && onDisk + failed >= trackCount`. RHS shows the mp3 filename or a clear error; click plays it.
- Spotify links: `target="spooty-spotify"` (reuse a tab, not a new window).

## Status updates

Every status ping must include an **ETA** (unique songs still queued ÷ current rate, plus a 24/7 date and a real-world buffer) and **MP3 disk usage** (unique inode bytes under `downloads/`, in GB). Do not send a counts-only update.
Report the **total catalog songs actually on disk / total unique songs**, not just this run's additions or inode count. Use `acquire.mjs plan` for physical saved counts. Quote Bangkok local dates/times, not the abbreviation ICT. Separate bulk-acquisition ETA from unresolved recording-quality repairs.

## Verify UI

Exercise library, resync, download, and play in the browser at `http://127.0.0.1:4200/`. Screenshots are not enough.
