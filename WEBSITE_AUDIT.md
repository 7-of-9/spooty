# Spooty website architecture and audit

Audited 2026-09-11 against the running app at `http://127.0.0.1:4200/`.
The normative product and UX contract is
`OPERATOR_DASHBOARD_PRINCIPLES.md`; this file records implementation findings,
fixes, verification, and remaining work.

## 13 September, 09:43 Bangkok: retain the measured216 allowance

The requested subagent updated retained4/1/192→4/1/216,21.0MP3/min,7x baseline,
with all original210-file audit caveats: transition,cachedURLs,ownerreviewwork,
two repaired initial mismatches and WATER still flagged at that audit. WATER's
later repair does not rewrite this historical evidence. Live4/1/240 remains a
separate, unproven trial. No activation or web-download benchmark.

23 backend tests/5suites,76frontend tests,both typechecks and diff check pass.
Existing mainChrome disclosure toggled/restored open at unchanged scroll,
retained216/live240 and disabled activation verified. Root independently checked
liveAPI profile and CLIpace, Redisowner and both paused/active0 queues with
1,792download/13,580search jobs preserved. CLI27088 stayed uninterrupted.

## 13 September, 09:36 Bangkok: retain the measured four-worker profile

The requested retrofit subagent updated only the retained profile and related
fixtures/comments to4download/1search/192admissions per ten minutes,batch8,
buffer192 (Bull32download/8search). It retains the190-MP3,19.0/min ten-minute
evidence, with transition, owner-review-work, cached-URL and recording-identity
caveats. Live CLI4/1/216 stays visibly separate and was not restarted.

Verification:23 backend tests/5suites,76frontend tests,both typechecks and diff
check pass. In existing mainChrome Spooty tab, disclosure was toggled and restored
open at unchanged scroll; retained192/live216 and disabled activation verified.
Root independently checked profile source and live API, plus Redis owner and
both paused web queues(active0,preserved1,792download/13,580search jobs). No
web profile activation, resync, playback or web-throughput benchmark was run.

## 13 September, 09:21 Bangkok: retain the measured three-worker profile

The user-requested retrofit now retains3 download /1 search processes,
192admissions/ten minutes,batch8,buffer192; logical Bull slots24download/8search.
Evidence:181 independently codec-verified MP3s in10minutes,18.1/min,6.03x
baseline, no blocks/retries, with explicit transition/carryover, owner-run
review-work, cached-URL and recording-identity caveats. The two full-album
mismatches present at that audit were subsequently repaired by root, preserving
the originals; the historical benchmark is not retroactively identity-certified.

Retained three-worker settings are visibly distinct from the live four-worker
CLI trial.119 backend tests/13suites,76frontend tests,both typechecks and diff
check pass. MainChrome Refresh plus profile disclosure showed retained3/live4,
disabled activation, and the prior current-rate/whole-run/Bangkok improvements.
Both web queues stayed paused/active0, retaining1,792download/13,580search jobs;
CLI27088 stayed alive. No web activation or actual web throughput benchmark.

## 13 September, 09:14 Bangkok: distinguish trial rate and whole-run rate

The CLI banner previously headlined the whole-run average while its ETA used
the current profile. It now explicitly shows both rates and their baseline
multiples; short-trial output is labelled provisional. ETA and buffered ETA
render explicitly in Bangkok local time (UTC+7), independent of browser zone.
Missing or malformed current-profile telemetry falls back to the clearly
labelled whole-run rate rather than inventing a trial result.

Verification: six backend snapshot tests, all76 frontend library-panel tests,
both TypeScript checks, and main-Chrome DOM/interaction checks pass. The live
page showed current18.42/min versus whole-run13.09/min and Bangkok dates,
841 playlist options, and disabled preset activation. Opened and closed the
profile disclosure and restored its previous state. The existing CLI owner
was not restarted, paused or signalled; no extra YouTube work was launched.
This was telemetry/UI verification, not a new resync, playback or web-download
benchmark. The retained2/1/144 preset remains separate from the live3/1/192 trial.

## 13 September, 01:13 UTC: CLI-proven web-ingest retrofit (no handback)

The Angular/Nest pipeline now retains the latest completed CLI profile separately
from mutable live pace: **2 download processes, 1 search process, 144 download
admissions per ten minutes, batches of 8**. Its first full CLI window produced
143 verified MP3s (14.3/min, 4.77x the 3/min baseline). This is cached-URL-heavy
file-output evidence, not a web benchmark or recording-identity guarantee.
The live CLI's newer 168 trial is shown separately, never labelled proven.

- Default web transport now uses explicit authenticated mweb + the existing
  hash-pinned loopback POT provider for downloads, web_creator for search,
  audio-first `ba/bestaudio/18/best`, MP3 quality 0, ignored ambient yt-dlp config,
  the reviewed packaged executable checksum, and Node 22 for EJS only.
- Each actual subprocess gets an independent 0600 cookie jar in a 0700 temporary
  directory, cleaned after success/failure. Empty explicit COOKIES_PATH fails
  closed; it cannot fall through to an unrelated jar. Master export is unchanged.
- Selected proven mode supplies 16 download / 8 search **logical Bull slots**
  to fill 2 / 1 subprocess batches. Old environment 12/6/96 values no longer
  silently select aggressive defaults. Persisted pace/history remains authoritative.
- Search defers its original Bull job for 30 seconds at a 192 waiting-download-
  job high-water mark, without consuming retries or sleeping in a worker. This
  conservative job-count buffer is not exactly the CLI's unique-URL buffer.
- Redis lease checks protect both acquisition HTTP ingress and actual process
  launches. A real empty-URI download request returned HTTP 409 while CLI owned
  work; no jobs were created. First genuine block remains stderr-only and now
  restricts web search plus download to **one total process** at the 1x8 floor.
- The expandable retained-profile card shows measured evidence, actual live CLI
  settings, stored web pace, precedence and the unbenchmarked-web qualification.
  Its explicit selection button/POST `/api/youtube/profile/cli-proven` requires
  no CLI owner, both web queues paused/active zero, no cooldown and no safety
  floor. A short compare-and-release maintenance lease prevents takeover races.
  Selection preserves admissions/history and never resumes queues. It was NOT
  invoked against live state; future handback remains a separate deliberate act.

Verification: **118 tests / 13 focused backend suites**, **76 library-panel
browser tests**, backend/frontend type checks and `git diff --check` passed.
Actual main-Chrome Spooty UI loaded 841 rows, expanded the new profile card,
showed 144 retained versus 168 live, and kept both acquisition/profile buttons
disabled. No Spotify resync, profile activation or web download was submitted.
Playback was unchanged and was not re-tested in this scoped iteration.
Both queues stayed paused/active zero, preserving 1,792 download and 13,580 search
jobs; CLI PID 27088 remained running throughout backend watch reloads.

Test-isolation incident: at **01:05:51–01:06:07 UTC**, three old missing-cookie
tests mocked existsSync but not the new stat check, so their run spies could fall
through to brief subprocesses before cleanup. Whether these reached YouTube is
unproven; root excludes that interval from sole-owner benchmark evidence. All
remaining yt-dlp children were verified CLI-owned. Default spawn/exec/execFile
deny mocks now prevent unmocked subprocesses in transport tests; all passing
results above are subsequent guarded runs. No master-cookie values were exposed.

## 13 September: truthful CLI ownership and audio range delivery

The approved acquisition-only experiment is live; ACQUIRE.md and HANDOVER.md
supersede the older statement below that a CLI is unnecessary. The existing
GET /api/youtube/pace response now includes an allowlisted acquisition snapshot
only when the process, matching owned handoff and recent timestamp agree.
The underlying web-worker pace is unchanged. The dashboard separately shows
CLI ownership, actual MP3/min versus the 3/min baseline, unique remaining and
GB, plus bulk ETA and 25% buffer. Missing/stale/dead telemetry is not presented
as live. Acquisition actions remain disabled while the CLI owns the workload.
Explicit Refresh and return-to-visible refresh telemetry after background-tab
timer suspension.

The local audio endpoint advertised byte ranges but ignored Range headers.
It now uses Express sendFile, returning Content-Length and true partial 206
responses. A live 0–1023 request returned exactly 1,024 bytes; regression tests
cover partial, suffix and HEAD requests.

Verification: 75 library-panel tests, five telemetry tests and two audio-range
tests pass. Main Chrome loaded all 841 saved playlists, showed real CLI metrics,
and kept acquisition controls guarded. Background-tab Play attempts did not
reach readyState > 0, so advancing/audible playback remains unverified; the
player was closed. No resync or competing web acquisition was launched.

ETA now exposes its own capped current-profile rate separately from the
whole-run headline rate and labels profiles younger than ten minutes as a
new-trial projection. This avoids implying a short startup burst is sustained.

Follow-up at 00:40 UTC: a separate local-only browser decode probe against the
real MP3 endpoint passed with readyState 4, duration 329.76 s and advancing
currentTime 0.460666 s. Its ephemeral headless test browser explicitly allowed
autoplay; default autoplay was blocked. This verifies real HTTP media delivery
and browser decoding, not a successful user click in the hidden main-Chrome
tab. Probe files: /tmp/spooty-live-audio-qa.KTN75z. The main player stayed closed.

Follow-up at 00:52 UTC: an incremental watch restart was stuck shutting down
PID 67299. Port 3000 had no listener, but one Angular proxy connection remained
open to that process. The installed Nest Express adapter documents and supports
`forceCloseConnections`; bootstrap now enables it for shutdown. After confirming
both web queues paused with zero active jobs, the already-stopping backend child
was terminated so watch could replace it. New PID 3619 listened at 00:51:48;
CLI PID 27088 and its files/jobs were unaffected. The API and existing main-Chrome
tab both showed live CLI metrics, the separate ETA rate and disabled acquisition
controls again at 00:52. No user download queue was interrupted.

## Intended operator flow

The website is now organised around this loop:

1. Open Spooty.
2. Spooty loads the saved local library immediately and starts a quiet Spotify
   library sync in the background.
3. New and changed Spotify playlists are added or refreshed. Finished playlists
   remain visible but sort below active and incomplete playlists by default.
4. Use **Search & download needed**, or select a smaller set of incomplete
   playlists and press **Download**.
5. Search and download state arrives over Socket.IO. Completed files are saved
   below `DOWNLOADS_PATH`; the next page visit sees them on disk and demotes the
   completed playlists.

The command-line version considered during the audit is not currently needed:
the web API already exposes sync, resync, enqueue, queue state, pacing, and audio
playback, while the browser presents the useful operator view of those actions.

## Architecture

```text
Angular :4200
  |-- GET /api/library --------------------- JSON dumps + disk + SQLite status
  |-- POST/GET /api/library/sync ----------- Spotify library discovery
  |-- POST /api/library/resync/:id --------- Spotify playlist contents
  |-- POST /api/library/download* ---------- create/reuse track work
  |-- GET /api/library/audio/:playlist/:n -- local MP3 playback
  |-- GET /api/playlist/summary ------------ lightweight queue playlists
  |-- GET /api/track/active ---------------- active track rows only
  `-- Socket.IO <--------------------------- live track/playlist/progress events

NestJS :3000
  |-- LibraryService -------- joins playlist JSON, files, and DB state
  |-- SpotifySessionService - token + Spotify HTTP request gate
  |-- TrackService ----------- idempotency, reuse, DB state, BullMQ enqueue
  |-- YoutubeService --------- yt-dlp/ffmpeg and global pace gate
  `-- BullMQ/Redis
       |-- track-search-processor
       `-- track-download-processor

Durable state
  |-- PLAYLISTS_2026-09-08/playlists/*.json  Spotify playlist snapshots
  |-- data/spooty.sqlite                     playlist/track workflow state
  |-- Redis                                  pending and delayed BullMQ work
  |-- downloads/                             audio truth
  `-- src/backend/config/yt-pace.json        live YouTube pace state
```

The JSON snapshots define membership and order. SQLite records the processing
state of playlist/track rows. Redis owns runnable work. The filesystem is the
decisive truth for whether audio really exists.

## Spotify and CDP

CDP is required for **live Spotify discovery and resync**, because private
playlists require a bearer token minted in the already logged-in main Chrome
profile. It is not required to:

- display the saved local library;
- play existing MP3s;
- search YouTube;
- download from YouTube; or
- process work already present in SQLite/Redis.

The only browser-control route is the keepalive bridge on
`http://127.0.0.1:17331`. The backend calls `GET /tab`, hooks `fetch` in that one
background tab, and navigates it when a fresh logged-in token is needed. It does
not open its own DevTools WebSocket or activate a foreground tab.

Library discovery pages through the current user's playlist collection, using
playlist IDs, names, `snapshot_id`, and item totals. Only new playlists or
playlists whose snapshot/count changed are hydrated. Track membership comes from
Spotify's playlist-v2 endpoint and names are hydrated through Spotify metadata;
already-known track IDs skip the metadata request. Requests are gated at two
concurrent calls with a 250 ms start gap and capped `Retry-After` handling.

If CDP is unavailable, the page remains useful and explicitly says it is showing
the saved library. It never replaces a good playlist snapshot with an empty or
truncated response.

## Download lifecycle

For a requested playlist, the backend walks its saved track occurrences and:

1. accepts a non-empty destination file as complete;
2. otherwise hardlinks a matching MP3 already present in another playlist
   (copy fallback across filesystems);
3. otherwise reuses a known YouTube URL from a sibling DB row where possible;
4. otherwise enqueues a YouTube search;
5. enqueues a download after a successful search; and
6. marks the row complete only after a real non-empty audio file exists.

The yt-dlp process starts only after the global pace gate admits it. A first
bot-check/429/API-page failure kills that process, drops to the 1 process ×
8 requests/10 minutes floor, and begins cooldown. Transient failures use delayed
BullMQ jobs rather than sleeping inside workers.

During the one-hour post-bot recovery window, downloads can use the pinned
loopback bgutil POT provider with cookies and the `mweb` client. The Nest stack
stays on Node 20.19.4 while yt-dlp alone receives a Node 22+ EJS runtime path;
without that split, current YouTube `n` challenges expose only storyboards even
when POT generation succeeds. Search does not load the POT plugin.

## Findings and fixes applied

- Opening the old site refreshed only the static dump. It could not discover a
  playlist added in Spotify. A background library-sync endpoint and UI lifecycle
  now discover and selectively resync new/changed playlists.
- The old activity sort was effectively backwards for the desired workflow.
  Live processing playlists now lead, followed by partial/actionable, untouched,
  and finally finished playlists. A playlist with historical missing rows is
  still shown as active while those rows are being retried.
- The initial detail pane used to stay on a stale pre-hydration playlist even
  after live queue state moved an active playlist to the top. It now follows the
  first live playlist once, while preserving any explicit operator selection.
- Equal-count Spotify edits were missed. `snapshot_id` now detects replacements
  where the total did not change once a trusted snapshot baseline exists.
- Repeated track occurrences were discarded during Spotify paging. Occurrences
  are now preserved while metadata HTTP work is still deduplicated by track ID.
- A truncated or non-advancing Spotify page could be written as if complete.
  Pagination now marks truncation, and the library checks that flag before the
  fetched rows can become a write candidate. A regression test proves that an
  equally sized truncated response preserves the existing dump byte-for-byte.
- Playlist JSON was written directly. Updates now use a same-directory temporary
  file followed by atomic rename.
- Existing DB rows prevented cross-playlist MP3 reuse. Reuse now runs before the
  existing-row decision in the HTTP path and again inside both workers.
- A guarded local-only sweep found 768 open playlist rows whose audio already
  existed under `downloads/`; it created 762 hardlinks, reconciled 6 existing
  files, and consumed no additional unique-inode bytes. A second guarded pass
  removed 769 now-redundant paused queue jobs (including the earlier browser
  no-op reconciliation), so resumed workers start with genuine source work.
- A stale Bull payload could perform work after the DB state had changed. Workers
  reload the current row and playlist before acting.
- A DB row marked Complete but missing its file was permanently skipped. The
  download action now retries that stale row.
- Track matching in one enqueue path was case-sensitive. It now uses the same
  normalised filename key as filesystem reuse.
- Conflicting duplicate-row states could make an arbitrary error win in the
  library view. State aggregation now prefers completed/active work over a stale
  sibling error.
- yt-dlp status was changed before waiting for admission, making sleeping jobs
  look active. Searching/Downloading is now set only when the process starts.
- A killed/restarted worker could still leave its durable row at Searching or
  Downloading, so a recovered job waiting behind cooldown again looked active.
  Worker preflight now resets those stale rows to New/Queued; live verification
  during a 30-minute cooldown shows `0 downloading · 0 searching` while queued
  playlists remain visible.
- Pace waiters could pass a cooldown tripped by another waiter. Admission is now
  revalidated after lock acquisition.
- Repeated confirmed blocks at the floor reused the short first-event cooldown,
  causing a known-blocked route to be probed every few minutes. A repeat within
  one hour now gets a 15--30 minute cooldown, while the first signal still gets
  the normal fast floor transition.
- Batched search always retried anonymous `android_sdkless` after cooldown, and
  an already-waiting unbatched search could make the same stale decision. Both
  now re-evaluate the shared bot signal after pace admission and use cookies +
  `android_sdkless` throughout the recovery window, failing closed if the
  required cookie file is unavailable.
- Cover-art failure incorrectly failed an otherwise good MP3. Cover embedding is
  now best-effort after audio success.
- The optimal one-file yt-dlp path accepted exit code zero even when no output
  existed, allowing a phantom Completed row. Both the downloader and Track
  service now require a non-empty regular audio file; transient no-output cases
  stay queued through delayed retry.
- A graceful backend shutdown rejected in-flight downloader promises with an
  error that was not classified as retryable. Shutdown-aborted jobs now return
  to Queued instead of being consumed as terminal failures.
- Every exhausted operational failure was counted as Missing and could make a
  playlist look done. The library now treats only the exact terminal search
  result `No YouTube result` as Missing; network, bot, timeout, dependency, and
  local-output failures remain actionable and are labelled **Needs retry**.
- **Search & download needed** retried every known permanent miss. Whole-library
  work now skips terminal misses, while an explicit playlist Retry remains the
  opt-in route for searching them again.
- Filesystem reuse accepted empty files and could hardlink M4A/FLAC bytes under
  an `.mp3` name. Coverage and reuse now require a non-empty file in the
  configured output format.
- Initial page load fetched a 5.70 MB nested playlist payload and then made 841
  per-playlist track calls. It now uses two calls totalling about 0.67 MB:
  playlist summaries plus active tracks.
- The legacy queue drawer called all 841 stored playlists “jobs”. It now shows
  only playlists with searching, queued, or downloading rows.
- The whole-library enqueue button remained clickable while a large queue was
  already live. It is now disabled whenever searching, queued, or downloading
  work exists, preventing an accidental duplicate full-library enqueue.
- Selecting every incomplete playlist still exposed a second bulk Download
  route around that guard, and enqueue responses called every no-op “already on
  disk.” Both bulk routes are now disabled while live queue work exists, and the
  result text truthfully groups unchanged rows as already saved, already queued,
  or known missing.
- Queued rows alone kept a full disk/database coverage scan running every five
  seconds, even while the queue was paused. Polling now runs only while a search
  or download process is actually active; Socket.IO continues to carry queued
  state.
- Component timers and sync polling had cleanup/order races. Intervals are now
  installed before the first poll and disposed on destroy.
- Quiet refresh could erase a useful CDP error. The saved-library fallback notice
  now persists.
- Initial focus and background library discovery could resync two Spotify
  playlists on page open. Programmatic initial focus no longer starts a second
  resync; later user focus still uses the normal ten-minute debounce.
- CDP bridge and Spotify session HTTP calls had no client-side deadline, so a
  half-open local bridge or upstream socket could leave unattended sync marked
  running forever and occupy a metadata-gate slot. Both paths now abort within
  configurable bounds and return explicit timeout failures to the saved-library
  fallback.
- Watch-mode reloads left two old backend children renewing 24 job locks. The
  exact stale children were stopped and all 24 jobs were moved, without deletion,
  back to the paused queue.
- `REDIS_RUN=false` was treated as true because it was a non-empty string, so a
  watch reload started a second unused Redis server. Startup now parses an
  explicit true value; the extra child was removed and the queue remained on its
  original Redis instance.
- The hourly subscribed-playlist query passed its filter as a relation map, so
  it could not reliably select active playlists. The argument order is fixed,
  recovered playlists clear stale errors, and a regression test covers it.
- New DB rows could inherit a schema default captured at process start instead
  of their actual creation time. Save paths now always supply `Date.now()`.
- A playlist literally named `..` could resolve outside `DOWNLOADS_PATH`.
  Playlist directories are now checked to remain beneath the downloads root.
- Nest previously listened on `*:3000`, although the Angular development server
  was correctly restricted to `127.0.0.1`. The unauthenticated local API now
  defaults to `127.0.0.1` (`BIND_HOST` remains configurable); live `lsof` and
  frontend-proxy requests verify the loopback listener.
- Local MP3s, Spotify snapshot dumps, Redis state, and generated coverage files
  were exposed as untracked repository content. Root ignore rules now prevent
  those machine-local artifacts from being included in a future commit.
- The guarded local-audio reconciliation checked for active downloads but not
  active searches. Its apply guard now requires both Bull queues to be paused
  and both active counts to be zero before it can touch files or SQLite rows.
- The in-progress banner treated queued and retry-scheduled rows as currently
  running work. It now lists only search/download processes, and waiting
  playlists keep their truthful labels without a process spinner.
- The operator surface did not expose the live YouTube safety floor or start
  window, so a 1+1 / 8-per-10-min queue looked stuck. The sidebar now reads
  GET /api/youtube/pace and shows conc, window usage, and a safety-floor or
  cooldown note without the raw trip reason.
- Library-wide sidebar counts said “tracks” for playlist occurrences, so
  remaining work looked larger than unique songs. Totals now say occurrences
  for both the dump size and the still-needed count, and the saved total is
  labelled on disk so it is not mistaken for unique songs.
- The live-work drawer was titled Download queue even when almost all jobs
  were search/waiting. It is now Live queue.
- The sidebar activity line wrapped to two rows when a download and a search
  ran together (`1 downloading · 1 searching · 1,076 waiting · 10 retries
  scheduled`). It now stays one compact ellipsized line.
- Narrow layout capped the sidebar at 36vh, shorter than the chrome, so the
  playlist list could vanish. Stacked panes now split height, the head
  scrolls, and the list keeps a minimum height. Playlist detail coverage
  says on disk, matching the sidebar.
- Quiet coverage polling hit GET /api/library every 5s whenever any search or
  download was running, which at the 1+1 floor is nearly always. Coverage now
  rescans when running work finishes, plus a 60s heartbeat.
- Retry-scheduled track rows used the in-progress highlight. Only running
  search/download rows are is-wip now, and on-disk rows are keyboard-playable.
- The in-progress banner named the track but not the playlist, and was not
  activatable, while an open live-queue drawer (38vh) crushed the track table
  to ~137px. Banner rows now name the playlist and open it; the queue overlays
  and closes on select so track evidence stays visible.
- Safety-floor copy said next window when the 10-minute download window was
  full, so 1,400 waiting jobs with 0 downloading looked stalled. The note is
  now downloads held unless a download is actually running (window full).
- Switching playlists kept the old track-table scroll, so a searching row
  could sit above the viewport; scroll now waits for render and targets the
  in-progress row (else the first waiting/pending/retry row). Queued playlist
  pills said Queued next to a Waiting subtitle; they now say Waiting.
- Play/Pause used an optimistic paused flag, so a blocked or not-yet-loaded
  file kept showing Pause while the audio element was paused. The label now
  follows the element.
- Library-wide “N on disk” sat beside “occurrences” without saying the saved
  count was also playlist occurrences, so 5,413 on disk looked like unique
  songs. Totals are now N/M occurrences on disk.
- Ripping playlist remaining-work lines were clipped (`16/79 · 1 downloading
  · 62 waiting` overflowed the 340px sidebar). The row now uses the compact
  activity wording and keeps the full sentence in title.
- A paused leftover player bar kept eating ~50px of the track table after
  playback stopped. Close dismisses it, and ended tracks hide the bar.
- Track rows treated on-disk as decisive even while a live download was
  running, so a ripping playlist showed 41 on disk and 0 in-progress. Running
  search/download now wins over the file flag; the filename and Play control
  stay when the file exists.
- Ripping playlist rows counted only live socket jobs, so a 206-track playlist
  with 26 on disk looked like 23 remaining. Pending dump remainder is now
  listed first (`157 pending · 1 search · 22 waiting`).
- The same Mozart movement was Downloading on one playlist and Queued on
  another; artist/title liveMap last-write showed Waiting and 0 in-progress
  rows. Live status is now playlist-scoped, and a running job wins the
  unscoped fallback.
- Ripping playlist remaining-work omitted confirmed misses, so Luk Isaan
  looked like 2+4 pending+294 waiting = 300 of 307. Missing now appears on
  the left (`7 missing`), and a finished playlist with misses is labelled
  Finished rather than Done.
- Switching playlists kept the previous track table and attributed those
  live jobs to the newly focused row (This Is Ravel showed Downloading and
  hundreds waiting). Detail is now cleared until the matching playlist
  payload arrives, and remainder stats ignore a mismatched detail.
- Incomplete playlist rows counted copyable tracks as YouTube-needed
  (`23/50 on disk` + `27 needed` while 7 already existed elsewhere). Idle
  copyable remainder is now named on the line and removed from the needed
  count; copyable songs already waiting in the live queue are not
  double-counted.
- Waiting track pills used class `queue`, so live-queue drawer rules
  (`flex-direction: column`, gray top border, z-index) leaked onto every
  Waiting label. Pills are now `pill waiting` and the drawer is
  `live-queue`.
- Live activity reorder left the focused playlist off-screen (Sexy and I
  Know It Radio selected, list scrolled to the new searching row). The
  navigator now scrolls the focused row back into view when its offset
  moves. Track status also stops falling back to a global artist/title
  live map once the focused playlist has a DB identity, so another
  playlist's download cannot look like this folder's in-progress row.
- The File column concatenated the Play control with the MP3 name
  (`Play Artist - Title.mp3`) and stacked the button above the filename.
  Play/Pause is now a dedicated column; File is the filename only.
- On reload, Search & download needed was enabled until `/api/track/active`
  returned, so a click could duplicate the live batch. Bulk actions now
  stay disabled with “Checking live queue…” until that fetch completes.
- The in-progress banner sat under the focused playlist track table, so
  Luk Isaan downloading looked like a footnote on Drum Death Radio. It
  now leads the main pane, above the selected playlist.
- Socket.IO track updates ran outside Angular's zone, so a live search
  could sit in component state (`liveSearching === 1`) while the banner
  and activity line still showed only waiting work. Websocket handlers
  now run inside NgZone.
- The download-queue drawer reused the old playlist box, which exposed
  delete, retry, and subscribe controls on live work and issued per-playlist
  track-count requests. It is now a read-only name + activity list.
- Hide finished treated a fully-saved playlist as gone even when it still had
  live queue work. The filter now keeps ripping playlists visible. Attention
  counts and Select incomplete also treat that live work as needing action.
- Playlist click and the 15-minute timer still auto-resynced after a Spotify
  429, quietly probing a known-degraded session. Auto-resync now waits until
  library sync succeeds; explicit Resync from Spotify still works.
- Page load POSTed a new quiet library sync even when the last attempt had
  just 429’d, so every refresh retried Spotify. Load now reuses a failed
  status younger than 15 minutes (until explicit Sync after a 429) and still offers
  an explicit Sync button. A 60-minute 429 hold was still too short: the next
  quiet POST failed again. Quiet discovery now stays off after a 429 until
  the operator clicks Sync library.
- Disabled bulk search/download buttons explained the live queue only via
  title tooltips. They now point aria-describedby at the visible Queue is
  live note.
- The File column showed predicted `Artist - Title.mp3` names for waiting,
  pending, and copyable tracks, so unsaved rows looked like on-disk evidence.
  Filenames now appear only when a local file exists. The in-progress banner
  counted queued and retry-scheduled jobs under “In progress”; those counts
  now include only running search/download processes.
- The sidebar head consumed about half an ordinary desktop viewport, and
  Search & download needed wrapped under narrower actions. The primary
  action is now first and full-width. Pace copy is `1+1 · 8/8 this 10m` on
  one ellipsized line; Refresh and Sync sit beside the filter field so Hide
  finished/sort stay on one row. A later live snapshot was still 314px of
  chrome on a 761px-tall window (title, disk, attention, activity, pace,
  actions, queue guard, search, filters, and a wrapping 429 notice stacked).
  Disk/attention now share one stats block, activity/pace share one live
  block, the Queue is live note sits under the primary action, and the
  saved-library 429 notice is one ellipsized line.
- Keeping a waiting focused playlist in view on every live reorder hid
  currently searching/downloading rows at the top of the navigator. The
  sidebar live block now names those running playlists, a click opens them
  without a Spotify resync, and live reorders only chase a focused row
  that is itself searching or downloading.
- The playlist listbox marked the focused row as aria-selected, ignored
  Space/Home/End, and left every checkbox in the tab order. Selection now
  follows the checkboxes, Space toggles the focused row, Home/End jump,
  and checkboxes are tabindex="-1".
- Incomplete playlist pills said 0 needed when the leftover was only
  needs-retry or copyable (Relax Radio 49/50 with one operational
  failure). The pill now names Needs retry or N copyable.
- Sidebar attention said occurrences need action while the live queue
  was already processing that leftover. It now says remaining while
  search/download work is live. A focused playlist whose leftover is
  only needs-retry or copyable offers Retry/Copy instead of Download
  this playlist.
- The in-progress banner and activity line showed 3 searching while
  GET /api/youtube/pace and /api/track/active had 1. Extra Searching
  rows are now treated as Waiting up to the live pace cap, and the
  active-track store is reconciled.
- 718 leftover playlists still said needed while their dump remainder
  was already in the live library search/download queue (SQLite New /
  Bull search jobs are not in `/api/track/active`). Those rows now show
  waiting, sort with processing work, and do not offer Download this
  playlist.
- This D.J. Radio showed 15 needs retry · 9 waiting on a 28/50 playlist
  (52) because extra SQLite Error rows for songs already on disk were
  maxed into the remainder. The focused table is now the needs-retry
  source, and leftover counts clamp to the dump size.
- Live queue said 69 playlists in queue while 783 leftover rows were
  already waiting in the library search/download pipeline. The toggle
  now splits socket-live jobs from implied-waiting leftovers.
- A focused ripping playlist showed Searching · 16/862 and hid ~845
  waiting leftovers. The disabled action now uses the compact remainder
  line (`1 search · 845 waiting · 16/862`).
- The playlist listbox a11y tree was 841 “Select …” checkboxes with no
  remainder. Options now label name plus leftover, and checkboxes are
  aria-hidden.
- Hiding those checkboxes dropped every playlist option from the
  accessibility tree. A screen-reader-only remainder on each option
  restores name plus leftover without the 841 Select controls.
- Safety-floor cooldown still showed 1 searching while pace searchActive
  was 0. In-progress caps now use live active slots during cooldown.
- After floor recovery, pace showed 2–3 live yt-dlp slots while the
  dashboard stayed at 16,633 waiting and hid the in-progress banner
  because `/api/track/active` was not refetched once Socket.IO missed
  Searching/Downloading transitions (New search jobs are omitted from
  that endpoint until they start). Pace active > live process counts now
  refetches active tracks. Playlist `statsOf` is memoized so the 841-row
  list does not recompute leftovers on every binding.

## Verification

- Backend TypeScript check: passed.
- Backend Jest: 19 suites, 128 tests, all passed.
- Frontend app and spec TypeScript checks: passed. The full Karma suite now
  passes 87/87, including contracts for activity ordering, active-state display,
  initial live focus, operational-failure labelling, process-only in-progress
  banner/spinners, YouTube safety-floor/window copy, occurrence labelling, a
  read-only live queue drawer, Hide finished keeping live work visible,
  skipped auto-resync while Spotify sync is degraded, skipped quiet
  library-sync POST after a recent failure, with no quiet retry after 429,
  aria-describedby from disabled bulk actions to the live-queue note,
  on-disk-only File-column filenames, in-progress banner counts limited
  to running search/download processes, playlist listbox keyboard/ARIA
  selection, in-progress banner playlist navigation, live-queue overlay
  close-on-select, safety-floor window-full copy that names held
  downloads, Play restored when the first local playback is blocked, track-table
  scroll to running/actionable work, Waiting (not Queued) playlist pills,
  Play/Pause following the audio element's paused state, ripping remaining-work
  lines that include confirmed misses, Finished (not Done) for playlists
  whose leftover rows are permanent misses, dropping the previous track
  table when switching playlists, copyable remainder named on playlist
  rows instead of YouTube-needed counts, Waiting pills isolated from
  live-queue drawer styles, focused playlist rows kept on-screen after live
  reorder, no unscoped live-status fallback onto another playlist's
  occurrence, File-column evidence that is the MP3 name without a Play
  prefix, bulk download disabled until the live queue is fetched, and the
  in-progress banner above the focused playlist detail, and Socket.IO
  live updates applied inside Angular's zone, and a compact sidebar head
  that keeps disk/attention stats, live activity/pace, the queue guard
  under the primary action, and a single-line 429 saved-library notice,
  running search/download playlists named in the sidebar live block, and
  live list reorders that keep a running focused row in view without
  chasing a waiting focused row away from processing work, and incomplete
  playlist pills that name needs-retry or copyable leftover instead of
  0 needed.
- Angular production build: passed. Existing Sass `@import` and initial-bundle
  budget warnings remain.
- Live endpoints: playlist summary 173 KB/5 ms; active tracks 496 KB/15 ms;
  library view 357 KB/727 ms in the measured run.
- Browser exercised: saved-library load, activity ordering, filter/sort,
  playlist focus/detail, local play/pause, live queue drawer, a completed
  50-track download no-op (0 queued, 50 safely skipped), resync failure safety,
  and CDP-down fallback messaging.
- Current browser view: 841 included playlists, 23,289 track occurrences, and
  17,568 occurrences needing action. Disk/attention stats, live activity/pace,
  the queue guard, and the 429 saved-library notice now fit in a 271px sidebar
  head on a 761px desktop window (was 314px), leaving 446px for the playlist
  list. The UI's saved count is labelled as occurrences; storage reporting
  uses unique inodes instead.

## Remaining work, in order

1. Restore the existing main-Chrome keepalive bridge on `127.0.0.1:17331`
   without opening another DevTools WebSocket or activating a tab, then run one
   complete live library sync. Confirm that a newly added playlist appears and
   that a same-count edit is detected without rewriting unrelated snapshots.
2. Hold the proven live `5 download + 1 search / 64 starts per 10 minutes`
   allocation while the URL-ready buffer is healthy. Direct clean samples made
   4.55--4.70 MP3/min; 6+1 was slower, and 5+2 completed the same total number
   of search+download operations but landed 13% fewer MP3s. As the ready buffer
   approaches exhaustion, move toward 3+3 so search supply keeps downloads
   fed. Any confirmed bot/429/API-page block must trip globally to the 1+1 /
   8-per-window floor and start cooldown.
3. Replace global artist/title identity with a durable normalised track key plus
   explicit playlist occurrences. This removes the remaining ambiguity when the
   same song has conflicting DB rows or materially different versions share a
   title.
4. Cache or incrementally maintain the filesystem/DB coverage indexes. The
   current 0.7 second library scan is acceptable locally but scales linearly and
   repeats during active five-second refreshes.
5. Persist background sync/resync progress so an API restart cannot erase its
   status. The current exact-error classification is correct at the UI boundary;
   a dedicated failure-kind field would make that contract durable and easier
   to query.
6. Replace the old Bulma Sass import and decide whether to split the initial
   Angular bundle; these are build-quality warnings, not current functional
   blockers.
7. Establish a membership baseline before storing the first `snapshot_id` for
   legacy dumps. All current legacy files lack a snapshot ID, so a same-count
   edit made before the first successful CDP sync could otherwise be accepted as
   the baseline without being observed. A safe implementation should page the
   membership endpoint once while reusing the already stored track metadata.
8. Reconcile genuine Spotify removals separately from incomplete responses. The
   current shrink guard deliberately keeps the larger local snapshot, which
   prevents data loss on truncation but also retains tracks/playlists the user
   has intentionally removed from Spotify.
9. Make the last-resort HTML scraper return Spotify's declared item count and a
   truncation flag, and preserve repeated playlist occurrences. The primary
   session API already refuses truncated snapshots, but HTML fallback cannot yet
   prove completeness before a write.
