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

### 15 September 2026: one activity surface (current contract)

The user's live-resume usability review supersedes older layout notes below.

- One **Current activity** strip, at the top of the main pane, answers what is
  happening now: operation, track, real progress, or the reason work is waiting.
- Include preparation, Spotify metadata, local reuse and duration verification,
  not just yt-dlp. Read actual Bull membership; queued database rows alone are
  not proof of execution. Duplicate playlist occurrences waiting for the same
  track are described as waiting, not additional searches.
- Include HTTP-side playlist preparation before Bull jobs exist. The backend
  reports its actual playlist/track and checked count; losing the browser's
  request does not make that work disappear. Do not change the download folder
  or accept overlapping playlist batches while that preparation is running.
- Queue acknowledgements appear in Current activity, including no-op and local
  reuse outcomes. Queued work is not a completed MP3; local copies are not new
  downloads. A lost/invalid reply means unconfirmed outcome, not failed audio.
  Refresh observed state without automatically repeating the mutation.
- Download submissions carry a saved request identity. A reload or lost HTTP
  reply recovers that exact request's completed counts, not an unrelated latest
  result. A backend restart during preparation reports interruption without
  invented partial counts or replaying work. **Check submission** is read-only.
  Background sync must not erase a recent download acknowledgement or leave
  saved-library loading stuck during recovery.
- Show determinate percentages only after progress is reported. Other active
  operations use an indeterminate bar. Paused, delayed and idle work does not
  animate. A delayed queue gives its next wake-up time; configuration problems
  give an actionable warning instead of promising automatic progress.
- Concurrent Spotify work and user-action errors appear in that same strip.
  Successful resync gets a brief acknowledgement, then moves to recent history.
- **Activity details**, collapsed by default, contains concurrent jobs,
  chronological recent events, queued playlists, technical pace and historical
  CLI benchmarks. Never mistake the historical benchmark for current web speed.
- The sidebar is navigation: saved total, filter/sort, playlist names/owners and
  short N/M saved counts. Detailed counts remain in tooltips and accessibility
  labels. **Sync Spotify library** stays visible with its scope explained:
  update playlists and tracks, not MP3 downloads. Bulk/download-folder tools
  remain under **Library tools**. A focused **Sync this playlist** action is
  distinct; neither sync control starts downloads or changes existing MP3s.
- The focused playlist has one labelled saved-progress bar, actionable buttons,
  and concise track states. Search options/evidence and failure detail expand on
  demand. No disabled button masquerading as status; no bottom queue overlay;
  no repeated pending/waiting/retry counters or stale success banners.
- Keep completion in that saved-progress summary, not extra title badges and
  banners. A local file is saved, not proof of a new download. Distinguish old
  saved-list timestamps from a complete Spotify membership check; missing or
  invalid timestamps must not break the page or imply successful sync.
- Routine work uses green/neutral styling. Yellow/red is for attention, not
  normal processing. Narrow layouts collapse playlist navigation and preserve
  the activity strip and a usable track-table viewport.
- Telemetry is observational. It must not change pace, queue ownership, resume
  work, or count local copies as new downloads. Session totals reset on backend
  restart and are labelled accordingly.

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

**15 September action-model correction:** never infer that unsubmitted tracks
are queued just because other tracks or playlists have work. Legacy New rows
with actual Bull jobs are projected as Waiting from queue membership; parked
journal outcomes remain parked. Status is text, never a disabled fake action.

The interface reports observed state, not optimistic intent:

- A non-empty file under the active download folder proves file presence, not
  that every same-named Spotify recording is satisfied. A known source-duration
  or recording mismatch must not count as complete or copyable for that source.
  Unknown identity evidence is unverified, not a confirmed bad file. Preserve
  legitimate cross-playlist reuse while binding workflow outcomes to the
  particular Spotify source and its playlist occurrences. The sidebar's
  persistent **Download folder** setting overrides the
  `DOWNLOADS_PATH` fallback for both the website and CLI.
- SQLite records durable playlist and track workflow state.
- Redis/BullMQ records runnable, delayed, and active work.
- Spotify snapshot dumps record playlist membership and ordering.
- Conflicts are resolved toward physical truth and the most current actionable
  state; a stale database label must never overrule a real file or active job.
- If a destination becomes occupied during a copy/download, preserve that file
  and use a source-specific versioned destination. Never treat unrelated bytes
  as a successful copy. Completion, playback and filename evidence must follow
  the actual published path. Reusing an independently encoded existing file
  requires still-current source-duration evidence; existence alone is not enough.

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
- An action's enabled state, visible blocked reason and click handler must
  share the same eligibility rule. Never show an enabled control whose handler
  silently ignores it. Finishing preparation re-enables eligible controls
  without a page reload; unrelated queued tracks alone do not block a focused
  playlist's unsubmitted work or explicit retries.
- A playlist's unqueued work keeps its counted **Queue N for search & download**
  action even when other tracks are queued/running. Copy-only work says
  **Add N existing MP3s to this folder** and explains that no download is needed.
- Paused queues have a prominent explanation and an explicit **Resume web
  downloads** control. Its confirmation names the whole-web-queue scope,
  including older batches. Backend resume atomically checks CLI ownership and
  preserves jobs, safety cooldowns and admission history. Enqueue never resumes.
- Hide zero-failure counters and successful-track diagnostics; candidate search
  exhaustion is an expected outcome with **Search again**, not a network error.
- Whole-library and mass-selection actions are disabled while a live queue is
  already present. The explanation must be visible, not implicit.
- An explicit playlist retry is the opt-in route for retrying confirmed misses.
- Waiting, scheduled, or running tracks must not hide explicit retry controls
  for other failed tracks in that playlist. Retain ownership and duplicate-job
  guards; distinguish a paused admission from actually running work.
- Queue pause state comes from Bull, not from stale track statuses or the
  presence of a CLI lease. Show paused/partial pause explicitly. Queue drawer
  counts label their playlist units; waiting is not processing. Never resume
  the whole preserved backlog as an implicit side effect of a playlist retry.
- Destructive actions are never bundled into refresh, sync, download, or
  playback.
- The advanced **Restore tested download limits** control changes concurrency
  and download-start limits only, not search policy or queue state. Require
  both queues paused, active work drained and no conflicting owner/preparation;
  never bypass a recovery cooldown or safety floor. Show already-selected limits
  as text, not a disabled status button. Show the action's progress, rejection
  or acknowledgement in Current activity. A lost reply triggers fresh read-only
  observation, never automatic reapplication; an older status read must not
  overwrite a newly acknowledged change.
- Changing **Download folder** validates an existing absolute directory and
  rescans saved coverage. It changes scanning, playback and future destinations,
  never moves/deletes files or resumes queues, and is blocked while a CLI owns
  acquisition or unpaused/running web work could still use the old destination.
- Result messages distinguish newly queued, already saved, already queued,
  known missing, and failed work instead of calling every no-op a success.

## Local-first Spotify sync

- Page load never waits for Spotify or CDP before showing saved state.
- On load, the dashboard quietly discovers the current Spotify playlist
  library. It imports new playlists and refreshes only playlists whose snapshot
  or membership changed.
- Skip a track-list refresh only when the saved membership is complete and
  its available Spotify snapshot ID still matches. Missing revision evidence
  means unknown, not unchanged; equal counts alone cannot detect replacements
  or reordering. Focused refresh invalidates its old discovery baseline until
  a library check can establish a new one. Verified unchanged metadata files
  remain untouched; owner/name/order changes still persist.
- Selecting a playlist may auto-resync it with a ten-minute debounce. A
  fifteen-minute background cycle discovers the whole library, including newly
  followed playlists, even without a selection. It reuses a recent library
  check, follows existing work and respects quiet-failure backoff. A recent
  focused-playlist refresh is not proof that library discovery is current.
  Known disconnected/connecting/unavailable Chrome never triggers quiet sync
  submissions or permission requests.
- Private playlist discovery uses the persistent bridge at
  `127.0.0.1:17331`, the logged-in main Chrome profile, and a background tab.
  Angular does not call CDP or Spotify directly; the Nest backend invokes the
  TypeScript Spotify session layer, which talks to the Node CDP bridge.
- Track lists come from Spotify APIs, not playlist-page HTML. Declared API
  counts, pagination completion, and snapshot identity determine whether a
  response is safe to persist.
- Discovery collects every library page before creating/updating any playlist.
  Missing paging data, gaps, duplicates, changing totals and malformed rows
  produce an incomplete-library result, never a successful empty library.
  A positively empty library requires an explicit zero total and terminal page.
- Whole playlists absent from a complete library discovery are kept locally,
  along with their files and queued work. Explain this in the focused playlist
  with a neutral **Kept locally** note and the date of that library check.
  Failed/partial discoveries never imply removal. A focused or saved-playlist
  refresh does not establish library presence; only a later complete library
  discovery can replace that observation. Preserve this distinction across
  restarts without rewriting unchanged playlist files or rescanning audio.
- A failed, truncated, rate-limited, or timed-out sync never replaces a known
  good snapshot. Writes are atomic.
- Intentional track removals, including an empty playlist, are accepted only
  after two complete, matching authenticated API reads. Completeness evidence
  binds the playlist ID, total item count, ordered song IDs (including repeats),
  and understood non-music exclusions. Missing metadata, unknown/malformed rows,
  or a changing confirmation preserves the previous membership. Spotify is the
  membership source of truth: a verified removal unlinks that playlist folder's
  copies of the dropped tracks and drops their queued work for this playlist.
  Hardlinks in other playlist folders stay. Remaining tracks, including
  mismatching files for songs still on the list, stay. Incomplete reads never
  delete audio.
- A verified empty Spotify playlist is distinct from a list not yet loaded or
  one containing only podcasts/local-only entries. Missing discovery counts
  mean unknown, not zero. Verified non-music/empty baselines avoid repeated sync.
- If CDP or Spotify is unavailable, the dashboard continues to load, play, and
  process the saved local library and says clearly that live sync is degraded.
- Sync uses the same Current activity strip, not a separate sidebar status
  stack. Connection loss stops the sync animation and says that the server may
  still be working; observe recovery before offering another submission. A
  lost POST response is not proof that a sync failed to start.
- Library, focused-playlist and saved-playlist bulk sync share one durable
  operation with an ID, scope, progress and result. Reloading follows that
  operation; another tab can observe it without starting a second one. A
  previous completed sync is never a receipt for an unconfirmed new request.
  Late observations must not overwrite a newer user action, and closing the
  component must not leave callbacks capable of submitting or polling again.
- Chrome readiness follows current observations: an older health reply must
  not undo a newer acknowledged connection. A stale confirmation cannot request
  another connection once readiness changes. Closing the dashboard disposes
  its response subscriptions without disconnecting the shared bridge or
  cancelling work owned by the server.

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
- Activity text, progress labels and keyboard focus must stay readable against
  the actual activity-panel background, including hover and system dark mode.
  Do not reuse dark-banner colours unchanged on a light activity surface.
- The playlist list remains usable at hundreds or thousands of playlists.
  Initial load uses playlist summaries plus active tracks instead of an N+1
  request per playlist.
- Local audio verification must not hold the entire saved library off screen.
  Show browsable metadata and one Current activity checked/total indicator while
  checking. Unchecked is neither Missing nor a download requirement. Focused
  playlists get priority; their verified tracks can play while other checks run.
  Progress reads follow one scan, stop on completion, and do not launch another
  scan. Observation loss stops the animation without claiming work stopped.
  Folder, membership or backend changes invalidate old scan identities; a fresh
  local read must never repeat a download or connect Chrome. Recheck is explicit
  for failed local verification, and old scan rows cannot overrule a new check.
- Poll only while it adds information. Socket events carry live changes;
  normal observations reuse one maintained coverage index. Local media changes
  recheck affected sources/aliases, including hardlinks; workflow-only changes
  do not probe audio again. Initial loading, explicit recheck, unknown directory
  changes and changed membership/settings may rebuild the complete index.
  Never rebuild it merely because rows remain queued or a timer fires.
  Show targeted work as **Updating saved files** in Current activity. An old
  Completed event cannot override checked file absence or create a Play button.
  If filesystem notifications fail or the watched root is replaced, disclose
  that automatic updates are unavailable and offer **Check saved files again**.
  These observations never sync Spotify, enqueue work or modify MP3s.
- Mobile and narrow layouts may rearrange the two panes, but must preserve the
  same status hierarchy, primary action, and evidence.
- Collapsing playlist navigation must not hide whole-library sync. Opening the
  chooser focuses its filter; Up/Down browse visible results without closing
  it or submitting Spotify work. Enter opens the focused playlist; Escape
  returns to the chooser button. Space selects only a visible playlist for a
  batch. Keep offscreen keyboard results visible within the actual scroll pane.

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

## Historical implementation record — 2026-09-11 onward

The following is historical evidence, not authority to restore old banners,
sidebar status blocks, or queue overlays. The current information architecture
above takes precedence. Earlier implemented and verified behaviour:

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

1. Live-verify the implemented durable sync/resync progress and typed recovery
   across backend restarts and multiple open dashboard tabs.
2. Live-verify the implemented Spotify-source identity and explicit occurrence
   projection across CLI/web reuse, publication races and legacy review ledgers.
3. Browser-verify the implemented incremental filesystem/database coverage,
   file-change notifications, manual fallback and cross-tab updates. Native
   filesystem/socket/HTTP fixture and DOM checks are not real browser acceptance.
4. Establish trusted membership baselines for the real legacy dumps using the
   implemented completeness guard before accepting an initial snapshot ID.
5. Live-verify the new twice-confirmed Spotify removal/empty-playlist handling
   without changing existing MP3s or queued jobs; its regression tests pass but
   successful Spotify/browser integration remains unverified while disconnected.
6. Continue real-browser usability review, responsive refinement, and removal
   of build-quality warnings after correctness and operator safety.
