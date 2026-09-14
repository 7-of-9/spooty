# Spooty operator dashboard principles

This is the normative product and UX specification for the Spooty website.
`WEBSITE_AUDIT.md` records architecture, findings, fixes, verification, and the
remaining implementation backlog. When implementation and this document
disagree, resolve the discrepancy deliberately rather than silently changing
the operator workflow.

## Product purpose

Spooty is a local operator dashboard for keeping a saved Spotify playlist
library backed by playable MP3 files. The primary job is not browsing Spotify;
it is answering four questions quickly and truthfully:

1. What is new or changed since the last visit?
2. What is being processed now?
3. What still needs a YouTube search, download, or retry?
4. What is safely saved on disk already?

The desired default visit is:

1. Open the website and see the saved library immediately.
2. Let Spotify discovery and changed-playlist sync run quietly in the
   background.
3. See processing and actionable playlists at the top without hunting for
   them.
4. Press one clear **Search & download needed** action.
5. Watch truthful live progress or leave it unattended.
6. Return later and find completed work recognised from durable state and
   demoted below work that still needs attention.

**14 September 2026 product direction:** the user promoted the acquisition CLI
to a first-class entry point alongside the website. Both must use one shared
download/selection/verification stack and durable outcome history, not divergent
implementations. The website remains a complete operator surface; the CLI is
documented in `scripts/acquire/README.md`. Entry-point changes must preserve
saved files, metadata, queued jobs, skip decisions and safety cooldowns. Only
one scheduler owns YouTube work at a time. Measure newly verified MP3s against
the3/minute baseline, not searches, admissions or staging files.

## Information architecture

- The left side is the work queue and playlist navigator. Its default
  **Needs work first** order is:
  1. currently processing;
  2. partially completed or otherwise actionable;
  3. untouched;
  4. finished.
- Within an actionable group, playlists with more remaining tracks lead. Other
  useful explicit sorts may include last played, Spotify recents order, and
  name.
- The right side explains the focused playlist and its individual tracks. It
  must show totals, saved count, missing count, current activity, actionable
  controls, and per-track outcome evidence.
- Filtering and **Hide finished** refine the view without changing the durable
  state or silently hiding active work.
- Dynamic Spotify mixes are excluded because they are not stable library
  assets. Radio playlists remain eligible. Dumps explicitly marked skipped are
  omitted.

## State must be truthful

The interface reports observed state, not optimistic intent:

- A non-empty file under `DOWNLOADS_PATH` is the decisive proof of success.
- SQLite records durable playlist and track workflow state.
- Redis/BullMQ records runnable, delayed, and active work.
- Spotify snapshot dumps record playlist membership and ordering.
- Conflicts are resolved toward physical truth and the most current actionable
  state; a stale database label must never overrule a real file or active job.

Track labels have specific meanings:

- **Pending**: never searched or not yet queued.
- **Waiting**: durably queued but no process is running for it.
- **Finding on YouTube**: a search process is running now.
- **Downloading**: a download process is running now.
- **Retry scheduled**: a retry exists with a future admission time.
- **Needs retry**: an operational failure occurred and the track remains
  actionable.
- **Missing**: a completed search positively found no YouTube result.
- **On disk**: a non-empty playable local file exists.

A playlist is finished only when `trackCount > 0` and every occurrence is
either on disk or a confirmed permanent miss. A finished playlist containing
misses remains visibly distinguishable from one with every track saved.

## Action-first, safe controls

- **Search & download needed** is the primary whole-library action. It should
  search and download unfinished work without redoing saved files or repeatedly
  probing known permanent misses.
- A focused playlist and an explicitly selected set of incomplete playlists
  remain available as narrower actions.
- Repeating an action must be idempotent. Existing files, existing queue work,
  and already-known URLs are reused rather than duplicated.
- Whole-library and mass-selection actions are disabled while a live queue is
  already present. The explanation must be visible, not implicit.
- An explicit playlist retry is the opt-in route for retrying confirmed misses.
- Destructive actions are never bundled into refresh, sync, download, or
  playback.
- Result messages distinguish newly queued, already saved, already queued,
  known missing, and failed work instead of calling every no-op a success.

## Local-first Spotify sync

- Page load never waits for Spotify or CDP before showing saved state.
- On load, the dashboard quietly discovers the current Spotify playlist
  library. It imports new playlists and refreshes only playlists whose snapshot
  or membership changed.
- Selecting a playlist may auto-resync it with a ten-minute debounce. A
  fifteen-minute background cycle keeps an open dashboard current without
  excessive metadata traffic.
- Private playlist discovery uses the persistent bridge at
  `127.0.0.1:17331`, the logged-in main Chrome profile, and a background tab.
  Angular does not call CDP or Spotify directly; the Nest backend invokes the
  TypeScript Spotify session layer, which talks to the Node CDP bridge.
- Track lists come from Spotify APIs, not playlist-page HTML. Declared API
  counts, pagination completion, and snapshot identity determine whether a
  response is safe to persist.
- A failed, truncated, rate-limited, or timed-out sync never replaces a known
  good snapshot. Writes are atomic.
- If CDP or Spotify is unavailable, the dashboard continues to load, play, and
  process the saved local library and says clearly that live sync is degraded.

## Durable, unattended operation

- Search and download work survives page refreshes, browser closure, and Codex
  restarts because it is owned by the backend, database, filesystem, and queue.
- UI activity labels represent actual running or queued work. Jobs waiting on a
  cooldown are not misrepresented as active processes.
- Sync and metadata calls have bounded deadlines. No half-open CDP or upstream
  request may leave the dashboard permanently showing “syncing.”
- Transient failures use durable delayed retries rather than sleeping inside a
  worker.
- The first genuine YouTube block signal trips the global safety floor. The UI
  exposes the resulting queue state truthfully without encouraging duplicate
  submissions.

## Evidence and playback

- Every saved track shows the actual MP3 filename.
- Every failure shows a clear, useful error classification.
- Clicking a playable track starts the local file; play/pause must work in the
  real browser.
- Spotify links reuse the named `spooty-spotify` tab instead of opening a new
  window for every click.
- Counts state whether they represent unique songs or playlist occurrences.
  Disk storage uses unique inode bytes so hardlinks are not double-counted.

## Responsiveness, accessibility, and performance

- The highest-priority state and primary action remain visible without
  scrolling on an ordinary desktop viewport.
- Status is conveyed with text as well as colour. Controls have accessible
  labels, disabled explanations, and keyboard behaviour appropriate to their
  roles.
- The playlist list remains usable at hundreds or thousands of playlists.
  Initial load uses playlist summaries plus active tracks instead of an N+1
  request per playlist.
- Poll only while it adds information. Socket events carry live changes;
  expensive coverage scans run while processes are active or after a meaningful
  transition, not forever because rows merely remain queued.
- Mobile and narrow layouts may rearrange the two panes, but must preserve the
  same status hierarchy, primary action, and evidence.

## Iteration discipline

Dashboard improvement is an ongoing workstream parallel to the MP3 batch. Each
iteration should:

1. observe the real dashboard and canonical backend/disk/queue state;
2. identify the highest-impact discrepancy from this specification;
3. fix a bounded defect or usability problem without interrupting live queue
   work;
4. add or update regression coverage;
5. exercise the affected workflow in the browser at `127.0.0.1:4200`; and
6. report the user-visible improvement, verification, remaining risk, and the
   complete live batch status.

Screenshots alone are not verification. Meaningful UI work must exercise, as
applicable, saved-library load, Spotify sync/resync, enqueue/download, live
state transitions, failure handling, and local playback.

## Current implementation position — 2026-09-11

Implemented and verified:

- saved-library-first load with background Spotify discovery;
- processing → actionable partial → untouched → finished default ordering;
- new/changed playlist sync with snapshot and truncation safeguards;
- CDP-down saved-library fallback;
- primary whole-library and narrower playlist/selection actions;
- duplicate-enqueue guards and idempotent local-file/URL reuse;
- durable Pending, Waiting, Searching, Downloading, Retry scheduled, Needs
  retry, Missing, and On disk distinctions;
- actual filename/error display and local browser playback;
- in-progress banner and process spinners only for running search/download
  work, not queued or retry-scheduled rows;
- live YouTube pace/window and safety-floor state from GET /api/youtube/pace;
- library-wide totals labelled as playlist occurrences rather than unique
  songs, with the saved count as N/M occurrences on disk;
- the live-queue drawer is named for search and download work, not downloads
  only;
- download-queue drawer is a read-only activity list (no delete/retry/subscribe
  controls on live work);
- Hide finished never conceals playlists with live search, download, queued, or
  retry-scheduled work;
- attention counts and Select incomplete include playlists that are fully saved
  but still have live queue work;
- playlist auto-resync is skipped while library Spotify sync is degraded; the
  explicit Resync button remains;
- page load reuses a recent failed library-sync status instead of immediately
  POSTing another quiet Spotify discovery (until explicit Sync after a 429,
  15 minutes after other quiet failures);
- disabled bulk search/download actions are described by the visible Queue is
  live note;
- File column shows an MP3 name only when the local file exists; copyable and
  pending rows keep that evidence in the status pill;
- in-progress banner counts only running search/download processes;
- Search & download needed is the first, full-width sidebar action; YouTube
  pace stays on one ellipsized line (`1+1 · 8/8 this 10m`); the sidebar
  activity line stays compact (`1 down · 1 search · 1,139 waiting · 10 retry`)
  so it does not wrap; Refresh and Sync sit on the filter search row so Hide
  finished/sort stay on one line;
- disk and attention counts share one compact stats block, live activity and
  YouTube pace share one live block, the Queue is live note sits directly
  under the disabled primary action, and the Spotify 429 saved-library notice
  stays on one ellipsized line so the playlist list keeps most of an ordinary
  desktop viewport;
- currently searching or downloading playlists stay named in the sidebar live
  block even when the list is scrolled to a waiting playlist, and live reorders
  keep a running focused row in view without chasing a waiting focused row
  away from processing work;
- playlist listbox selection follows the checkboxes (not focus); Space toggles
  the focused row, Home/End jump, and the 841 checkboxes stay out of tab order;
- stacked narrow layout gives the playlist list a minimum height instead of a
  36vh sidebar that the chrome could eat;
- coverage rescans after a running search/download finishes, with a 60s
  heartbeat while processes are active, not a 5s full-library poll;
- track-table in-progress highlight is only for running search/download rows
  (not retry-scheduled), and on-disk rows are keyboard-playable;
- in-progress banner rows name the playlist and open it (no extra Spotify
  resync); the live-queue list overlays the track table and closes after a
  playlist is chosen so per-track evidence stays on screen;
- an 8/8 safety-floor window with no running download is labelled downloads
  held, not next window, so waiting work is not mistaken for a stuck process;
- a blocked first play() restores the Play control instead of leaving Pause
  on a paused audio element; the Play/Pause label follows the audio element
  so a paused file never shows Pause;
- opening a playlist scrolls to the running search/download row (or the first
  waiting/pending/retry row) after the table renders, instead of keeping the
  previous playlist's scroll offset; queued playlist pills say Waiting, matching
  the track labels;
- ripping playlist rows use a compact remaining-work line (`1 down · 62 waiting`)
  with the full wording in the title, so the currently processing playlist is
  not clipped; the player label also exposes the full track name on hover;
- the local player bar can be closed, and it hides when the track ends, so a
  paused leftover player does not keep shrinking the track table;
- a running search or download is shown on the track row even when a local
  file already exists, so active work is not hidden behind on disk;
- ripping playlist remaining-work lines include dump tracks not yet in the
  live queue as pending, so `1 search · 22 waiting` is not mistaken for the
  full leftover;
- live track status is scoped to the focused playlist occurrence, so a
  downloading row is not shown as Waiting because another playlist has the
  same song queued;
- playlist rows show confirmed misses: ripping remaining-work lines include
  missing so on-disk + pending + live + missing reconcile to playlist size,
  and a finished playlist with misses uses Finished rather than Done;
- switching playlists drops the previous track list until the new detail
  loads, so live waiting/downloading counts cannot bleed onto the next row;
- playlist remainder lines name idle copyable tracks (already ripped
  elsewhere) instead of counting them as YouTube-needed work;
- Waiting track pills no longer share the live-queue drawer class, so drawer
  chrome does not leak onto per-track Waiting labels;
- the focused playlist row stays in the left navigator when live work
  reorders the list, and a running job on another playlist does not paint
  onto a focused occurrence with no live row;
- the File column shows only the on-disk MP3 name; Play/Pause lives in its
  own column so evidence is not prefixed with Play;
- whole-library and mass-selection download stay disabled until the live
  queue has been fetched, so a reload cannot enqueue a duplicate batch;
- the in-progress banner sits at the top of the main pane, so currently
  running search/download is not buried under the focused playlist's
  tracks;
- live Socket.IO track/playlist updates run inside Angular's zone, so the
  in-progress banner and activity line follow running work without waiting
  for the next HTTP poll;
- in-progress banner rows use the same track labels as the table (Finding
  on YouTube / Downloading N%), Resync names the focused playlist instead
  of every dump as Recents, and retry rows do not fall back to Not found
  on YouTube;
- ripping remainder lines name operational failures as needs retry instead
  of pending, so a focused playlist's leftover matches the track table;
- the sidebar live activity line includes dump leftover pending, so the
  search-queue remainder is not invisible next to socket waiting counts,
  and running playlist names share one row;
- leftover dump tracks on a ripping playlist with live search/download
  work are labelled Waiting, not Pending, matching durably queued search
  jobs that are not yet in the socket live set;
- operational Error rows survive active-queue refresh so needs-retry stays
  visible, and choosing a playlist from the list closes the live-queue
  overlay so per-track evidence is not covered;
- opening a playlist records dump operational failures into the live store
  so needs-retry remains after leaving that row, and a paused leftover
  player is dismissed when switching playlists;
- SQLite Error rows for live playlists are hydrated from the playlist
  track API so needs-retry is visible without opening every dump;
- dump-remembered synthetic Error rows are replaced by hydrated SQLite
  Errors for the same song so needs-retry is not double-counted;
- stalled mostly-done playlists without live jobs hydrate SQLite Errors
  via the playlist track API; remaining needed excludes needs-retry;
- incomplete playlist pills no longer say 0 needed when the leftover is
  only needs-retry or copyable;
- leftover playlists whose dump remainder is already in the live library
  search/download queue show waiting instead of needed, even when those
  jobs are not yet in the socket live set; Download this playlist stays
  hidden for that implied-waiting leftover so it cannot duplicate the
  live queue;
- a focused playlist remainder uses the track table for needs-retry and
  never lets retry + waiting + on-disk exceed the dump size, so stale
  SQLite Error rows for songs already saved cannot inflate the leftover;
- the live-queue toggle names socket-live playlists and implied-waiting
  dump leftovers separately (`69 live · 715 waiting`) so it cannot look
  like only the download-queued playlists are in the library queue;
- a focused ripping action names compact leftover work (`1 search · 845
  waiting · 16/862`) instead of only Searching/Downloading, so dump
  remainder already in the live pipeline is not hidden behind the
  running process;
- playlist listbox options expose name plus remainder, and the row
  checkboxes are aria-hidden so 841 Select controls cannot bury status
  from assistive tech; a screen-reader-only remainder keeps those
  options in the accessibility tree after the checkboxes are hidden;
- sidebar attention says occurrences remaining while a live queue is
  processing, not need action; a focused playlist with only needs-retry
  or copyable leftover uses Retry/Copy instead of Download this playlist;
- in-progress search/download counts are capped to the live YouTube pace,
  so stale Searching rows cannot look like extra running processes;
- a safety-floor cooldown with 0 live yt-dlp slots does not keep leftover
  Searching rows labelled as in-progress processes;
- when GET /api/youtube/pace reports running search/download slots the live
  track store does not yet have, the dashboard refetches /api/track/active
  instead of showing only waiting leftovers;
- playlist stats are memoized per change-detection cycle so the 841-row
  navigator stays usable while live work is applied;
- regression coverage and real-browser exercises for the core workflow.

Highest-priority remaining iterations:

1. Persist sync/resync progress and typed failure kinds across backend restarts.
2. Replace artist/title identity with a durable normalised track key plus
   explicit playlist occurrences.
3. Incrementally maintain filesystem/database coverage indexes instead of
   rescanning the complete library during active refreshes.
4. Establish trusted membership baselines for legacy dumps before accepting an
   initial Spotify snapshot ID.
5. Distinguish intentional Spotify removals from incomplete upstream responses
   without risking local data loss.
6. Continue real-browser usability review, responsive refinement, and removal
   of build-quality warnings after correctness and operator safety.
