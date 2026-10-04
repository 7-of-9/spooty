# Spooty website architecture and audit

## Current acceptance audit — 15 September, 18:43 Bangkok

The complete goal is **not achieved**. The current non-browser checks all pass:
429 backend tests/51 suites,212 shared-acquisition tests,270 rendered Angular
component/service tests,87 UX/process/style tests and35 simulated CDP/boundary
tests (1,033 total, zero skips). Both typechecks pass. Logs are
`/tmp/spooty-acceptance-{backend,acquire,dom,ux,cdp,be-typecheck,fe-typecheck}.log`.
The unchanged frontend build from the preceding implementation passed; its
initial976KB warning remains. No actual browser was opened by these checks.

| Current requirement group | Authoritative evidence inspected | Still required for acceptance |
| --- | --- | --- |
| Saved-library-first load, navigation and visible sync actions | Actual4200 library/detail HTTP reads; app-root and library-panel DOM tests exercise the real templates, controls, focus and filtering | Desktop/narrow-screen layout and real keyboard interaction |
| One activity surface, real progress, safe queue/resume/no-op behavior | Operator/component tests plus real isolated Nest/Redis lifecycle tests, including partial HTTP/proxy traffic and unfinished work | Exercise the displayed transitions and actions in Chrome |
| Library versus focused sync; durable scope, receipts and recovery | Component/runtime tests and library-sync-state/service tests cover single-operation ownership, lost replies, reload and interruption | Real authenticated sync, another open dashboard tab and recovery |
| Complete discovery, same-count edits, trusted baselines, removals and retained playlists | Library service tests use real collectors/writers with substituted Spotify transport; ordered/repeated IDs, failed second pages, double-confirmed removals and empty/retained states are asserted | Complete Spotify library sync; real same-count edit/removal/empty-list checks without MP3 deletion |
| Source-aware reuse, duration checks, destination and filename truth | Shared acquisition fixtures and backend source/media tests; actual saved-track HTTP range returned206/audio-mpeg/1024bytes with filename evidence | Real Play/Pause/seek and audible playback; browser recording-version presentation |
| Incremental file coverage and cross-tab updates | Native scratch-filesystem changes travel through a real Nest gateway/HTTP view; actual library reads retain the same completed scan | Browser observation of changes, root fallback and multiple tabs |
| Responsive/accessibility/style/performance clarity | DOM focus/navigation regressions, compiled cascade/contrast checks and production bundle composition | Real layout, system themes, focus visibility and first-paint usability |
| Singleton-only Chrome work and explicit connection consent |35 socket/source regressions; current API reports disconnected; connection-control races have red-before-fix tests | Resolve the old Codex session bypass and explicitly authorize one singleton connection; no fallback browser |

Actual18:42 live observations:841 playlists,23,289 checked occurrences, zero
file-check errors, matching focused detail, stable scan across reads and working
HTTP media ranges. **Zero** playlists have verified Spotify membership baselines
or dated library-presence observations. Sync is idle with one prior error; this
is not successful live synchronization. A range response is not audible playback.

No additional evidenced implementation defect was found in this audit. The
remaining numbered backlog below is now live acceptance/measurement, not license
to manufacture fixtures as substitutes, broaden the task or repeat cosmetic edits.
Downloads remain19,056/19,729 saved,172.274658487GB; queues empty/unpaused, no
active owner/preparation.19 actionable sources are unqueued; no current ETA.

## 15 September — keep Chrome readiness current during Spotify recovery

A delayed health response could overwrite a newer successful explicit Chrome
connection, restoring an incorrect unavailable/disconnected state and offering
reconnection. A lost connection reply could also reuse an older health read
instead of observing the outcome freshly. Connection subscriptions survived
component teardown and could issue further status reads or update old receipts.

The component now disposes superseded HTTP observations when an explicit
connection starts or returns, and obtains a fresh read after a lost reply.
Teardown disposes both status and connection-response subscriptions; destroyed
handlers do nothing. A confirmation is retired if Chrome becomes connected or
another connection is pending. Fresh later health checks can still report a
real disconnection. This never closes the singleton connection, automatically
connects, submits Spotify sync, or changes download state.

All six new rendered regressions failed before implementation.270 DOM/service
tests,32 sync-flow tests, frontend spec typecheck and production build pass.
Localhost4200 serves the new cleanup and both sync entry points. These are
controlled-service/HTTP checks, not live Chrome acceptance or a fix for the
separate stale Codex parent that keeps launching direct browser tools.
Logs /tmp/spooty-chrome-state-{red,dom,sync,typecheck,build}.log.

Acceptance recheck: the actual library has841 playlists/23,289 checked track
occurrences, zero file-check errors, but zero verified Spotify membership
baselines and zero dated library-presence observations. Chrome is disconnected;
the last sync is not running and reports an error. The still-required gates are
real authenticated library discovery/edits/removals, cross-tab recovery,
responsive/theme/keyboard layout and audible playback. Neither fixtures nor a
passing build closes these gates. No new Chrome or Spotify request was made.

## 15 September — immediate dashboard bootstrap without unused routing

Bundle inspection found64KB of Angular router implementation in a single-screen
application with no routes, RouterOutlet, router links or navigation calls.
Removed the unused provideRouter registration, keeping immediate library
bootstrap. No lazy-loading shell or new navigation delay was added.

The DOM runner previously omitted app-root tests and supported only plural
styleUrls. It now compiles singular styleUrl too and runs the actual appConfig
providers with controlled services. Root coverage verifies that the library,
Sync Spotify library and Current activity appear immediately without routing.
The unnecessary provider regression failed before removal;264 DOM tests passed
at that checkpoint. Logs /tmp/spooty-bootstrap-{provider-red,dom,build,typecheck}.log.

Production main JavaScript fell537,024→461,765bytes at the bootstrap checkpoint
(14%). After the connection-state fix above it is462,409bytes; total initial
payload is975,627bytes. No router contribution or lazy JavaScript chunks remain.
The500KB initial-budget warning remains unchanged. Further splitting needs real
browser first-paint measurements and must not delay saved-library usability.

## 15 September — lighter global styles and readable activity details

The full Bulma import shipped unused layout, form and component modules.
Supported Sass entry points now retain utilities/themes/base, tags/panels and
the colour/flex/typography/visibility/clickable helpers used by the current and
legacy templates. Icons, reset rules and global application overrides are kept.
A compiled cascade comparison caught the initially omitted is-flex helper; the
visibility module restores it. Relevant rule order/declarations across media
and theme contexts now match the full-framework baseline. No new unresolved
CSS-variable references are introduced.

Production global CSS fell759.92→478.64KB (37% raw reduction; estimated transfer
53.74→33.01KB). Removed styles for retired sidebar counters/banners and bottom
queue overlays; still-used queue/activity detail controls now live in the
activity stylesheet. This clears the Sass-deprecation and component-style
budget warnings without changing budgets. The1.05MB total initial bundle still
exceeds500KB; do not describe the entire build-quality backlog as complete.

Fallback activity rows had dark-banner hover backgrounds with dark text, and
pale-green progress on the white panel. They now use a light hover background,
readable progress colour and visible keyboard outline. Activity strong text
inherits the panel colour instead of the system dark-theme global strong colour.
Declared normal/hover/focus text contrast passes4.5:1 checks. Visual, layout and
real browser/theme acceptance remain pending; this is not a compliance audit.

Verified259 rendered DOM/service tests,87 UX/process/style tests, frontend
typecheck and production build. New regression tests failed before the fixes.
The added CSS-parser test dependencies are explicitly declared at the already
installed/locked versions. Logs /tmp/spooty-styles-{red,contrast-red,verified,
ux,dom-final,typecheck,build-verified}.log; baseline build is
/tmp/spooty-navigation-build-final.log. Localhost4200 serves the trimmed CSS,
retained helpers and new activity colours, and841 playlists/23,289 checked
occurrences. No browser, Spotify, media or queue mutation was performed.
Both queues are empty/unpaused, no owner/preparation;19,056/19,729 source tracks
saved,172.274658487GB, no active output rate or ETA. Full UX goal remains active.

## 15 September — library sync visibility and predictable playlist navigation

Six rendered regressions reproduced hidden narrow-screen sync, arrow navigation
closing the chooser, skipping the first filtered result, Space selecting a
hidden playlist, and missing opening/Enter/Escape focus transitions. The single
whole-library sync entry now sits outside the collapsible navigation wrapper;
tools, filters, results and empty-result text collapse together. The expanded
chooser scrolls as one bounded pane, leaving space for Current activity.

Opening focuses the filter after Angular renders. Filter Up/Down enters the
first/last matching result; list arrows/Home/End preview saved details without
closing the chooser or syncing Spotify. Enter/pointer selection opens the
playlist and focuses its heading; Escape returns to the chooser button. Space
cannot select a filtered-out row. Modified shortcuts and input-method
composition are preserved. Focus requests cannot survive component teardown;
scroll visibility uses the chooser's clipped bounds, not an unbounded list.

259 rendered DOM/service tests,81 UX/process tests, frontend typecheck and
production build pass. Thirteen new navigation regressions include empty
filters, pointer/keyboard parity, rapid reopen, teardown and the still-singular
library-sync action. These are DOM/fixture tests, not browser layout acceptance.
The actual4200 main bundle serves the new handlers/wrapper; HTTP returns841
playlists and a complete23,289-occurrence scan with zero errors. Existing Sass,
bundle and component-style budget warnings remain. Logs:
/tmp/spooty-navigation-{red,dom-verified,typecheck-final,ux,build-final}.log.

No Chrome connection, other-agent restart, real Spotify submission or media
mutation was used. Both queues are empty/unpaused with no owner/preparation;
19,056/19,729 sources saved,172.274658487GB, no current throughput or ETA.
The full goal remains active: real responsive/keyboard review, live Spotify
sync/membership, multiple tabs and audible playback are still unverified.

## 15 September — legacy review evidence no longer disappears after source-key migration

The review-key backlog audit found four direct-key readers incompatible with
new Spotify source identities. Source inspection, historical-duration snapshots,
independent benchmark review reporting and replacement bookkeeping now share
SourceReviewIndex. Explicit catalog IDs, Spotify references and per-file audit
IDs bind older records; names alone do not identify a new source. Historical
keys/latest same-key records stay intact, and independent unresolved evidence
is not hidden by a separate resolved record. Conflicting source IDs fail closed.

Replacement bookkeeping verifies the source-duration guard and keeps evidence
per source. One version cannot resolve a multi-source review; duration agreement
never resolves manual performer/recording identity review. Explicit inspection
reports unbound/unavailable work instead of silently selecting zero. This does
not change normal download admission or add alarming historical flags to the UI.

The real ledger has2,347 historical records,328 unresolved. Old source-key lookup
matched0; the shared lookup maps321 to explicit current sources, leaving7
unbound. These are historical records, not newly failed local MP3s. Live ledger,
media and queues were left unchanged. Two new replacement tests failed first;
212 acquisition,429 backend and246 rendered DOM tests plus backend typecheck
now pass. Logs /tmp/spooty-review-identity-{acquire-final,backend,dom,typecheck}.log.
The real site still serves841 playlists/23,289 checked occurrences. Physical
plan19,056/19,729 saved,172.274658487GB; queues empty and no current ETA.
Browser/Spotify/multi-tab/layout/audio acceptance remains pending; goal active.

## 15 September — explain whole playlists kept after a Spotify library check

A complete Spotify discovery now records its checked date and playlist IDs in
the private durable sync state. Read-time playlist projections distinguish
present from not-returned; legacy data stays unknown. The focused header shows
a neutral Kept locally explanation only for a valid dated not-returned state.
An empty library receipt explicitly says saved playlists and MP3s were kept.
No new global alert, disabled status button, deletion or download is introduced.

Failed pagination/429/connection checks do not replace the prior observation.
Neither focused nor saved-playlist bulk sync proves library presence. Complete
discovery remains valid if subsequent track refreshes fail. Restart preserves it;
invalid IDs/dates/duplicates or a failed durable write cannot publish absence.
API responses decorate the maintained scan without rewriting unchanged dumps,
reprobing media or exposing the entire ID set in every sync-status response.
Existing Socket.IO coverage notifications update the UI without another sync.

Verification:429 backend tests/51 suites,246 DOM/service tests,81 UX/process
tests, both typechecks and production build pass. An isolated real Nest HTTP/
socket test runs the real discovery collector against a positive empty fixture,
observes the notification and confirms the same scan ID, retained playlist
bytes/MP3 inode and no download/Chrome action. Rendered tests exercise the
explanation, later removal of the note and still-usable focused sync. Logs:
/tmp/spooty-library-presence-{backend-final,dom,ux,http,sync,build}.log.

The actual4200 bundle serves the new copy. The live saved library has841 lists
and23,289 checked occurrences, but no complete presence observation yet. No live
Spotify/Chrome request was made or evidence fabricated. Browser layout, live
Spotify edits/library changes, multi-tab and audible playback remain pending;
the full UX goal is not complete. Existing build warnings remain. Queues are
empty; offline plan19,056/19,729 saved,172.274658487GB, no current download ETA.

## 15 September — playlist header clarity and reliable freshness rendering

The focused title is now just the playlist name; saved completion and remaining
work use the single progress summary. Duplicate title badges and obsolete hidden
completion banners/styles were removed. The page no longer describes pre-existing
files or local copies as All tracks downloaded. Sidebar navigation still shows
its concise Done/Finished states and does not lose confirmed-miss distinctions.

Freshness separates Saved locally (legacy list) from Checked with Spotify
(complete membership evidence), with a semantic time element and explanatory
tooltip. Invalid/missing dates show date unavailable instead of throwing in
Angular's date renderer. Current real data has841 legacy/unverified lists and
zero malformed dates; these labels do not describe MP3 duration verification.
The owner tooltip is explicit about saved attribution, Open in Spotify names its
action, selected-download counts name playlist units, and Chrome approval help
does not misreport an active sync. The link/freshness row can wrap.

Six new rendered regressions failed before the changes.241 DOM/service and30
sync-flow tests now pass; frontend typecheck/build pass with existing Sass and
bundle/style-budget warnings. The actual localhost4200 main.js serves the new
labels, and saved-library HTTP returns841 playlists/23,289 checked occurrences.
No Chrome, Spotify sync, YouTube work or user-media change was used in validation.
Real responsive layout and browser interaction/audible playback remain pending.
Logs `/tmp/spooty-header-{red,dom-final,sync-final,typecheck-final,build-final}.log`.

## 15 September — graceful reload after Redis recovery

A repeated isolated test reproduced a backend shutdown hang that can leave the
website offline during watch reload. Bull's normal client was ready but its
blocking marker client had disconnected again after recovery. Ioredis could
cancel reconnection without settling the old blocking wait; Bull's close waited
for that promise. The new state-only trace distinguishes idle handler, worker
loop, connection state and command counts without logging job or session data.
It also writes bounded owner-local shutdown traces beside the SQLite database.

The fix uses ioredis's built-in blocking-command timeout, already available in
the locked5.9.2 dependency: finite waits retain the requested time plus500ms;
offline/indefinite waits get a10s fallback. This does not set a timeout for normal
commands or active acquisition and does not alter queue pause/ownership/pace.
No patch to node_modules, per-job cancellation or forced-active shutdown is used.

The formerly failing empty-recovered-Redis test passes. Real isolated lifecycle
coverage also preserves paused/delayed jobs and holds an in-flight handler for
eleven seconds after close starts, verifies it remains active, then releases it
and verifies Redis completion. Full verification:418 backend tests/51 suites,
201 acquisition,235 rendered DOM/service,77 UX/process; backend typecheck passes.
Logs `/tmp/spooty-shutdown-{backend-full,acquire,dom,ux-full,typecheck}.log`.

Live backend watch reloaded normally to55072, the4200 library view returns200,
and a real saved MP3 range returns206/1024bytes/audio/mpeg. No actual Chrome,
Spotify or YouTube operation was performed. These checks do not replace live
browser and audible playback acceptance. Media remains172.274658487GB across
18,537 unique inodes; both web queues empty/unpaused and no current download ETA.
The full UX goal remains open; a different shutdown failure must be diagnosed
from new evidence rather than assumed solved by this particular regression fix.

## 15 September — live saved-file updates and authoritative Play state

Completed the incremental-coverage implementation interrupted by the Chrome
prompt investigation. The backend maintains the shared `LocalMediaIndex` and
watches media, source-duration metadata, playlist/settings files and SQLite
workflow changes. Notifications are coalesced; media changes recheck only
affected source IDs/aliases, including hardlink aliases. Unchanged playlist
counts remain available. Workflow-only changes update labels without audio
probes. Ordinary view reads and reconnects observe the maintained scan;
`?refresh=1` is the explicit complete recheck.

`libraryCoverageChanged` travels through the existing application Socket.IO
server. Current activity uses **Updating saved files** for targeted checks,
without a duplicate progress line. A late Completed database/socket row cannot
make a checked-absent file saved or playable. Watch failure or a moved/replaced
watched root reports **Automatic file updates unavailable** and offers a manual
recheck. The watch is passive: no queue, media, Chrome or Spotify mutation.
Private staging directories and symlink directories are not indexed as saved
audio. Replaced scans reject late results; disposal cancels watchers and prevents
pending preparation from returning a new usable scan.

Verification:414 backend tests/50 suites,201 acquisition tests,235 Angular DOM
and service tests,73 UX/process tests and35 simulated CDP/source-boundary tests
pass. Backend/frontend typechecks and the frontend production build pass. The
DOM runner now exercises real TrackService socket handlers and LibraryService
HTTP request semantics as well as the component. Existing Sass/bundle warnings
remain. Native temporary-filesystem changes were exercised through a real Nest
gateway, Socket.IO client and HTTP view: both file addition and removal update
coverage and filename evidence without remote calls or download submissions.

Live application observation: four complete-library reads took9–13ms each,
reused the same23,289-track scan and produced zero idle change events over15s.
The frontend proxy on4200 returns200 for settings, coverage and pace.841
playlists show20,231 local occurrences and22,514 locally available occurrences;
the separate source-aware plan reports19,056/19,729 sources saved,18,760
duration-matched and296 unverified. MP3 storage is172.274658487GB/18,537 unique
inodes. Both queues are empty/unpaused; no CLI owner, active rate or completion
ETA. The19 actionable source tracks are not queued; parked outcomes stay parked.

Live reload hit the previously known healthy-Redis shutdown hang. Exact backend
PID50253 had stopped serving3000 and both queues had zero active/waiting/paused/
delayed jobs. Only that stalled child was stopped after identity and queue
rechecks; its existing Nest watcher restored service. A subsequent normal reload
completed without intervention; backend86423 was verified serving. This is
recovery, not a root-cause fix for the intermittent shutdown hang.

Logs: `/tmp/spooty-incremental-{backend-final,acquire,dom,ux,cdp,fe-build,plan}.log`.
The full UX goal is not complete. Real-browser layout, Spotify sync, multi-tab
interaction and audible playback remain unverified while Chrome access is
unavailable. Legacy review-ledger key compatibility, trusted real membership
baselines, the shutdown hang and existing build warnings remain follow-ups.

## 15 September, 16:57 Bangkok — truthful completion during filename races

Three new tests first demonstrated silent false success: both shared publication
functions accepted unrelated occupied files, including one arriving during tag
writing. Shared publication now rejects that in its strict compatibility API;
source-aware CLI/web entry points preserve the occupant and finish at another
versioned filename. The worker stores the actual path, reports reuse vs a new
publication accurately, and does not rewrite cover art on reused files.

Library preparation also updates previously Completed rows with the actual
filename and clears stale workflow flags. Existing separately encoded audio
is reused only with unchanged verified evidence; source replacement after
verification is rejected. A late file in the download adapter gets a duration
check before any fast-skip. Empty files, directories and symlinks remain occupied,
not overwrite candidates. Cross-device copies are privately staged; temporary
cleanup removes only files this operation successfully allocated.

Verification:399 backend tests/49 suites,199 acquisition tests,222 Angular DOM
tests and73 UX/process tests pass; backend/frontend typechecks pass. The new cases
exercise link-time and tag-time races, independent encodings, real MP3 catalog
reopening, library filename/audio resolution, persisted worker completion,
per-occurrence download results, source changes, long names and temp collisions.
The three pre-fix regressions failed against the prior implementation. No real
YouTube, Spotify, Chrome or user-media mutation was used to test these cases.

Live localhost:841 playlists returned in1.003s; all23,289 file checks completed
in6.241s with zero errors. Backend90645 is serving; queues are idle/unpaused,
no preparation or CLI owner, limits4/1/240 unchanged. Media inventory remains
19,056/19,729 Spotify source keys saved (296 duration-unverified),172.274658487GB.
No current download rate or completion ETA exists while idle.

Full UX remains open. Browser/Spotify/audible playback acceptance is unavailable
without an authorized singleton connection. Event-driven coverage invalidation,
legacy explicit-review key compatibility, healthy-Redis shutdown and real
membership baselines remain. Atomic publication on filesystems without hardlink
support fails closed; no such filesystem was live-tested in this pass.

## 15 September, 16:41 Bangkok — non-blocking saved-file verification

Implemented a bounded, source-aware background scan and incremental HTTP view.
Metadata is browsable before ffprobe completes; Current activity shows checked/
total, and focused playlists are prioritized. Unchecked media is neither Missing
nor an actionable new download. Partial counts are labelled confirmed; stale
Completed rows cannot restore playback or saved counts. Progress observation
never starts another scan, and stops at completion. Failed/lost observations,
backend/folder/membership changes, malformed receipts and disposal are covered.

Real library:841 playlists in987ms,78 focused LTJ rows in123ms,23,289 warm-cache
checks complete in5.307s; progress responses7–139ms. A real Nest HTTP fixture
with a deliberately held cold probe returns metadata and focused rows before
verification completes. All23 known wrong-length coverage entries remain rejected
through the new view.382 backend/222 DOM/73 UX/197 acquisition/30 CDP tests pass;
both typechecks/frontend build pass with existing warnings. No browser connection,
Spotify call, media mutation or queue admission. Real-browser QA remains open.

This is incremental progress delivery, not a complete event-driven filesystem/
database index. Explicit/meaningful refresh still creates a new scan; completed
snapshots are not continuous filesystem watches. Publication races, review-key
compatibility, shutdown root cause and live browser acceptance remain next work.

## 15 September, 16:24 Bangkok — source-aware media coverage repair

Shared CLI/web resolver implemented: work is keyed by Spotify source ID, files
are aliases, all local candidates are considered, and known duration mismatches
cannot count as saved/copyable or be served as that source's audio. New version
destinations preserve existing files. Fingerprinted local ffprobe cache is private
and derived; unknown historical source metadata remains explicitly unverified.
Legacy terminal outcomes remain parked. See HANDOVER and scripts/acquire/README.md.

Real HTTP recheck:23/23 previously false coverage rows across18 playlists now
reject the incompatible media.213 Angular DOM,73 UX,371 backend,197 acquisition,
30 CDP and6 local Codex checks pass. Frontend source IDs scope live state and search
evidence; a known mismatch blocks stale Completed state from restoring Play/saved.
Wrong local audio returns404; matching audio returns206 with a correct32-byte
range. Warm full library API returns200/841 playlists in2.2 seconds.
Browser/layout/audible-playback/Spotify approval QA remains unverified: the CDP
singleton is disconnected and no new connection has been requested.

Open: incremental cold-cache coverage (raw warmup120 seconds), publication races,
legacy explicit-review key compatibility, healthy-Redis worker shutdown hang and
real browser acceptance. Backend recovered from the idle shutdown hang after
exact process and empty-queue checks; this is not a shutdown root-cause fix.

## Earlier 15 September — real-catalog recording-identity defect confirmed

Read-only audit of841 playlists/23,289 occurrences found18,977 legacy filename
keys but19,729 Spotify track IDs. Distinct IDs do not automatically mean distinct
recordings.637 filename groups have multiple IDs;378 have at least two local
exact-ID/name/artist-validated source durations.16 groups have disjoint allowed
duration windows under the unchanged shared5%/5–20second guard. These16 groups
cover56 occurrences; only these high-confidence conflicts were file-probed.

19 unique MP3 inodes were read with ffprobe. Results by playlist occurrence:
16 correct-length local files,7 wrong-length local files,13 compatible files
elsewhere,16 with only incompatible same-name files elsewhere,4 with no file.
The7 local mismatches are7 paths; this is not authority to delete those audio
recordings, which may be valid for another Spotify source. Unknown/unprobed
identity cases are not claimed correct. This is NOT a new full-library duration
pass and must not be presented as a total bad-file count for the library.

Live read-only GET detail checks for23 affected entries across18 playlists
confirmed the product bug: all7 local mismatches report onDisk=true and all16
incompatible alternatives report available=true. Every requested row matched.
The16 alternatives all report onDisk=false (no alternate local-format case).
The web's optional sibling2024 scan directory is absent; there are no relevant
MP3 symlinks omitted by the audit. Those exclusions do not explain these23
results. These are point-in-time filesystem/API observations, not browser QA.
Examples: Robert Miles / Children is4:03 locally but6:19 in My Shazam Tracks;
Faithless / God Is a DJ in Insomnia expects8:01 but its file is3:28;
LTJ Bukem / Unconditional Love in Presents Earth1–7 expects4:05 but has4:56.

Root causes remain live: LibraryService.indexAudioFiles keeps only one path per
lowercased basename; jobByKey merges all source IDs by artist/title and prefers
Completed. list/detail equate name-key presence with success. Acquisition's
existing-in-folder branch skips duration validation. CLI catalog also groups
source IDs/destinations by that filename key, while createDurationResolver can
select the first cached ID's duration. This cannot represent different edits
with the same artist/title in one playlist. Do not fix it by deleting files,
renaming the entire legacy library, replaying parked outcomes, or merely
changing a label while keeping incorrect success/copy semantics.

Reproducible read-only diagnostic: scripts/ux/track-identity-audit.mjs
(`--help`). JSON report: data/acquire/track-identity-audit-20260915.json, owner-only
and Git-ignored. It reuses shared filename normalization, source-cache validation
and duration policy; makes no Spotify/Chrome/queue calls; preserves multiple
same-name physical candidates; skips staging; probes each inode once; retains
unknown evidence as unknown.6 new diagnostic regressions pass; test:ux is now
73/73, rerun after final audit changes. One premature report read failed before any API call;
the completed report was then read and all23 live comparisons succeeded.

Next implementation is the shared identity/coverage repair, not more status
wording: stable source keys separate from legacy filename aliases; explicit
playlist-occurrence projection; source-specific job/outcome lookup; multiple
media candidates with cached fingerprinted duration evidence; no manual audit
dependency on the download happy path. Preserve default fast-skips/accepted
parked outcomes through an explicit compatibility policy. Apply the same core
to CLI and web and test two same-named different-duration tracks in one playlist,
cross-playlist reuse, old files/journals, backend restart and moved download root.
The normative file-presence wording above now acknowledges this proved gap.

## 15 September — truthful advanced download-limits action

Renamed the retained-profile control to **Restore tested download limits**:
the backend changes concurrency/admission limits, not the entire ingest
pipeline. The control now mirrors paused/drained queue, owner, preparation,
cooldown and safety-floor requirements. Paused backlogs remain eligible;
already-selected limits are text, never a disabled status button. Explanation,
enabled state and handler agree; changing pause/ownership state updates without
reload. No settings were applied to production.

Current activity shows the explicit operation, server rejection or actual
acknowledgement. A20-second deadline, empty/malformed-reply checks and disposal
cancellation prevent permanent spinners. A lost reply triggers fresh read-only
observation, never another settings POST. Observed matching limits are not
claimed as proof of which caller applied them. Responses from older status
reads cannot overwrite acknowledged limits, and late receipts preserve newer
user-action acknowledgements and unrelated errors. A pace-only POST response
cannot erase the full queue/owner snapshot. Concurrent local folder/download/
resume actions wait while this settings change is being checked.

29 additional rendered Angular DOM cases cover16 blocked conditions, actual
button clicks/re-enabling, preserved paused backlog, already-selected text,
progress/receipt, server race rejection, lost/empty/malformed/hung replies,
fresh-vs-old read races, independent acknowledgements and disposal.210 DOM
cases,67 UX/real-process cases and12 relevant backend ownership/preset cases
pass. Frontend build/typecheck pass with the existing build warnings. No backend
acquisition code changed. The prior CDP remediation remains intact:6 live/config
checks pass and the singleton is still disconnected with no new Chrome request.

This closes the advanced-profile item below, not the full UX objective.
Real-browser layout/playback/Spotify acceptance, stable track identity,
incremental coverage and real legacy membership baselines remain open. Existing
isolated tests are not evidence of a successful live Spotify sync.

## 15 September — focused actions no longer look enabled but do nothing

Found a mismatch between the three focused acquisition buttons and their click
handlers. The handlers blocked server-side or restored submission preparation,
but the templates only tested the original local enqueue flag. They could
therefore look clickable and silently do nothing. Primary download, operational
retry and candidate-search actions now share `playlistActionBlockedReason`
with `downloadUris`, their title and accessible/visible explanation. Folder
guidance also recognises restored preparation. Existing queued tracks alone
still do not disable a focused action. No new status panel or banner.

Eight rendered DOM cases exercise all three buttons under server preparation,
restored preparation, local submission, folder save, unknown owner, unknown
queue and invalid options; they also prove automatic re-enabling and a real
button click after preparation finishes. Existing paused-queue/retry tests
continue to prove that those cases stay actionable.

The healthy-Redis shutdown investigation did not reproduce the observed hang.
Three new isolated real-Nest cases cover HTTP dev-proxy polling/upgrades with
overlapping/cancelled status reads and an unfinished HTTP body. All exit
cleanly. They are retained as evidence, not presented as a fix. New read-only
shutdown diagnostics observe worker/producer closing promises, handler activity
and worker-loop state. After5seconds a notice names the wait; subsequent notices
are rate-limited. The unreferenced timer cannot keep the process alive, change
queue state or force-close work. Rejection messages/arguments/track data are
not logged. Three unit cases cover bounded notices, privacy and cleanup. The
real in-flight test verifies that tracing remains live while Bull drains.

Verification:366 backend/47 suites,181 Angular DOM,67 UX/real-process tests,
25 CDP guards and5 local CDP config/runtime checks pass, as do both typechecks
and frontend build (existing warnings). Acquisition code is unchanged; its
186-test suite passed in the preceding receipt iteration. Logs include
`/tmp/spooty-action-guards-{dom,ux,cdp,cdp-config}.log`,
`/tmp/spooty-action-guards-fe-build.log`, `/tmp/spooty-shutdown-trace-backend.log`.
The production source watch reloaded normally to15237; no manual process signal,
Chrome request, queue mutation or MP3 action was made. Live library/pace remain
HTTP200,841 playlists, idle/unpaused queues. Full browser/Spotify/audio acceptance
remains unavailable while the approved singleton is disconnected.

Next concrete action-review item: the advanced retained-profile button does
not yet mirror the backend's paused/drained-queue gate and its result only goes
to the old message field. Align eligibility/visible feedback and lost-response
handling without changing pace, resuming queues or weakening the safety floor.
The unexplained shutdown still needs actual phase evidence, not guessed force
timeouts. The broader identity/coverage/live-verification backlog remains open.

## 15 September — durable download receipts and reload recovery

Download submissions now have a request ID recorded before preparation and an
atomic completed receipt before the HTTP reply. The optional HTTP header is
separate from candidate/network policy; legacy callers and the CLI stay on
their existing contract. Receipts live beside the durable DB, outside dist,
and are Git-ignored/private. The shared preparation/acquisition stack still
owns all work; this is not a second scheduler.

The dashboard remembers its pending ID in tab session storage and reads its
exact result after a lost reply or reload. Same-ID completed submissions return
their original counts without adding work again. Reusing an ID for different
options is rejected. Failed/interrupted preparation keeps already admitted
work, reports uncertainty without guessed counts, and is never automatically
replayed. Check submission is read-only; observation is bounded, backs off,
does not overlap, cancels on disposal, and rejects stale/different-ID replies.
Changing the download folder does not change the destination in an old receipt.

Recovered receipts exposed two actual UI races: a nested coverage refresh could
leave the first refresh's Loading state stuck, and quiet Spotify work could
erase the download acknowledgement. Generation checks now stop the superseded
read before it can restore loading state; quiet sync preserves recent receipts.
Download-specific warnings stay in Current activity, not new banners/panels.

Four real HTTP/SQLite/Redis integration tests stop and relaunch an isolated
backend against the same scratch state. They cover selected/whole-library
completed receipts, duplicate IDs, changed payload rejection, interrupted and
failed preparation with two real paused queue jobs already admitted, and an
expanded library that only a new request ID may acquire. Queues stay paused,
metadata is not changed by acquisition, and no MP3 or upstream request occurs.
App fixture network/subprocess guards remain in place. Sixteen added Angular
DOM cases cover reload, lost replies, hung POSTs, independent errors, old-folder
receipts, blocked storage, cancellation/backoff, and actual Check submission.

Verification:363 backend tests/46 suites,173 rendered Angular DOM cases,64
UX/real-process cases,186 acquisition tests,25 CDP regressions and5 local
CDP configuration/runtime checks pass. Both TypeScript checks and frontend
production build pass, with existing Sass/bundle/style-budget warnings.
Logs: `/tmp/spooty-receipts-{backend,dom,ux,acquire,cdp,cdp-config}-tests.log`
and `/tmp/spooty-receipts-fe-build.log`.

Read-only live4200 checks:841-playlist library200,78-track detail200,
audio range206/1024bytes, unknown receipt404, idle/unpaused queues and no
admission/CLI owner. Source watch reloaded to backend93795 without manual
signals this iteration. Chrome singleton14004 remains disconnected; no
browser request or new passive watcher was started.18,333/18,977 songs saved,
172.274658487GB unique-inode MP3s;644 parked, no actionable completion ETA.

Limits: browser markers use session storage, not guaranteed recovery after
closing a tab. Receipt persistence assumes one backend per DB and does not
claim power-loss durability. JSDOM/HTTP tests do not prove real browser layout,
playback or live Spotify sync. The separately observed healthy-Redis watch
shutdown hang and broader contract/backlog remain outstanding. Goal stays active.

## 15 September — idle queue shutdown no longer waits for Redis recovery

An isolated real-Nest lifecycle test reproduced a specific restart failure:
with Redis unavailable, the HTTP listener closed and `BullExplorer` shutdown
waited indefinitely for worker closure. Its producer clients could also wait
indefinitely for a disconnect/end event. This is evidence for an idle Redis-
outage failure, not attribution of every previously observed watch hang.

`WorkerShutdownService` runs before Nest disposes the application. It observes
local processor execution, not stale DB/queue labels. Healthy Redis and active
handlers retain normal graceful shutdown. When Redis is unavailable and both
processors are idle, it pauses only local consumers, rechecks for a just-started
handler, closes idle workers without waiting for unavailable Redis, and locally
disconnects producer clients. It never pauses/resumes/deletes durable queue
state, kills media processes, touches the CLI lease, or changes saved files.
Non-sensitive shutdown logs record local activity and which path was selected.

Ten real process/socket integration cases now pass: explicit close/SIGTERM with
HTTP, Socket.IO polling and WebSocket clients; retained paused/waiting/delayed
jobs; idle Redis loss; Redis recovery with preserved jobs; and a real Bull job
whose controlled handler must finish and be recorded completed before exit.
The fixture uses scratch paths, a separate Redis, allowlisted environment and
network/process guards. No Chrome or upstream service is contacted. Six unit
cases cover active-handler/race guards, unavailable readiness and accounting.

351 backend tests/45 suites,60 UX/lifecycle cases,157 Angular DOM cases,186
acquisition cases,21 CDP regressions and5 local CDP config/runtime checks pass.
Backend typecheck passes. Logs: `/tmp/spooty-lifecycle-{backend,ux,dom,acquire}-tests.log`.
Source watch reloaded normally without manual signals; backend49565 serves
library/detail and range audio through4200 (200/200/206,1024audio bytes).
Queues remain idle/unpaused; singleton14004 remains disconnected/not connecting.

Limits: this does not force-close an in-flight operation if Redis fails, and
does not claim to eliminate all historical shutdown paths. Other hang causes
need fresh phase evidence. Full real-browser/Spotify/playback acceptance,
durable request-correlated download receipts and the broader backlog remain.
Downloads remain18,333/18,977 catalog songs,172.274658487GB;644 parked and no
actionable queue or completion ETA. The full UX goal is still active.

## 15 September — visible preparation, acknowledgements and lost-reply recovery

HTTP-side playlist work was invisible until Bull jobs existed, and successful
queue receipts went only to collapsed history. The existing preparation loop
now exposes actual playlist/track, checking/verifying/copying/queueing phase and
checked/total counts through the read-only pace snapshot. Current activity shows
that work independently of the originating browser request, including after a
reload/lost reply. A single server preparation lane rejects overlapping batches.
Download-folder changes are guarded in both UI and backend until it finishes.
This wraps the existing shared acquisition paths; it is not a new downloader.

Queue receipts now appear visibly with queued/no-op/reused distinctions. The
shared materializer reports actual additions, so duplicate destinations/no-ops
cannot inflate the reuse count. Compatibility `skipped` still includes local
reuse; optional `reused` is its subset, subtracted from UI unchanged totals.
Selections added while a prior request runs are preserved. Acknowledged success
clears only the corresponding earlier action error.

Queue POST observation is bounded at120 seconds, resume at20 seconds. A lost,
malformed or5xx reply is unconfirmed—not proof no jobs were accepted—and is
never automatically re-POSTed. Resume can recover from a fresh snapshot proving
both queues unpaused, without claiming which caller resumed them. Queue status
polls have10-second deadlines, do not overlap, stop on disposal, and discard
stale active preparation on observation loss. Late mutation replies cannot
restart UI work after disposal.

Verification:345 backend tests/44 suites,157 rendered Angular DOM cases,
186 acquisition tests,50 UX helper/lifecycle cases and17 CDP/source/watch tests
pass. Frontend spec and backend typechecks pass; frontend build passes with
existing warnings. Tests include real local hardlink/no-op counts, held backend
preparation, duplicate rejection, folder preservation, receipts, no-ops,
timeouts, partial/unknown outcomes, resume observation and disposal.

Live API recovered after the already-stopping backend12707 hung with no3000
listener, no child process, no CLI owner, and zero active/waiting/delayed jobs.
TERM did not exit; only that verified idle process was killed, and Nest watch
started57049. This is recovery, not a permanent shutdown fix. GET library
returns841; the deliberately empty selection POST returned201/0queued/0skipped
without touching media. Server preparation and web queues are idle/unpaused.
Saved18,333/18,977 songs,172.274658487GB;644 parked, no active download ETA.

Remaining: preparation status is process-local, not a durable per-request
receipt. Lost queue replies therefore cannot yet recover exact counts after a
backend restart; the UI correctly keeps the result unconfirmed and reloads
physical/queue state. Durable request-correlated acknowledgements and the
recurrent watch shutdown hang remain acceptance work. Full rendered-browser,
real playback and live Spotify verification remain unavailable while Chrome
is intentionally disconnected. No Chrome request was made. Goal remains active.
Logs: `/tmp/spooty-admission-{backend,dom,acquire,ux,cdp}-tests.log` and
`/tmp/spooty-admission-fe-build.log`.

## 15 September — saved-library and track-load recovery, rendered DOM tests

The saved-library view now distinguishes initial loading, an empty saved
library, a filter with no matches, hidden finished playlists, and a failed read.
Filter/Hide finished recovery uses a direct button outside the listbox; filtered
focus no longer leaves `aria-activedescendant` pointing to an absent row.
Local read failures use the single Current activity strip with **Retry saved
library** or **Retry saved tracks**, explicitly not Spotify sync/download.
Cached playlists and track lists remain visible on a failed refresh.

Both read paths have30-second deadlines, cancel superseded/disposed requests,
and ignore obsolete responses. A newer quiet coverage read finishes an older
visible loading state rather than leaving its spinner stuck. Track-list loads
now name the playlist in Current activity; failure no longer leaves a blank
pane. Same-playlist competing reads cannot replace newer tracks with old data.
Recovering a library read preserves unrelated action errors.

Added a browser-free Angular DOM runner using the actual component test suite,
template and compiled styles. Its fetch/XHR/WebSocket entry points fail closed
in both Node and window realms; it never launches Chrome or connects to CDP.
Media/scroll layout are controlled test substitutes. Sixteen new cases exercise
the recovery buttons, first-load/filter/hidden states, cached content, deadlines,
request races and disposal.140/140 rendered DOM cases pass;50 lifecycle/helper
UX cases and17 CDP/source/passive-watch cases pass. Frontend spec typecheck and
production build pass with existing Sass/bundle/style warnings.

These are DOM interaction checks, not pixel/real-audio/live-Spotify evidence.
Full authorized browser QA remains outstanding, and the full UX goal is active.
Logs: `/tmp/spooty-angular-dom-tests.log`, `/tmp/spooty-load-ux-tests.log`,
`/tmp/spooty-load-fe-build.log`, `/tmp/spooty-load-cdp-tests.log`.
Read-only4200 checks confirmed the dev-served main script contains the new
recovery controls; library841, focused EARTH78, and audio Range206/1024bytes
remain available. Queues are idle/unpaused. Physical plan remains18,333/18,977
saved,172.274658487GB,644 parked outcomes and no active download ETA. The CDP
proxy remains disconnected; the bounded passive trace found zero clients in
its first543 samples. None of these HTTP checks substitutes for browser QA.

## 15 September — whole-library refresh and honest discovery failures

The open dashboard now runs whole-library discovery every15 minutes instead of
only refreshing the selected playlist. It works with no selection and does not
mistake a recent focused sync for a current library inventory. Recent library
checks, concurrent operations, quiet-failure backoff, observation errors and
component disposal are respected. Known unavailable Chrome never causes quiet
metadata submissions/permission requests. An explicit Sync click explains a
known disconnection on the first click without first submitting doomed work;
the existing connection confirmation remains the only optional next step.

The session layer collects/validates every discovery page before the library
writer receives results. It rejects absent/malformed paging fields, unsafe or
noncontiguous next URLs, duplicates, changing totals and malformed playlist
rows. A genuine empty library remains valid; unnamed rows stay visible and
unknown track counts remain unknown. The Current activity error names the
playlist library and explicitly says saved playlists/MP3s were kept.

Tests cover a new followed playlist through actual discovery, hydration,
adapter and writer; a malformed second page leaves all prior metadata unchanged
and persists an incomplete result without even creating the new placeholder.
Frontend runtime tests exercise the timer with no selection, recent focused vs
library checks, late/concurrent observations, disconnected/connecting states
and first-click guidance. These are controlled-response tests, not real Spotify
or rendered Angular/browser verification.

Verification:341 backend tests/43 suites;50 browser-free UX tests;14 CDP guards;
4 effective Codex config checks; frontend spec typecheck/build (existing Sass
and size warnings). Logs: `/tmp/spooty-discovery-backend-tests.log`,
`/tmp/spooty-discovery-ux-tests.log`, `/tmp/spooty-discovery-fe-build.log`.
Local library and audio APIs remain available; queues are idle/unpaused.
All849 real dumps remain byte-identical (aggregate
`acd244ae1fb2b30abe2df898631129d1106e5742f395c4c1ae97f1c12d63ad75`).
The singleton remains disconnected; no Chrome connection was requested. Full
live Spotify and browser acceptance gates remain open.

## 15 September — same-count edits and trustworthy no-op sync

Fixed two unsafe skip cases: a saved snapshot ID without complete membership
evidence, and discovery that reports no snapshot ID but the same track count.
Both now fetch track membership, so replacements/reordering are not assumed
away. Focused refresh clears the old discovery baseline; successful verified
library sync establishes the next one. Fallback membership cannot certify a
snapshot or increment verified-refresh totals. Its partial-result wording does
not falsely promise that the old track list was preserved. Existing MP3s remain
untouched. Complete, identical metadata is no longer rewritten during a no-op
library check; genuine owner/name/rank changes still persist.

Coverage includes first legacy baseline, matching-but-unverified snapshot,
unknown revision with same count, revision returning later, failed checks keeping
the exact prior dump, owner-only change, unchanged bytes/inode/mtime, and
focused-sync baseline invalidation. A real session-discovery→collector→adapter→
writer test feeds controlled responses with reversed IDs: the saved order and
row numbers change, local playback resolves the correct existing MP3, its
content/inode remain unchanged, no queue mutation occurs, and a second sync
fetches discovery only without rewriting metadata. Browser playback remains a
separate unverified gate.

Verification:302 backend tests/42 suites,41 browser-free UX tests and14 CDP
guard tests passed; frontend spec typecheck and production build passed with
existing Sass/bundle/style warnings. The local API remained available after
watch reload. Physical plan:18,333/18,977 saved,172.274658487GB unique-inode
MP3s;0 actionable/queued work,644 parked outcomes, no active completion ETA.

Read-only inventory found849 live dumps with neither a snapshot ID nor complete
membership evidence. This is legacy metadata, not evidence of bad audio files.
No real Spotify sync was attempted for this iteration and no Chrome permission
was requested. The live metadata aggregate hash remains the recorded
`acd244ae1fb2b30abe2df898631129d1106e5742f395c4c1ae97f1c12d63ad75`.
The full goal still requires authorized rendered/browser and live Spotify QA.

## 15 September — one durable sync operation, cross-tab observation

The previously separate focused/bulk/library lifecycles now share durable
scope, target, operation ID, progress, typed failure and result. Focused sync
uses a non-blocking start endpoint; legacy blocking/bulk routes keep their
compatibility contracts without creating another execution lane. Regression
coverage proves admission persistence, shared concurrent operation identity,
scope conflict handling, failed focused sync and restored interruption.

The existing Current activity strip observes work from other tabs (15-second
idle checks;2-second active checks; bounded/non-overlapping HTTP). Completed
results refresh saved coverage once, not every poll. Lost POST responses and
acknowledged operation IDs are correlated before showing success; an unrelated
old result reports an unconfirmed request. Late initial/idle reads cannot
overwrite a newer manual action. Disposed components ignore replies and cannot
start new sync. Recovered sync errors clear without erasing other action errors.

Verification:295 backend tests/42 suites,40 browser-free UX tests (14 execute
the actual Angular component lifecycle with controlled service responses),
14 CDP guard tests; frontend spec typecheck and production build pass with
existing Sass/bundle/style warnings. The new runtime harness opens no browser
and renders no DOM; full Angular/rendered interaction tests remain unrun.

Live localhost HTTP checks through4200 on15September:

- Focused EARTH Series sync acknowledged in119ms with operation ID
  `4919c3c2-0ad6-4ebe-abfa-4900b21982c8`, then finished with the same ID/scope
  and typed connection failure. It did not request Chrome permission.
- All849 metadata files remained byte-identical before/after:
  `acd244ae1fb2b30abe2df898631129d1106e5742f395c4c1ae97f1c12d63ad75`.
- Saved library returned841 playlists; focused list retained78tracks.
  Local audio returned206 with exactly1024 requested bytes (of8,172,582).
  This proves HTTP media access, not browser playback/seek controls.
- Recovered the already-stopping backend PID69765 (no listener, no active/
  queued work) so watch could start PID71212. The recurrent shutdown hang needs
  an isolated root-cause test; no production queue was paused or cleared.

Physical download plan remains18,333/18,977 saved,172.274658487GB unique-inode
MP3s;644 outcomes parked,0 actionable. No active completion ETA. Chrome is
deliberately disconnected, so the full UX goal is not complete.

## 15 September — verified playlist removals and meaningful empty states

Replaced the blanket refusal to shrink a playlist with an explicit membership
check. The session collector issues evidence only when all declared content
rows were collected and all Spotify songs hydrated; it rejects malformed rows,
unknown content kinds, changing counts, gaps and contradictory truncation flags.
Evidence binds playlist ID, ordered/repeated song IDs, total rows and excluded
episodes/local-only entries. The adapter preserves a verified empty response
instead of entering anonymous embed fallback. HTTP failure cannot manufacture
an empty playlist.

A shorter list (including empty) needs a second complete API read with matching
ordered IDs and total item count before an atomic metadata write. The writer
does not call track/queue mutations or delete/move MP3s. Verified empty/non-music
baselines are retained so discovery does not repeatedly reload them. Omitted
discovery count is unknown, not an instruction to empty a playlist.

Current activity receipts explain before/after counts and that existing MP3s
and queued work were kept. Empty-state text distinguishes not loaded, verified
empty, and unsupported-only lists. A focused sync losing Chrome reports that
connection issue and offers the existing explicit recovery control, without
requesting permission. No new status panel was added.

Verification:288 backend tests across42 suites,186 acquisition tests,18
browser-free UX tests and13 CDP/bypass tests passed; app/spec typechecks and production frontend build passed
(existing Sass/size warnings). Tests include the real collector→adapter→writer
path using controlled API responses, inode/content preservation, queued-record
preservation, repeated IDs, empty playlists, unhydrated tracks, changed second
reads, and failure recovery. New Angular render/interaction tests are written
and typechecked, not executed. Successful live Spotify removal sync and browser
UX remain unverified; do not call the overall goal complete.

Real HTTP failure check on EARTH Series returned503 with a clear disconnected
Chrome message; its78 saved track entries remained. All849 metadata files had
the same aggregate SHA256 before/after:
`acd244ae1fb2b30abe2df898631129d1106e5742f395c4c1ae97f1c12d63ad75`.
The bridge was checked disconnected before the call; no reconnect was requested.
Next: durable focused/bulk sync lifecycle, trusted legacy baselines, stable
track/occurrence identity and incremental coverage, then authorized live QA.

## 15 September — Spotify sync discoverability and truthful recovery

**Sync Spotify library** is visible outside collapsed Library tools; **Sync this
playlist** is explicitly scoped. Both say metadata and MP3 downloads are
separate. A first-run empty library now has a usable Sync action instead of
asking the user to select a nonexistent playlist. Per-playlist sync timestamps
appear beside the Spotify link; library-check timestamps remain in details.

Sync progress, friendly failure explanations and completion receipts use the
single Current activity strip. Poll requests have a10-second deadline and never
overlap. Observation loss stops the sync animation, says the server may still
be working, and keeps checking without posting another job. A lost POST reply
also triggers observation, not a duplicate submission. Restart/empty operation
state ends as interrupted instead of leaving a permanent spinner. Name/owner/
order-only sync results refresh the saved view even when track counts do not
change. Library and focused sync controls do not submit overlapping work;
the backend coalesces concurrent syncs of the same playlist.

Library sync progress/results persist atomically in `spotify-library-sync.json`
beside DB_PATH, not dist. A restored running flag becomes a durable interrupted
result without issuing Spotify/CDP requests. Existing playlist snapshots and
MP3s are unaffected by this status record. Bulk legacy resync progress remains
in memory and still needs the same treatment if exposed in the UI again.

Verification this iteration:250 backend tests passed;11 browser-free sync UX
tests passed;frontend app/spec typechecks and production build passed, with
existing Sass and bundle/style budget warnings. Updated Angular interaction
tests cover visibility, scope/duplicate guards, observation loss, recovery and
restart, but **the browser suite and live rendered UI have not been rerun**:
the Chrome proxy is intentionally disconnected after the user's repeated
permission-prompt report. No direct connector or new browser was used to bypass
that restriction. Full-goal completion remains unproven.

Live disconnected-backend check:POST `/api/library/sync` completed in2ms with
`CDP proxy is down` and persisted its terminal result beside SQLite. SHA256 of
the complete849-file metadata set was identical before/after; Chrome had zero
connected debugging clients. This proves the API failure path, not rendered UI
behavior. Requests completed too quickly to test live overlap; duplicate
suppression was verified with held-open service-unit operations instead.
Current physical catalog:18,333/18,977 saved,172.274658487GB;644 parked outcomes,
zero actionable songs and both web queues idle/unpaused. No active batch ETA.

## 15 September — resumed-web usability redesign

Replaced the accumulated dashboard status surfaces with one **Current activity**
strip: current operation/track, real percentage or indeterminate activity,
pause/CLI ownership, scheduled wake-up and configuration warning. Spotify work
and resync completion appear in the same place. Details, collapsed by default,
contain concurrent work, chronological results, queued playlists, pace settings
and clearly historical CLI benchmarks. The playlist has one saved-progress bar;
sidebar rows have short saved counts. Library tools, search settings and track
diagnostics expand on demand. Removed sidebar status stacks and bottom overlay.

Added observational worker-stage telemetry without a second acquisition path.
Actual Bull membership bounds active jobs and provides the next delayed time;
the in-process tracker covers metadata, local verification/reuse, waiting slots,
search and download. Queued duplicates waiting on the same song are not described
as extra searches. Session counts distinguish new MP3s from local reuse/checks.

Live resume found and repaired blank-quality default handling, incompatible
legacy batch variables in retained-profile mode, and transient `searchAlbum`
leaking into TypeORM updates. Existing jobs/files/safety settings were preserved.
33 stranded configuration-failure admissions were recovered through the existing
API; already queued/active work was excluded. The focused playlist's remaining
operational retry was also exercised through the real UI, and **K Scope — The
Setup** subsequently appeared as a downloaded MP3 in the real activity history.

Verification: **242 backend + 140 frontend + 186 CLI = 568 tests passing**;
both typechecks and production frontend build pass (existing Sass/size warnings).
Real Chrome checks: saved library, filter/selection, Spotify resync, retry action,
live search/download/completion history, playback, details toggle, and desktop /
1100px / 760px layouts. Narrow navigation no longer pushes the track table off
screen or creates a huge document scrollbar. Current queue remains running.

## 15 September — action model and false Pending repair

The focused playlist no longer replaces its controls with a disabled status
button. Progress is a separate labelled panel; unqueued work retains a counted
Queue action alongside other queued/running tracks. Copy-only actions describe
adding existing MP3s. Search exhaustion uses Search again; successful rows and
zero-failure counters no longer generate red diagnostic noise.

EARTH Series's 20 Pending rows already had Bull jobs. The track adapter now
projects legacy New rows from actual queue membership, excluding parked journal
outcomes. It does not mutate jobs on reads or infer queued state from another
playlist. Normal New admissions detect existing jobs and preserve known URLs;
genuinely unsubmitted New rows are now actionable in LibraryService.

Explicit Resume web downloads opens a whole-queue scope confirmation. The new
POST `/api/youtube/queues/resume` requires `scope: all-web-queues` and atomically
checks ownership before using the installed Bull resume script for both queues.
No implicit resume accompanies download, retry, resync, refresh or deployment.

Verified: 233 backend + 118 frontend + 186 CLI tests (537 total), typechecks and
frontend production build. Isolated real Bull workers resume preserved jobs;
ownership conflict, duplicate admission and rename-overwrite protection tested.
Real original Chrome tab shows 54/78 saved and 24 queued/paused with no disabled
status button. QA tab exercised resume confirmation/cancel, local play/pause
(1.62→13.04 seconds), and successful 78-track Spotify resync. Live queues remain
paused/active0; no media changed and no new YouTube work was started by QA.
See HANDOVER for exact job counts, disk usage and ETA scope.

Audited 2026-09-11 against the running app at `http://127.0.0.1:4200/`.
The normative product and UX contract is
`OPERATOR_DASHBOARD_PRINCIPLES.md`; this file records implementation findings,
fixes, verification, and remaining work.

## 15 September: waiting jobs must not lock playlist retries

Fixed the reported EARTH retry lock: `stats.ripping` included waiting jobs and
hid both explicit retry actions for the whole playlist. Those actions now stay
available for other failed tracks while retaining CLI ownership, input and
in-flight-request guards. A historical Missing count does not reoffer a track
already running; current track outcomes determine the retryable Missing count.

Added read-only Bull pause/active telemetry to the pace response. Footer and
sidebar distinguish paused, partially paused, processing and waiting work.
Footer counts explicitly refer to playlists. Paused queued rows no longer make
unsubmitted dump leftovers look queued. Admission messages warn that paused
queues do not start automatically. No resume operation was introduced.

Actual Chrome Retry 20 click on `04Mj5fSvHOHsO01sdTfDSd` returned Queued 21 / 58
unchanged: all 20 exhausted searches plus Big Bud — Spiritual, whose reusable
378.090542-second file failed its 300.5-second Spotify target. Fifteen valid
reusable files were materialized into the playlist folder without new audio
downloads. Two selected URLs remained intact; own-folder coverage is 56/79.

The browser exercise additionally found and fixed admitted search jobs retaining
New/Pending. They now show Queued/Waiting; an enqueue failure is marked failed.
The exact 21 pre-fix admissions were matched to their actual paused jobs and
reconciled without adding jobs. The playlist now shows 23 Waiting, not running.
Both queues remain paused/active0; no media deleted and no acquisition ETA.

525 tests pass (227 backend, 115 frontend, 183 CLI), both typechecks and frontend
production build pass with existing warnings. Browser verification exercised
the actual retry submission and post-refresh state; tests cover scheduled jobs,
CLI ownership, failure rollback, partial pause, and queued-versus-running labels.

## 15 September: shared query fallback and explainable candidate selection

After auditing the 22 unavailable EARTH Series tracks, added shared automatic
query variation rather than any agent-in-the-loop search step. Both CLI and web
use up to three distinct queries with ten ranked results each by default; video
IDs deduplicate across queries. Candidate title phrase, artist credit and edition
markers are checked alongside the unchanged fuzzy duration guard. Two credible
missing-duration candidates at most receive metered inspection. Longer editions
are still rejected; the other 20 audited tracks are not claimed recovered.

The new lazy **Search evidence** disclosure reads latest durable, private
per-candidate records, including query, link, length, rejection reason and selected
result. It distinguishes unfinished transport failures from completed search
exhaustion and says explicitly when older runs have no detailed evidence. A
selected search result is not labelled a saved MP3. No enqueue, retry or Spotify
request is made by opening evidence. Manual Refresh now also reloads CLI-written
active track state, preventing stale retry badges after CLI discovery succeeds.

Live CLI search-only run `2026-09-15T00-57-31-454Z` found both independently
audited recoverable sources automatically: The Setup on album-context query 2,
The Plan on official-audio query 3. The actual durable reports were opened in a
separate real Chrome localhost tab; queries, selected links, Spotify tolerances
and rejection text rendered correctly with no horizontal overflow. Playback of
an existing EARTH MP3 advanced 6.35→16.34 seconds without media error, then paused.
Explicit Unplugged resync completed and retained three tracks. On the known
17-saved/one-parked Deluxe playlist, normal bulk Download remained disabled due
to existing queued work; no exhausted-search retry or queue resume was used to
bypass it. Thus this turn's browser check verified the download guard, not a new
web download. The shared web acquisition/publication integration tests cover
that path without contacting YouTube.

183 CLI tests, 220 backend tests and 112 frontend browser tests pass (515 total),
including query bounds/deduplication, fallback, missing-duration inspection,
wrong-title/artist/edition rejection, error separation, shared web adapter and
read-only evidence UI. Backend typecheck and frontend production build pass;
existing bundle/style warnings remain. No fresh MP3 throughput benchmark: only
search discovery was live-tested. Both web queues remained paused/active0;
18,330 saved songs and 172.146744669 GB of MP3 data were unchanged.

## 15 September: persistent download folder and moved-library recognition

The user confirmed moving the media to `/Users/dom/Desktop/mp3_downloads`.
The prior empty `downloads/` observation below was an outdated configured path,
not missing catalog audio. Added **Download folder → Save & rescan** in the
sidebar and `GET/POST /api/settings/download-location`. The setting is stored
atomically, mode 0600, in ignored `settings.json` beside `DB_PATH`, not `dist/`.
The shared CLI/web resolver gives saved `downloadsPath` precedence over the env
fallback. Existing absolute readable/writable folders only; no directory/media
migration, no deletion, no automatic download or queue resume. Backend changes
take effect immediately; the CLI rechecks after acquiring its exclusive lease.

The maintenance lease atomically checks CLI ownership and both Bull queues,
refuses active or unpaused runnable work, and permits preserved paused backlog
or empty idle queues. Local JSON-only origin/host/remote-address checks protect
the filesystem-setting endpoint. Invalid paths leave the prior location intact.
UI saves stop old playback, discard stale coverage/detail responses, refresh
physical coverage, and briefly hold acquisition controls.

Verified in a separate real Chrome tab: saved the moved folder through the form,
observed restored list/detail counts, rejected a relative path with the active
folder unchanged, and reloaded the page with the saved value intact. A subsequent
Nest watch reload also retained it. Local playback advanced from 1.27 to 11.04
seconds in an 82.84-second MP3 without media errors, then paused. Normal Download
for the 17-saved/one-parked fixture playlist returned **Queued 0 · 18 unchanged**.
No new YouTube work or file copies were admitted. Spotify resync was not repeated
for this filesystem-setting change.

Live CLI `plan` using the persisted setting: **18,330/18,977 saved**, 647 parked,
`actionable=0`, **172.146744669 GB** unique-inode MP3 data. Web coverage correctly
distinguishes 18,572/23,289 occurrences in their own playlist folders from 22,537
available across the library. Both queues stayed paused/active0, preserving
1,792 download and 13,580 search jobs. No active or buffered acquisition ETA.

Verification: 173 CLI tests (including isolated real Redis maintenance-lease
and first-class CLI path-resolution tests), 216 backend tests, 108 frontend
browser tests: **497 passed**. Both typechecks, frontend production build and
diff check pass; existing Sass and bundle/style budget warnings remain.

## 15 September: playlist owner attribution

The library list and detail header now display playlist ownership. The logged-in
session importer retains public `owner` fields from `/v1/me/playlists`: display
name, user ID and a validated Spotify profile URL. Successful library discovery
persists these fields even when the playlist snapshot/tracks are unchanged;
missing upstream owner data does not erase a saved owner. No extra profile
requests are added. Track-list hydration still uses playlist-v2 and metadata/4.

Existing dumps work immediately through a shared attribution projection. Ordinary
`Playlist • name` subtitles provide a cached owner label with a provenance tooltip,
but no invented ID/profile link. `Playlist • Made for name` is personalization,
not ownership. Structured owners take precedence, unknown owners remain explicit,
and the UI does not claim original-creator history. The live eligible library
contained 736 cached owner labels, 103 personalized labels and two without either.

Verification: 200 backend tests, 104 frontend browser tests, backend TypeScript
check and frontend production build passed (existing bundle/Sass warnings).
An isolated main-Chrome tab at `http://127.0.0.1:4200/` exercised filtering and
playlist selection across all three attribution cases; list/detail text and
cached provenance were checked, with no horizontal overflow. Structured profile
links, null display names, malicious URLs, escaping and metadata-only persistence
are covered by automated tests. Live API owner refresh was not proven because
Spotify discovery was rate-limited; existing saved metadata remains usable.

Both YouTube queues remained paused with zero active jobs. No download admission,
media deletion/move or live playback test was performed: the configured
`downloads/` folder was empty during this check (0 MP3s, 0 GB), a separate runtime
condition that this metadata-only change does not resolve.

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

## Remaining work, in order (15 September refresh)

1. After a single explicitly user-authorized reconnect of the existing
   main-Chrome keepalive bridge on `127.0.0.1:17331`, run one
   complete live library sync. Confirm that a newly added playlist appears and
   that a same-count edit is detected without rewriting unrelated snapshots.
2. Re-run the Angular interaction suite and full localhost workflow: first-run
   sync, existing library sync, playlist selection, download/resume/no-op,
   progress and playback, narrow layout, errors and reconnects. Retain current
   shared4-download/1-search/240-per10-minute settings and safety state; older
   unguarded trial numbers above are not authority to retune production.
3. Shared Spotify-source identity and explicit playlist occurrences are now
   implemented. Legacy quality-review compatibility is now audited and shared
   across inspection, duration snapshots, benchmark reports and replacement
   bookkeeping. Seven real entries remain unbound; do not guess source IDs or
   deliberately reopen reviews merely to clear them. Keep real recording/edition
   validation distinct from source-duration agreement.
4. Incremental filesystem/DB coverage and Socket.IO notifications are now
   implemented. Verify external additions/removals, root changes and cross-tab
   updates in the authorized live browser; do not restore repeated full scans.
5. Unified library/individual/bulk durability and typed failure kinds are now
   implemented/tested. Verify interruption/reconnect and cross-tab updates in
   the authorized live browser, beyond the Node component/store tests. The idle
   Redis-outage shutdown hang and a post-reconnect stranded blocking wait are
   reproduced/fixed; retain phase evidence for any different historical hang,
   without force-closing active media work.
6. Selected Bulma Sass modules, cascade/dependency checks and retired component
   style cleanup are complete; Sass/component-style warnings are cleared.
   Initial composition was inspected and unused Angular routing removed without
   deferring the dashboard. Further splitting requires real browser first-paint
   measurement; do not delay the saved library to satisfy a bundle threshold.
   The initial-bundle warning remains, not a functional blocker.
7. The legacy snapshot-baseline guard is now implemented/tested; verify it with
   live same-count edits after reconnect. Do not weaken it to reduce API calls.
8. Track removals, including empty playlists, now require two complete matching
   authenticated reads and have regression coverage. Verify real removals after
   authorized reconnect. Whole playlists no longer returned by a complete
   discovery now have a dated Kept locally explanation; verify that flow in the
   real browser without deleting MP3s or treating discovery failure as removal.
9. The fallback now returns a declared count/truncation flag and preserves
   duplicate occurrences in tests. Keep HTML a last resort, and verify real
   fallback behavior only within the approved browser context.
