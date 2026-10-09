# Handover: Spooty library MP3 backfill + YouTube throughput

## Latest — 9 October 2026: Life timeline sources, four mixes and public handoff

Public collection: https://fifty-dj-room.dm-ae80.chatgpt.site/?playlist=life-timeline#mixes
The existing Playlist 50 collection remains available and its catalogs are unchanged.

- The new handover has all 55 requested titles in fixed chronological order.
  Acquired only the missing Liberian Girl and Horizons through isolated shared
  acquisition runs; no substitution. All original 53 file hashes remain unchanged.
  Sources total 501,710,865 bytes. Three original MP3s (15, 18, 19) have retained
  recoverable frame warnings. Wrong catalog links were corrected or omitted;
  original edition labels and corrections remain in the private source evidence.
- Read-only source audit and provenance are under
  `data/automix/handover/life-timeline-v1/`. The personal handover, source audio,
  renders, caches and generated packages remain Git-ignored. No MP3 is tracked.
- Scanned all 55 sources for beats/key/loudness and 881 musical sections: six
  exact cached MLX analyses and 49 measured chroma/MFCC/loudness novelty analyses.
  The latter use generic section labels, not invented chorus/verse classifications.
  The initial slow MLX attempt was stopped and its diagnostic evidence retained.
- Final rendered durations (60/90/180 mean approximate source seconds per song,
  including overlaps): 60s = 50m27s; 90s = 1h17m52s; 180s = 2h39m57s;
  full tracks = 4h48m51s. All four contain every track in the supplied order.
  The full mix includes all decoded source audio, with 54 five-second edge fades;
  short sources remain whole in the longer excerpts. No energy-based reordering.
- Final `timeline-encoded-v3` checks: every source hash matches the final audit,
  every MP3 decodes cleanly, all 55 chapter titles/times match, source intervals
  have no gaps, and original-rate stereo overlap peaks are checked. All 14
  beatmatched excerpt overlaps pass independent encoded-audio beat detection.
  Continuity warnings remain: full 33; 60s 2; 90s 2; 180s 3. These are retained
  in public CSV/JSON. No listening approval or whole-mix beat-grid pass is claimed.
- Render proof: `data/automix/builds/life-timeline-v1-20261009/`, especially
  `regeneration.json` and `post-run-verification.json`. Owned render, analysis
  and acquisition processes exited. The previous local audition server was left
  untouched. Web queues were empty and unpaused before and after targeted
  acquisition; its temporary ownership pause was restored, with no job interrupted.
- Public package: `data/dj-share-life-timeline/`; ZIP 501,839,106 bytes, 60 members,
  every member CRC/SHA read back. Sources retain exact-file SHA identities and
  Spotify links where known. All four mixes have CUEs, order/transition CSVs,
  section selections, source intervals and quality details. Catalog publication
  follows completed media uploads; see immutable final-v3 upload task lists.
- Public readback evidence: `data/dj-share-upload-state/public-timeline-*`.
  Source downloads, ZIP and all four mixes receive full anonymous SHA-256 readback
  plus beginning/middle/end seek tests. Final catalogs/companions are checked
  byte-for-byte; prior mismatch during metadata revision is preserved separately.
- Code: root generation/export/verification tools on GitHub `7-of-9/spooty` main;
  separate Site source on branch `dj-share-site` at `5492f56`, Site saved version 6.
  Continue using registered Site `appgprj_6ac45ae0b0ac8191978e4854d7049c85`.
  Upload secrets stay only in runtime configuration/session memory, outside Git.
  Validation: 10 focused timeline/section tests, 12 Site tests, real full-file and
  source preservation checks. No new Chrome connection or browser listening QA.
- Existing Spotify catalog: 19,067/19,732 saved; 173.358960927 GB unique-inode
  MP3 storage under the active download root. The two targeted additions are
  outside that older catalog denominator. No unrelated parked search was reopened.

## Latest — 6 October 2026: all five playlist 50 versions regenerated and public DJ handoff published

Public page: https://fifty-dj-room.dm-ae80.chatgpt.site
The user explicitly authorized public track/mix downloads and GitHub publication.

- Playlist `50` (`4tlyiGCRW6LH5BqF0F30Ib`) refreshed at 06:40:55 Bangkok:
  99 -> 100 tracks, verified membership, no removals. Joe Satriani — Love Thing
  was reused from existing duration-matched local audio through shared media
  identity/materialization. All 100 source tracks are physically present.
- Regenerated A / Energy arc v2 (S6), B / Genre waves v2 (S7), Claude_Best v3
  (S8), Claude_Best / energy arc v4 (S9), and Claude_Best / Medley v7. Each has
  all 100 distinct source songs. A and S9 have identical audio: complete render
  input equality, including ordered source hashes and warp inputs, justified
  reuse; the public page discloses this. Full mixes last approximately 6h45–48m.
- Medley v7: 76m32s, 100 chapters, 99 transitions; selected transition checks
  are 28 pass, 71 warnings, zero failures. Whole-mix V13 alignment STILL FAILS:
  body downbeats 90.69% within 20 ms, below 95%; landings 95.96% within 40 ms
  pass their 90% threshold. Failed proof and warnings remain in public JSON/CSV.
  Do not describe this as fully beat-verified or as having passed listening QA.
- Public handoff has 100 individually playable/downloadable MP3s, a 947,324,577
  byte ZIP, track CSV/M3U, Spotify IDs, ISRCs and exact-file SHA-256 hashes, plus
  all five rendered mixes, chapter/order lists, transition CSVs, JSON and CUEs.
  ISRCs describe the intended Spotify recording; supplied audio has not been
  acoustically verified against that master. Source MP3s were not retagged.
- Anonymous public readback verified all 100 source hashes (one interrupted
  first transfer retained alongside its successful retry), ZIP and three
  distinct full-mix hashes, plus the medley hash and seek ranges. S9 header and
  ranges passed, with its identical audio independently established locally.
  Public catalogs exactly match local bytes and show all five mixes ready.
- Package: `data/dj-share-50/`; upload/public-readback proofs and final record:
  `data/dj-share-upload-state/`. Generation/preservation proof:
  `data/automix/builds/regen-20261006/post-run-verification.json`.
- Sites project: `appgprj_6ac45ae0b0ac8191978e4854d7049c85`; reuse this registered
  site for updates. Its independent checkout is `dj-share-site/`, mirrored to
  GitHub `7-of-9/spooty` branch `dj-share-site` at `17f3b41`. Root generation,
  export and verification tools are on `main`. Upload secrets stay out of Git.
- Validation includes 10 Site tests, two ISRC fixtures, 35 CDP/source guards,
  real catalog DOM wiring/search, and actual media/readback checks. Browser
  listening/full browser acceptance is not claimed. Only the approved singleton
  was used for the authorized Spotify refresh; no alternate browser was opened.
- Prior saved versions, manual history, overrides and ratings were preserved;
  all seven medleys remain. Build processes exited. Local audition server on
  4300 remains active; medley: http://127.0.0.1:4300/?medley=20261006-105203
- Catalog: 19,067/19,732 saved, 173.338447557 GB unique-inode MP3s in the active
  `/Users/dom/Desktop/mp3_downloads` root. No actionable bulk work; 665 parked
  outcomes remain. No queue was resumed or parked search reopened. Bulk ETA:
  none; regeneration and publication complete. Beat-alignment repair is separate.

## Latest — 3 October 2026, 10:50 Bangkok: playlist 50 refreshed, medley v6 published

Claude's latest work was the automix v6 continuation, not the older bulk-acquisition
handover below. Its 1 October turn stopped at a session limit with scoring code
written but five of ten blend tests failing. Those failures are now repaired.

- User authorized stopping the specifically identified stale Codex session 69403
  in `/Users/dom/src/tmp`. Its PID/start identity was checked before TERM; it and
  all identified browser-tool children have exited. The browser preflight passed
  all seven checks. One authorized connection through existing singleton 40434
  succeeded. No replacement browser/proxy or permission click was used.
- Playlist `50` (`4tlyiGCRW6LH5BqF0F30Ib`) synced through the normal backend API at
  09:16:57 Bangkok: 96 -> 99 tracks, verified membership, no removals. The three
  additions already existed elsewhere in the active media library. Shared
  `LocalMediaIndex` duration verification and `materializeForTrack` reused those
  exact local sources. The API subsequently verified 99/99 in folder 50.
- Added tracks: Audioslave — Show Me How to Live; The Thrillseekers/Hydra —
  Affinity (Shah and Del Mar Coastline Remix); Jon Hopkins — Halcyon. Cached
  analysis, structure and stems were prepared for exactly these three. Structure
  ran one GPU job at a time with retained stems. The unchanged energy model was
  reproduced against the existing entries before adding their predictions.
- V6 scoring now integrates beat-length energy, avoiding false bass holes between
  kicks, and compares adjacent beats so level cliffs are not smoothed away.
  Silence is excluded from harmonic overlap. Rating priors retain precision.
  Shorter candidates win close scores before variety. The audition view now
  shows warnings from the selected candidate instead of the last attempted one.
- Validation: 315 medley tests passed after the scoring fixes; 28 selection and
  integration tests passed after the tie-break fix; two audition-view regressions
  passed. Real v5 audio was used for calibration. This is distinct from live
  listening or full browser acceptance.

V6: http://127.0.0.1:4300/?medley=20261003-104357
Desktop: `/Users/dom/Desktop/Claude_Best_Medley_v6.mp3` (and matching `.cue`).
It contains all 99 distinct songs and 99 chapters, lasts 77m08s, and took 76m31s
including three planning rounds. Default mandatory transition checks: 29 pass,
69 warnings, zero failures. No songs were excluded or left unprepared.

The FINAL encoded MP3 continuity audit improved from v5's median 80.2 and 28/95
joins below 60 to v6's median 89.9 and 12/98 below 60. Of 76 shared song pairs,
51 improved, 21 worsened and four tied on this metric. These are continuity
measurements, not a claim of universally improved musical taste.

The whole-mix V13 check STILL FAILS: body downbeats 66.5% within 20 ms, below the
95% threshold; landings 91.8% within 40 ms pass their 90% threshold. V5 had 17.3%
and 32.6%, respectively. The failed evidence and all warnings are preserved.
Do not describe this as fully beat-verified. The next useful review is the 12
weak continuity joins and the remaining whole-mix body-alignment failure.

Artifacts: `data/automix/builds/v6-20261003/` contains the MP3, cue, report,
verification journal, both encoded-audio audits and audit script, scoring
configuration, input hashes, HTTP verification and acquisition snapshot.
Build log: `/tmp/spooty-medley-v6-build-20261003.log`. Audition server PID 99450
serves 99 tracks; v6 is version 6 in `/api/medleys`. Its 99 songs, 98 transitions,
selected warnings and a real 206/audio-mpeg/1024-byte MP3 range were checked.
No active build remains. Prior mixes, ratings and manual sets were preserved.

Final fresh physical catalog: 19,067/19,732 saved, 173.338447557 GB unique-inode
MP3 storage in the saved active root `/Users/dom/Desktop/mp3_downloads`.
No actionable acquisition work; 665 parked outcomes remain. Bulk ETA: none;
v6 is delivered. No acquisition queue was resumed or failed searches reopened.
At 10:50 the existing bridge reported disconnected/not connecting. Do not reuse
the spent connection grant: any future reconnect needs fresh authorization.
The previous broad website/browser/audio acceptance task below remains separate.

## Latest — 17 September14:25 Bangkok: authorized connection attempted once

The user explicitly granted the previously requested specific-session stop
and one singleton reconnect. Live PID/start-time and cwd checks found the old
Codex40383 already gone; no process was killed. No direct Codex Chrome tools or
browser-enabled runtimes were present. Singleton14004 still owned17331 and was
disconnected. The preflight passed six checks; plugin enumeration timed out.
A separate bounded, filtered enumeration confirmed Chrome and Browser plugins
disabled. No browser route was re-enabled or replacement proxy launched.

Exactly one POST /connect went to the existing singleton at14:21:36 Bangkok.
During the pending request OS inspection found exactly one Chrome client,
PID14004. The HTTP request timed out without an established CDP connection.
At14:24:32 health was disconnected/not connecting; at14:25:06 OS inspection
confirmed zero Chrome clients, no stale parent, no direct tools or browser REPLs.
No automated retry or permission click occurred. The user must be present to
approve Chrome's prompt on a newly authorized single attempt. Do not reuse the
17September grant for another POST. Never claim that a specific visible prompt
was accepted, rejected or shown based only on the handshake timeout.

All tool handles from this turn are terminal. The UX goal is still incomplete;
its stored status remains blocked. This new user-resumed attempt made progress
by verifying the old parent had exited and exercising the authorized connection.
Do not carry the old three-turn blocked count into this fresh resumed attempt.
Live browser/Spotify/layout/audio acceptance remains outstanding. No app code,
Spotify library, queues, settings or media was changed. Fresh plan:
19,056/19,729 saved,172.274658487GB; queues empty/unpaused, active0, no CLI owner,
no active completion ETA. /tmp/spooty-permission-granted-plan.json.

## Goal blocked — third consecutive impasse check, 15 September18:44:29 Bangkok

Previous turn was no progress, not a live-job wait. Read-only revalidation again
found singleton14004 disconnected/not connecting, with the recorded Codex40383
and its original UTC start identity still alive. No new authority or external
change enables the remaining live-browser acceptance. The three-consecutive-
turn threshold is met; mark the goal blocked, NOT complete. No browser/other
session/queue was restarted and no permissions were requested through Chrome.

Resume only with authority to resolve that specific stale session and make one
connection through the existing singleton, or a verified equivalent external
state change. Real Spotify library/edit/removal sync, multi-tab/recovery,
responsive/theme/keyboard and audible playback checks remain in WEBSITE_AUDIT.
All non-browser test handles are terminal; do not wait on or restart old tests.
Current media/queue state is unchanged:19,056/19,729 saved,172.274658487GB;
empty/unpaused queues, no owner/preparation or active ETA. Fresh plan is
/tmp/spooty-acceptance-blocked-plan.json.

## Blocked audit — second consecutive impasse check, 15 September18:43:54 Bangkok

Previous goal turn completed the non-browser acceptance audit and reached the
first impasse. This continuation made no implementation progress: read-only
revalidation found singleton14004 still disconnected/not connecting and the
same Codex40383/start identity still alive. No browser permission, other-session
stop or reconnect was authorized. The remaining real-browser acceptance gates
are unchanged; do not rerun complete suites or create unrelated edits as busywork.
Goal stays active at this second check. If the same impasse is revalidated on
the next continuation with no meaningful safe action, mark the goal blocked.
Queues remain empty/unpaused, active0, owner available, no preparation. Fresh
plan:19,056/19,729 saved,172.274658487GB;19 actionable not queued, no active ETA.

## Latest — 15 September, 18:43 Bangkok: non-browser acceptance audit complete

Previous goal turn was progress: connection-state race/teardown fixes. This
continuation completed the combined non-browser check and requirement audit.
All1,033 tests pass without skips:429 backend/51 suites,212 acquisition,270
rendered DOM/service,87 UX/process/style and35 CDP/source regressions. Both
typechecks pass. Every launched test handle finished; no test process is being
waited on. Logs /tmp/spooty-acceptance-{backend,acquire,dom,ux,cdp,be-typecheck,
fe-typecheck}.log. No browser, Spotify or YouTube operation was performed.

WEBSITE_AUDIT now maps the normative requirement groups to concrete evidence
and missing live acceptance. Real4200 HTTP library/detail/media checks pass:
841 playlists,23,289 checked occurrences, zero errors, same reused scan,
matched detail and206/audio-mpeg/1024byte MP3 range. Zero verified membership
baselines/presence observations; Chrome disconnected; sync idle with one error.
These observations do not prove successful Spotify sync, layout or audio.

No further evidenced implementation fix was found. The next substantive step
is live browser/Spotify/multi-tab/layout/playback acceptance. The outstanding
specific-session stop/reload and singleton reconnect have NOT been authorized.
This is the first impasse check after the last implementation progress. Keep
the goal active; on subsequent continuations revalidate the same access blocker,
and use the strict three-consecutive-turn blocked audit instead of cosmetic
busywork or repeatedly rerunning already-complete tests. Do not mark complete.

Fresh plan /tmp/spooty-acceptance-plan.json:19,056/19,729 sources saved,
172.274658487GB/18,537 inodes. Queues empty/unpaused, no owner/preparation,
19 actionable sources not queued; no current output rate or completion ETA.

## Latest — 15 September: Spotify connection-state races fixed

Previous turn made progress by containing another confirmed CDP bypass; this
goal continuation did not authorize stopping Codex40383 or connecting Chrome.
Safe sync-flow review reproduced a separate UI race: old health replies could
undo a newly acknowledged connection and offer reconnection incorrectly. Lost
POST replies could reuse an old health observation, and closed components kept
connection subscriptions/callbacks alive. Six new DOM regressions failed first.

Superseded health reads are now disposed at connection start/completion; lost
replies get a fresh read. Teardown disposes response subscriptions and guards
handlers. Readiness changes retire old confirmations. No automatic connection,
Spotify submission, download, singleton disconnect or other-agent change.
270 DOM/service tests,32 sync-flow tests, FE spec typecheck/build pass. Current
4200 main.js serves the cleanup. Logs /tmp/spooty-chrome-state-{red,dom,sync,
typecheck,build}.log. This is not attribution/fix of the other parent's prompts.

Finished documenting the preceding bootstrap work: no URL routes are used,
so unused provideRouter was removed. App-root tests now run in the DOM runner
with real appConfig and singular styleUrl support. Library/sync/activity remain
immediate. Main JS537→462KB, total initial976KB;500KB warning remains. No lazy
chunks or budget inflation. See WEBSITE_AUDIT/README for exact checkpoint data.

Live acceptance remains incomplete:841 playlists/23,289 checked occurrences,
zero file errors, but zero verified membership baselines/dated library-presence
observations. Chrome is disconnected; sync idle with one prior error. Real
authenticated sync/edits/removals, cross-tab/recovery, responsive/theme/keyboard
layout and audible playback require authorized live verification. Tests cannot
substitute for these gates. Latest fresh media/queue check from this incident:
19,056/19,729 sources saved,172.274658487GB/18,537 inodes; empty/unpaused queues,
no active CLI/preparation, no current throughput or ETA.19 actionable unqueued.

## Latest — 15 September, 18:36 Bangkok: CDP recurrence contained, parent unresolved

The latest user request is recurring Chrome CDP prompts, not authorization to
connect Chrome or stop another project's agent. Exact live attribution again
found direct Chrome tools85009/85052 and browser-enabled runtimes85006/85030
under old Codex40383 (`/Users/dom/src/heimdall-mr`, UTC start14September05:46:17).
Three tool processes received TERM after identity checks; worker85052 exited
with its launcher. Parent, Chrome and singleton14004 were preserved.

35 CDP regressions pass; live/config check is6pass/1fail because the recorded
stale parent remains. Saved settings are correct but do not retrofit that live
session. Singleton remains disconnected/not connecting. This is containment,
not a permanent fix or attribution of an individual Chrome prompt. Permanent
remediation still needs verified configuration reload or authorized session
stop. See scripts/CDP.md; do not repeat "fixed forever" or erase the gate.

No queue/media mutation. Fresh plan:19,056/19,729 source tracks saved,
172.274658487GB across18,537 MP3 inodes. Both queues empty/unpaused, active0,
no CLI owner or preparation. No current throughput/completion ETA.19 actionable
sources remain unqueued; all parked outcomes remain parked.

## Latest — 15 September: stylesheet payload and activity readability improved

Previous goal turn was progress: navigation/sync visibility fixes. This turn
followed the build-quality backlog without Chrome access or other-agent work.
Global CSS uses supported Bulma modules while preserving reset/themes/icons and
all relevant current/legacy helper rules. The full-framework comparison caught
an omitted is-flex rule, now restored. Production CSS759.92→478.64KB; estimated
transfer53.74→33.01KB. Retired sidebar/bottom-queue styles are removed and live
activity controls colocated. Sass/component-style warnings are gone; the total
initial1.05MB bundle warning remains and its500KB budget was not changed.

Fixed actual fallback-row contrast: light hover surface, darker progress text,
visible focus outline and panel-relative strong text for system dark mode.
Six new style regressions cover cascade order, variables, obsolete selectors
and declared contrast.259 DOM/service tests,87 UX/process/style tests, frontend
typecheck and production build pass. See WEBSITE_AUDIT and
/tmp/spooty-styles-{red,contrast-red,verified,ux,dom-final,typecheck,build-verified}.log.
Baseline: /tmp/spooty-navigation-build-final.log. The real4200 bundle/CSS serves
the changes;841 playlists/23,289 checked occurrences, zero scan errors.

No Chrome connection/restart, Spotify submission, download or media change.
Queues empty/unpaused, owner available, preparation idle;19,056/19,729 source
tracks saved,172.274658487GB,19 actionable not queued, no current rate/ETA.
Full UX goal active: live Spotify, cross-tab, responsive/theme/keyboard and
audible playback acceptance remain unverified. No authorization to restart
Codex40383 or reconnect the singleton was inferred. Remaining initial-bundle
analysis must not hide or postpone the saved-library UI just to clear a warning.

## Latest — 15 September, 18:16 Bangkok: sync visibility and navigation fixed

The intervening CDP recheck made no UX progress and left the same unrelated
stale-parent restart requirement unresolved. This continuation resumed the six
failing navigation regressions rather than repeating browser diagnostics. It
does not authorize Chrome access or stopping/restarting Codex40383.

Whole-library sync remains outside the collapsed narrow-screen chooser. Tools,
filters/list and empty text collapse together; the chooser has a bounded scroll
pane. Up/Down from the filter reaches matching results; arrows/Home/End preview
without closing or syncing, Enter opens/focuses the heading, Escape returns to
the chooser control, and Space cannot select a hidden row. Post-render focus
honors rapid changes/teardown; scrolling uses the clipped viewport.

259 DOM/service tests,81 UX/process tests, frontend typecheck and production
build pass;13 new navigation cases. Actual4200 serves the new bundle and841
playlists/23,289 checked occurrences. See WEBSITE_AUDIT and the
/tmp/spooty-navigation-{red,dom-verified,typecheck-final,ux,build-final}.log files.
Existing build warnings remain. Real browser/layout/Spotify/multi-tab/audible
playback acceptance remains pending; no Chrome or live metadata/media mutation.
Queues empty/unpaused, no owner/preparation.19,056/19,729 sources saved,
172.274658487GB;19 actionable not queued, no current download rate or ETA.
Full goal active; safe follow-ups include stylesheet/build-quality cleanup.

## Latest — 15 September: historical review/source identity compatibility fixed

Previous goal turn was progress: retained-playlist explanations and durable
library observations. This iteration addressed the remaining review-key audit,
without browser access or restarting another agent. It is an evidence/pipeline
fix, not a new dashboard warning panel or a new full-library duration audit.

Four consumers still compared old artist/title review keys directly against new
Spotify keys: source-inspection selection, historical audit snapshots, benchmark
review reports and replacement bookkeeping. Shared SourceReviewIndex now uses
explicit catalog/reference/audit Spotify IDs, retains historical keys/latest
records, and refuses conflicting exact-source identity. New source callers do
not inherit unbound name-only reviews. Group replacement evidence is separate;
one replacement cannot clear the group's review or certify recording identity.
Explicit inspection status reports mapped/unavailable sources, unbound reviews
and ledger errors. Ordinary startup does not schedule historical inspection.

Read-only real ledger audit:2,347 entries,328 unresolved historical entries;
old new-source direct-key matching found0, explicit identity maps321 entries to
321 current sources,7 remain unbound. These are not new failed MP3 findings.
No live review/MP3/journal state was changed or inspection/repair work queued.

Verified212 acquisition tests,429 backend/51 suites,246 rendered DOM/service
tests, backend typecheck; two replacement tests first failed on the old lookup.
Logs /tmp/spooty-review-identity-{red,acquire-final,backend,dom,typecheck}.log.
Live4200 returns841 playlists and23,289 checked occurrences with zero errors.
Offline plan unchanged:19,056/19,729 saved,172.274658487GB/18,537 MP3 inodes;
19 actionable not queued,65 missing,564 candidate-exhausted,25 exhausted errors.
Both queues empty/unpaused, no preparation/owner; no current rate or ETA.
Full UX goal remains active. Live Chrome/Spotify edits, multi-tab, responsive
layout and audible playback still require authorized browser verification.

## Latest — 15 September: explain playlists retained after library sync

The preceding turn made progress by confirming/containing another stale Codex
browser-tool recurrence. This continuation returned to safe UX implementation;
it did not authorize restarting Codex40383 or connecting Chrome.

Focused playlists now show a neutral Kept locally note with the last complete
library-check date when Spotify did not return them. A later complete discovery
can remove that note. Failed/partial discoveries, focused sync and saved-playlist
bulk sync preserve the prior observation. A successful empty-library receipt
explains that saved playlists and MP3s were kept. No deletion or implicit download.

The private sync-state file stores the validated complete ID observation across
restarts. API playlist responses project presence at read time; no unchanged
dump rewrites, audio rescans or extra ID lists in sync-status polling. The
existing app notification refreshes open dashboards. Missing legacy evidence
stays unknown, never inferred absent. Failed durable writes do not publish it.

Verified429 backend tests/51 suites,246 rendered DOM/service tests,81 UX/process
tests, both typechecks and frontend production build. New red-before-fix tests
cover absent/present/unknown states, invalid dates, preservation and restart.
A real isolated Nest HTTP/socket fixture uses the real discovery collector with
a complete empty response, verifies the notification, same scan, preserved
metadata/MP3 inode and no download/Chrome mutation. This is not Chrome/Spotify
integration or audible playback acceptance. Existing Sass/bundle warnings remain.
Logs: /tmp/spooty-library-presence-{backend-final,dom,ux,build,fe-typecheck,
be-typecheck,http,sync}.log; offline counts in the matching plan.json.

Live4200 serves the new note/receipt text; API view returns841 playlists and a
complete23,289-occurrence scan, zero errors. None has a complete library-presence
observation yet; no real Spotify check or invented baseline was used. Backend
38503/3000 and frontend97682/4200 serve normally. Both queues empty/unpaused,
no preparation or CLI owner.19,056/19,729 source tracks saved:18,760 duration-
matched,296 unverified;172.274658487GB/18,537 MP3 inodes.19 actionable sources are
not queued;65 missing,564 candidate-exhausted,25 exhausted errors stay parked.
No current output rate or completion ETA. Full UX goal remains active: live
Chrome/Spotify, responsive, multi-tab and audible playback acceptance are still
required. Continue safe remaining work; do not infer Chrome/restart permission.

## Latest — 15 September: clearer playlist header and truthful sync freshness

The previous goal turn made progress by reproducing/fixing the Redis-recovery
shutdown wait. This turn returned to user-facing Spotify/playlist clarity.
No Chrome connection, other-agent restart, sync submission or download was made.

Removed the duplicate completion title badges and obsolete already-hidden
completion banners/styles. The single saved-progress summary retains counts,
completion and review/queue reasons; it never claims local copies were newly
downloaded. Header timestamps now say Saved locally for legacy/unverified lists,
Checked with Spotify only for complete membership evidence. Invalid/missing
dates are handled without Angular DatePipe throwing. Owner tooltip acknowledges
saved metadata, the Spotify link says Open in Spotify, and selected downloads
state playlist units. Chrome-approval help no longer claims sync is running.

Six new rendered regressions failed before implementation. All241 DOM/service
tests and30 sync-flow tests pass, with frontend typecheck and production build.
Existing Sass and initial/component size-budget warnings remain. The actual4200
main.js contains the new labels and no old Tracks synced/All tracks downloaded
claims. HTTP view has841 playlists/23,289 checked occurrences, zero check errors.
All841 current saved lists lack the new complete-membership baseline; no valid
baseline or timestamp was invented. There are no invalid dates in current data;
that crash case is covered by a fixture. Browser layout/audio acceptance is NOT
claimed. Logs `/tmp/spooty-header-{red,dom-final,sync-final,typecheck-final,
build-final,plan}.log`.

Read-only plan unchanged:19,056/19,729 source tracks saved,172.274658487GB across
18,537 MP3 inodes.19 actionable tracks are not queued;65 missing,564 no-candidate,
25 exhausted errors stay parked. Queues empty/unpaused, ownership available;
no current download throughput or ETA. Full UX goal remains active, including
real-browser Spotify sync/membership edits/removals, cross-tab, responsive and
audible-playback acceptance. Do not reconnect Chrome or restart heimdall-mr
Codex40383 from a goal continuation. Other safe follow-ups remain in WEBSITE_AUDIT.

## Latest — 15 September: reproduced Redis-recovery shutdown hang fixed

The preceding user turn rechecked the CDP incident, not website implementation.
This goal continuation resumed safe local work; it did NOT authorize restarting
the other Codex session or reconnecting Chrome. Those boundaries remain unchanged.

Reproduced the shutdown hang three times in an isolated real Nest/Redis fixture.
After Redis recovered, Bull's blocking client could be reconnecting again while
its main client still reported ready. Disconnecting the already-closed blocking
socket cancelled reconnection but did not settle its outstanding marker wait;
Bull's graceful close then waited indefinitely. The trace continued with idle
handlers, live worker loops and a stranded blocking command. This matches the
historical stuck shutdown phase; it does not prove every past hang had this cause.

AppModule now enables installed ioredis5.9.2's native blockingTimeout protection:
10s offline/indefinite fallback, finite command timeout plus500ms. No general
commandTimeout, job execution deadline, forced-active close or queue mutation
was added. Existing offline-idle cleanup remains unchanged. Read-only shutdown
diagnostics record only flags/counts and bounded owner-local files beside DB_PATH.

Verification:418 backend/51 suites,201 acquisition,235 rendered DOM/service,
77 UX/process tests pass; backend typecheck passes. Recovery cases cover empty
queues, preserved paused/delayed jobs and an in-flight handler held eleven seconds
after shutdown begins, beyond the10s fallback, then completed and committed.
Completed-batch idle shutdown, proxy/websocket/partial HTTP and durable request
receipts also pass. See `/tmp/spooty-shutdown-{backend-full,acquire,dom,ux-full,
recovery-fixed,typecheck,plan}.log`; pre-fix reproduction logs use the same prefix.

The existing watch reloaded normally from11517 to55072;3000/4200 APIs respond200.
The real saved library has841 playlists and a complete23,289-occurrence scan.
A local MP3 byte-range read returned206,1024bytes,audio/mpeg. These are HTTP and
isolated runtime checks, NOT real Chrome/Spotify/layout/audible-playback acceptance.

Read-only physical plan:19,056/19,729 source IDs saved (18,760 duration-matched,
296 unverified),172.274658487GB/18,537 MP3 inodes.19 actionable sources are NOT
queued;65 missing,564 candidate-exhausted,25 exhausted errors stay parked.
Queues empty/unpaused, ownership available; no current output rate or completion
ETA. No user MP3, metadata, queued job or pace setting was changed.

Full UX goal remains active. Next gaps: legacy quality-review source-key
compatibility, responsive/build-warning cleanup, and the outstanding real-browser,
Spotify membership/edit/removal, multi-tab and audible-playback acceptance.

## Latest — 15 September: incremental saved-file coverage verified; UX goal remains active

The previous goal turn was progress: recurring Chrome tools were contained and
the false-clean stale-parent preflight was fixed. This continuation returned to
local UX work, without further Chrome/proxy/process diagnostics. Codex40383 in
heimdall-mr still requires authorized restart/reload; do not treat the goal
continuation as that approval or request a Chrome connection.

Finished the prior incremental-file-watching WIP. Shared LocalMediaIndex updates
affected paths/aliases/hardlinks; LibraryCoverageScan creates targeted generations
while retaining other verified rows. File/source/workflow changes notify open
dashboards over the existing app socket. Quiet reads reuse the index; explicit
recheck uses `?refresh=1`. Workflow updates do not probe audio again. Stale
Completed rows can no longer invent saved counts or Play buttons. Current
activity has one targeted-check indicator and a truthful manual fallback when
watching fails or the watched directory inode is replaced. Watchers, callbacks
and pending scan preparation are guarded on disposal. User media was not changed.

Verified414 backend/50 suites,201 acquisition,235 DOM/service,73 UX/process,
35 simulated CDP/source tests; both typechecks and frontend production build
pass. Existing Sass/bundle warnings remain. Real isolated native file events
were tested through Nest gateway, Socket.IO and HTTP, including addition,
deletion and actual filenames. This is not real Chrome/layout/audio acceptance.
Logs `/tmp/spooty-incremental-{backend-final,acquire,dom,ux,cdp,fe-build,plan}.log`.

Live coverage reused the same complete23,289-track scan on four reads of9–13ms,
with zero idle socket events over15s.4200 proxy APIs return200.841 playlists,
20,231 occurrences local and22,514 locally available. Physical source plan:
19,056/19,729 saved (18,760 duration-matched,296 unverified),172.274658487GB and
18,537 MP3 inodes;19 actionable sources are NOT queued;65 missing,564 candidate
exhausted,25 exhausted operational errors remain parked. Both web queues are
empty/unpaused and ownership available. No current output rate or completion
ETA. Do not quote the plan's hypothetical3/min ETA as actual running progress.

Recovery: existing Nest watch hit the known intermittent healthy-Redis shutdown
hang, leaving PID50253 non-serving with zero jobs in either queue. After exact
identity/empty-queue rechecks only that stalled child received KILL; parent45891
restored service83097. Subsequent source reload completed normally to86423,
verified on3000/4200. The hang is NOT fixed; preserve active work if it recurs.

Remaining work: real-browser/Spotify/multi-tab/playback acceptance, trusted real
membership baselines, legacy review-ledger source-key compatibility, the healthy-
Redis shutdown root cause, and responsive/build-warning cleanup. Continue safe
local work; leave the full goal active. See WEBSITE_AUDIT for detailed evidence.

## Latest — 15 September, 17:10 Bangkok: recurring Chrome tools contained, stale parent remains

Newest user request is repeated Chrome CDP prompts; pause unrelated UX work.
During this check the same stale Codex40383 (heimdall-mr; started14September
12:46:17 Bangkok) launched auto-connect Chrome20746/20876 and browser-enabled
REPLs20741/20851. Exact ownership was checked; only those four tool processes
received TERM. The parent, Chrome, proxy and downloads were preserved.
No real browser connection was requested. Parent restart/reload remains open
and requires authority to interrupt that other session.

Added a durable private stale-parent incident record plus a seventh preflight
check matching PID and UTC start time, so a between-launch clean child snapshot
cannot again be called fixed. This is diagnostic only, not process enforcement.
All35 simulated/source regressions passed. Saved settings passed; live check
correctly failed for the newly recurring tools and the known stale parent.
See scripts/CDP.md. Do not clear the incident just to make tests green.

Unfinished incremental library-file watching from the interrupted UX work is
still WIP in the dirty tree. Do not call it complete: initial backend tests
passed, but its DOM suite had one explicit-refresh expectation failure and new
incremental/watch coverage still needs completion. Preserve those changes.

## Latest — 15 September, 16:57 Bangkok: safe publication and actual filename completion

Previous goal turn made containment progress: an older heimdall-mr Codex40383
relaunched forbidden auto-connect/browser tools; only its tool children were
terminated. That parent still needs authorized restart/reload. Do not repeat
browser diagnostics or request CDP to continue local UX work. See scripts/CDP.md
and global AGENTS; the last user has not authorized restarting that other agent.

This turn fixed a demonstrated shared publication correctness defect. Three
new regressions failed before implementation because occupied unrelated files
were silently accepted as saved. Shared `materializeForTrack` and
`publishMp3ForTrack` now recover at source-specific versioned filenames and
return actual paths. Strict legacy helpers throw on unrelated occupied files.
CLI uses returned paths; web worker/checkpoint/library preparation persist the
actual audioFilename. The download adapter duration-checks late existing files
before fast-skipping. Different legitimate encodings keep verified reuse; source
replacement, symlink/empty/directory occupants and temp-file ownership are guarded.
Cross-device copies stage privately before final link. No deletion or rename of
existing media; no extra network search needed for a destination collision.

399 backend/49 suites,199 acquisition,222 rendered DOM and73 UX/process tests
pass; both typechecks pass. Tests include real temporary MP3 ffprobe/tagging,
fresh CLI catalogs after collision, actual library playback path resolution,
worker persistence and batch per-destination results. Logs:
`/tmp/spooty-publication-{backend,acquire,dom,ux,cdp}.log`.
No actual browser/Spotify/YouTube interaction or production MP3 write was used.
Do not call DOM/HTTP assertions real browser or audible playback acceptance.

Read-only localhost4200 view:841 playlists in1.003s,23,289 checks finished in
6.241s with zero errors. Backend watch serves PID90645; no manual queue/process
restart. Queues unpaused/idle, owner available, no preparation, limits4/1/240.
Plan:19,056/19,729 source keys saved,18,760 duration-matched and296 unverified;
172.274658487GB across18,537 MP3 inodes.19 actionable items are not queued;
65 missing+564 candidate-exhausted+25 errors remain parked. No active rate/ETA.

Full UX goal stays active. Next safe work: event-driven coverage invalidation
or legacy explicit-review key compatibility. Healthy-Redis shutdown root cause,
real membership baseline and browser sync/playback/narrow-layout acceptance stay
open. Source-duration agreement is not exact recording proof. Source handoff
fingerprints tolerate ctime changes from our own hardlinks; this is not a defense
against deliberate timestamp manipulation. Filesystems without atomic link
publication fail closed, and were not live-tested this turn.

## Latest — 15 September, 16:41 Bangkok: browsable library during local file checks

The previous turn made authoritative source-identity progress. This turn fixed
the next local-first UX defect: cold ffprobe checks no longer hold the entire
playlist list off screen. `LibraryCoverageScan` owns one bounded four-record
background pass, exposes snapshots and prioritizes the focused playlist. The
shared `LocalMediaIndex` remains authoritative for file/length checks; old and
incremental detail projections share `viewTrack`, not separate matching policy.

New UI routes: GET `/api/library/view` begins/coalesces a check; the same route
with `?scan=ID` only observes it. GET `/api/library/view/detail/:id?scan=ID`
returns current track evidence and prioritizes the playlist. Old GET `/library`
still awaits complete evidence for non-UI consumers. Scan IDs are invalidated
by backend, download-root or saved-membership changes. Changed/malformed replies
cannot silently count unchecked media as complete. No download mutation repeats.

The UI renders playlist metadata immediately, then one Current activity progress
indicator. Unchecked tracks say Checking local file (Not checked on failed/lost
observation), never Pending/Missing/complete. Confirmed counts are explicitly
partial. Whole-library admission waits for the check; a fully checked focused
playlist remains eligible while others finish. Polls use the same ID, stop on
completion/disposal, and preserve the list on connection loss. Explicit local
recheck, stale-detail clearing, root/generation guards and concurrent-work
priority are tested. Chrome is never involved in these checks.

Real4200 HTTP:841 playlists returned in987ms; focused LTJ Bukem's EARTH Series
returned78 rows in123ms while checking;23,289 occurrences completed in5.307s on
the warm cache. Progress reads7–139ms; final20,231 onDisk/22,514 available
occurrences, zero unchecked playlists. Controlled cold-probe test uses the real
Nest HTTP routes and returns before the held probe completes (1.5s deadline).
New view also passes the23 known mismatch regression entries in18 playlists.
These are HTTP/DOM checks, not Chrome/layout/audible-playback acceptance.

382 backend tests/48 suites,222 Angular DOM,73 UX,197 acquisition and30 simulated
CDP tests pass. Backend/frontend typechecks and frontend build pass; existing
Sass/bundle/style warnings remain. Logs `/tmp/spooty-coverage-{backend,dom,ux,
acquire,cdp,build}.log`. Live backend51258 is serving; no manual backend/queue
restart was needed this turn. Concurrent view reads also coalesce across a
download-root change during initial preparation (regression included). Watch
reloads occurred normally. No media or queue
mutation, Spotify sync or Chrome connection was requested.

Physical plan unchanged:19,056/19,729 Spotify source IDs have files (18,760
duration-matched,296 unverified);18,537 unique MP3 inodes,172.274658487GB.
19 actionable sources are NOT queued;65 missing,564 no-candidate,25 errors
remain parked. Web queues idle/unpaused, owner available, no preparation, no
active throughput or completion ETA. CDP remains deliberately disconnected.

Next substantial gaps: event-driven filesystem/database index invalidation
(this pass makes scan observations incremental, not all underlying indexing),
publication/copy races, legacy explicit review-key compatibility, healthy-Redis
shutdown hang, and real-browser/Spotify acceptance when explicitly authorized.
Full UX goal remains active. Do not resume downloads or reconnect Chrome merely
to exercise the next change. Do not mistake a completed scan for a continuously
fresh filesystem snapshot; playback still independently resolves the file.

## Latest — 15 September, 16:24 Bangkok: shared identity repair implemented; Chrome stays disconnected

CLI, web acquisition, library coverage and HTTP playback now use Spotify source
identity separately from filename aliases. Shared `source-id.ts`, `identity.ts`
and `local-media.ts` retain every local candidate and compare exact-source
duration with fingerprint-cached ffprobe evidence. Wrong occupied destinations
are preserved; new versions receive source-ID filenames. Same-source playlist
occurrences remain visible and deduplicate acquisition. Legacy terminal outcomes
stay parked, but cached URLs/live errors cannot cross known Spotify identities.
Unknown historical source duration remains explicitly unverified and cannot
authorize cross-playlist copying. Read scripts/acquire/README.md for semantics.

The old audit's23 false coverage entries in18 playlists were rechecked through
the real4200 API: all23 now onDisk=false,available=false,mediaVerification=mismatch.
Frontend labels them Needs matching version; stale Completed websocket rows
cannot restore their Play button/saved count. No media deletions, moves, copies,
YouTube/Spotify/Chrome requests or queue admissions were made by this repair.
The private derived cache is `data/media-duration-cache` (ignored by Git).

New plan denominator is19,729 Spotify source IDs, NOT18,977 filename keys or
distinct recordings:19,056 have local media, comprising18,760 duration-matched
and296 unverified sources.65 missing,564 no-candidate,25 exhausted errors,
19 actionable (14 cached URLs +5 pending), not queued.18,537 physical MP3 inodes,
172.274658487GB unchanged. No active rate or completion ETA. The plan's baseline
projection is hypothetical, not a running download estimate.

Verification: backend371/47 suites, acquisition197, UX73, Angular DOM213,
CDP30, local Codex configuration/runtime6 passed. Backend typecheck and frontend
production build passed (existing Sass/style/bundle warnings). Logs are
`/tmp/spooty-source-identity-{backend,acquire,ux,dom,build,cdp,resume}.log`.
New identity cases use real ffmpeg/ffprobe and isolated SQLite/media fixtures.
DOM/HTTP checks are NOT real-browser or audible-playback acceptance.

Live backend reload exposed the unresolved healthy-Redis shutdown hang: old
PID15237 stopped serving3000 and waited >800 seconds with both workers closing,
handlers idle, main loops running; Redis clients were idle ordinary commands,
not blocked list reads. Both queues had0 wait/active/paused/delayed jobs. Only
that exact non-serving child was killed after rechecking queue/process ownership;
Nest parent45891 restarted backend67348.3000/4200 settings API restored, nullable
audioFilename column verified. Recovery is NOT a root-cause fix for shutdown.

Repeated CDP complaint rechecked without browser tools: singleton14004 remains
disconnected/not connecting, Chrome1337 listens64165 with no client. All6 saved
and live Codex checks pass. Passive watcher89653 finished normally at16:20:41
Bangkok:12,826 samples,0 client samples. It is NOT still running; none duplicated.
This does not attribute the user's latest prompts or prove none remain. Never
reconnect or invoke stale browser tools; future-session controls remain in place.

Remaining: cold media-cache population took120 seconds for the raw library;
make coverage incremental/nonblocking. Inspect publication races, legacy explicit
review-ledger key compatibility, and the healthy-Redis shutdown hang. Duration
does not prove exact performance identity. Real-browser Spotify/library/download/
playback acceptance remains open while CDP is disconnected. Full UX goal active.

## Latest — 15 September, 15:54 Bangkok: real identity audit proves incorrect coverage

This goal turn made evidence/tooling progress, not the shared-identity repair.
Read scripts/ux/track-identity-audit.mjs and the top WEBSITE_AUDIT section.
Owner-only Git-ignored report: data/acquire/track-identity-audit-20260915.json.
841 playlists,23,289 occurrences,18,977 legacy filename keys,19,729 Spotify IDs.
637 filename groups have multiple IDs;378 have >=2 validated cached durations;
16 groups have disjoint shared-policy duration windows, covering56 occurrences.
Different IDs alone do not establish different recordings; unknowns stay unknown.

19 unique physical MP3 inodes probed. Among those56 entries:16 local match,
7 local mismatch,13 compatible elsewhere,16 incompatible elsewhere,4 no file.
Live GET detail comparison covered23 suspect entries in18 playlists, all rows
matched: API falsely reports all7 mismatches onDisk and all16 incompatible
alternatives available. No Chrome/Spotify/YouTube request or queue/media write.
The seven wrong local destinations are in:2024; Stick-Up Radio; Jeff Beck -
Star Cycle(two); Faithless - Insomnia - The Best Of; LTJ Bukem Presents Earth
1-7; Shook. The JSON has exact source IDs, expected/actual durations and paths.
Do NOT delete them wholesale: the same recording may be valid for another ID.
This is a targeted ambiguity audit, not a full-library bad-audio count.
Scope recheck: optional Desktop/2024 scan root is absent, no relevant MP3
symlinks were omitted, and all16 incompatible alternatives have API onDisk=false
(not another local format/path). Final test:ux rerun passed73/73.

Audit reuses shared normalization, metadata validation and duration policy;
retains multiple file candidates; skips staging; probes hardlinks once.6 new
tests cover false positives/unknowns, same-playlist variants, reuse, staging,
hardlinks and file preservation. test:ux passed73; latest six audit tests and
help command passed.6 Codex runtime/config checks pass. Diff check passes.
Logs: /tmp/spooty-track-identity-{ux,unit,cdp-config}.log. One report read raced
generation and failed before any API request; rerun after completion succeeded.

Next MUST implement shared source-identity/coverage repair, not more audit-only
turns or cosmetic labels. Code evidence:
- LibraryService.indexAudioFiles stores one path per basename; jobByKey merges
  different source IDs and prefers Completed; list/detail trust file existence.
- downloadPlaylists matches prior rows/destinations by file key and does not
  verify alreadyHere audio; copy verification only runs for !alreadyHere.
- CLI catalog groups spotifyIds and destinations by songKey; cached duration
  resolution can choose the first ID. Same-name different versions in one
  playlist cannot both have distinct destinations under this scheme.
- Frontend trackKey uses artist/name; LibraryTrack omits Spotify identity, though
  live Track already has spotifyUrl. Thus live state can cross source IDs too.

Use stable Spotify source keys separate from legacy file aliases, explicit
occurrence projection, source-specific job/outcome lookup, and multiple media
candidates with cached fingerprinted duration evidence. Reuse the same core
in web/CLI; no manual audit in the happy path. Keep old files and legitimate
reuse; migrate/default-skip old journals deliberately, never reopen accepted
parked outcomes or mass re-download as a side effect. Existing spotifyUrl on
TrackEntity may support the first identity change without a schema migration.
Do not substitute a blocking-only safeguard for a working version-aware flow.

Live queues idle/unpaused, owner available, no preparation. Legacy plan remains
18,333/18,977 file-key matches,172.274658487GB,644 parked/no active ETA; explicitly
qualify these as old name-key counts, not proof of recording coverage. Backend
15237 unchanged. CDP14004 disconnected; watcher89653 remains bounded until16:20,
9879 samples/0 clients through15:53:04. Do not duplicate/reconnect or invoke stale
browser runtimes. Full UX goal active; browser/Spotify acceptance remains open.

## Latest — 15 September, 15:42 Bangkok: advanced limits action finished

The old retained-profile button is now **Restore tested download limits**,
accurately describing concurrency/admission changes only. Eligibility, visible
help and handler agree with paused/drained queues, owner, preparation, cooldown
and safety-floor constraints. Paused backlogs remain eligible; selected limits
are text, not a disabled status button. Current activity reports progress,
rejection and acknowledgement.20-second timeout, invalid/empty-reply handling,
fresh read-only reconciliation and disposal cleanup are tested. No automatic
POST replay. Old status replies cannot overwrite acknowledged values or newer
user-action receipts. Pace-only POST results preserve queue/owner telemetry.

210 rendered Angular DOM tests (29 new),67 UX/real-process tests,12 targeted
backend ownership/preset tests,6 live Codex configuration/runtime checks pass.
Frontend typecheck/build and diff check pass; existing Sass/bundle/style budget
warnings remain. Logs: /tmp/spooty-download-limits-{dom,ux,backend,build}.log.
No backend code/settings change, queue mutation, MP3 action or Chrome request.
Live4200 library200/841 and pace200:4/1/240 unchanged, idle/unpaused queues,
owner available, no preparation. Backend15237 and singleton14004 unchanged.
Existing watcher89653 had8600 samples/0 client samples through15:41:01; it
remains bounded until~16:20. Do not duplicate it or reopen old browser runtimes.

Physical plan:18,333/18,977 saved,172.274658487GB,644 parked, zero actionable
songs/no active completion ETA. Browser/Spotify/playback acceptance remains
unverified; the full UX goal is active, not complete or blocked.

Next substantial safe work: inspect/reproduce the normative stable-track-
identity gap before migration. LibraryService indexes physical files by lower-
cased basename (indexAudioFiles) and merges jobs/dump tracks through
UtilsService.trackFileKey(artist,name). Distinct Spotify IDs/recordings and
playlist occurrences need explicit treatment; do a read-only real-catalog
collision audit plus isolated regression before changing identity/storage.
Preserve valid cross-playlist reuse, existing MP3s, parked outcomes and jobs;
do not silently relabel/re-download the whole catalog. Incremental coverage,
legacy membership baselines, the unproven healthy-Redis shutdown hang and live
browser usability checks also remain, as documented in the canonical contract.

## Latest — 15 September, 15:33 Bangkok: stale browser runtimes removed

User again reported CDP permission prompts; this takes priority over the next
advanced-profile UX task (not implemented). Saved settings and direct-MCP
checks passed but16 old generic/unified Codex REPLs still loaded a trusted
browser service. Exact identities were checked, then only those tool runtimes
were terminated; their child workers also exited. Parent agents33663/40383/
69403, Chrome1337, singleton14004, backend15237 and watcher89653 remain alive.
No browser requests, approvals, queue/media changes or backend restart.
This removes a confirmed bypass risk, not proof of the source of every prompt.

Added live REPL-environment inspection to test:cdp-config (now6 checks), plus
5 privacy/ownership/failure regressions (test:cdp now30). Both pass; diff check
passes. Global/repo instructions and scripts/CDP.md record the expanded
preflight. Do not print process environments or relaunch stale browser tools.
Singleton remains disconnected/not connecting. Existing passive watch remains
bounded until~16:20 Bangkok; no duplicate. Native app control remains configured
for fresh sessions; closing old tool runtimes cleared their in-memory state.

Read-only physical plan remains18,333/18,977 saved,172.274658487GB,644 parked,
zero actionable songs/no completion ETA. UX goal remains active and unchanged;
resume the advanced-profile action task below without applying live settings.

## Latest — 15 September, 15:27 Bangkok: focused action gates and shutdown evidence

Fixed enabled-looking focused buttons whose handlers rejected preparation.
All three focused acquisition controls now use one blocked-reason rule for
disabled state, handler, tooltip and visible/accessibility help. Restored
preparation also gets correct folder guidance. Eight DOM cases prove blocked
states and automatic re-enabling; existing paused/queued retry cases still pass.

Healthy-Redis shutdown hang NOT reproduced/fixed: three new isolated cases
cover dev-proxy polling/upgrades, aborted observations and partial HTTP bodies.
Added observational shutdown trace (fixed resource names/booleans only): starts
before application shutdown, reports waits after5s then every30s, never kills
work or contacts Redis/Chrome, stops at the application shutdown hook. Unit
tests and the real held-job test verify privacy/cleanup and that it stays live
during Bull drain. If the hang recurs, inspect these narrow phase messages;
do not dump old CDP logs or force-restart a live queue.

366 backend/47 suites,181 DOM,67 UX/process,25 CDP and5 local config checks pass;
both typechecks/frontend build pass with existing warnings. No acquisition
implementation change (186 acquisition tests passed previous iteration).
Backend15237 after normal source-watch reload, no manual signals. Library841
and pace return200; idle/unpaused, owner available, no preparation. Downloads
remain18,333/18,977,172.274658487GB,644 parked/no actionable completion ETA.
Chrome singleton14004 remains disconnected, existing bounded watcher89653
still owns the passive trace through~16:20 Bangkok. Do not duplicate/reconnect.

Next safe UX work: advanced retained-profile control currently omits the
backend's paused/drained gate and writes results only to the old message field.
Align button eligibility and clear Current activity feedback/observation without
applying the profile to the live installation, resuming jobs or bypassing safety.
Full browser/Spotify/playback and broader identity/coverage work remain open;
keep the original goal active, not complete or blocked.

## Latest — 15 September, 15:18 Bangkok: durable download receipt recovery verified

Finished the receipt WIP noted below. Optional UUID header, saved admission
and exact completed counts now survive backend restart; same-ID reuse never
replays preparation. GET status distinguishes preparing/completed/interrupted/
failed without invented partial counts. Frontend session marker and read-only
Check submission recover lost replies/reloads. Quiet sync preserves recent
receipts, and nested recovery refreshes no longer leave Loading stuck. Explicit
new requests preserve unrelated selections/errors; old replies cannot replace
new results. See README/WEBSITE_AUDIT for contract and boundaries.

Four real isolated HTTP/SQLite/Redis restart cases pass, including retained
partial queue work on interruption/failure and changed-library old-ID safety.
Full suite:363 backend/46 suites,173 Angular DOM,64 UX/process,186 acquisition,
25 CDP and5 local config/runtime checks pass; both typechecks and frontend
build pass (existing warnings). No live Chrome/Spotify calls, media/queue
mutations or manual backend signals. Watch reloaded normally to93795. Through
4200: library841/detail78 HTTP200, audio206/1024bytes, unknown receipt404;
queues idle/unpaused, owner available, no preparation running.
18,333/18,977 saved,172.274658487GB,644 parked; no actionable download ETA.

Goal remains active. Next safe high-impact work includes reproducing the
separately observed healthy-Redis shutdown hang (not fixed by the idle-outage
repair), then remaining identity/coverage/UX acceptance work. Browser layout,
real playback and live Spotify acceptance remain unverified; never reconnect
Chrome or launch an alternate browser. Singleton14004 stays disconnected.
Existing watcher89653 remains bounded until~16:20 Bangkok;6023 samples/no client
samples through15:16:55. Do not duplicate it or equate samples with no prompt.

## Latest — 15 September, 15:11 Bangkok: repeated CDP prompt recheck

The latest reported prompt is not attributed; do not claim permanent resolution.
Singleton14004 remains disconnected/not connecting; Chrome1337 still listens
on64165. Existing passive watcher89653 recorded5268 samples with zero clients
through15:09:53 Bangkok. No browser request, reconnect, permission approval,
proxy restart or duplicate watcher. Other agents' non-auto-connect Chrome MCPs
were not blamed or terminated.

Fixed a coverage gap in the live process check: direct Chrome MCP entry points
may appear only as Node executables. It now checks Node script arguments
privately, preserves Codex ancestry checks, rejects diagnostic-text false
positives and emits identities only.25 CDP regressions and5 live/config checks
pass; no current Codex-owned direct connector found. Global/repo rules now
require this preflight before browser work in future sessions. See scripts/CDP.md.

Read-only health checks also found backend49565 hung since14:59:27 during
shutdown despite healthy Redis. Logs said both handlers idle; Redis confirmed
zero active/waiting/delayed jobs and process inspection found no children.
Only this verified idle child was killed; Nest watch45891 remained and started
78620. Through4200, library841/HTTP200 and pace/HTTP200 recovered; both queues
idle/unpaused, owner available, no admission running. No queue/media mutations.
This is another shutdown path, not fixed by the earlier Redis-outage repair;
reproduce it safely in isolation before claiming general watch recovery.
18,333/18,977 saved,172.274658487GB,644 parked; no actionable download ETA.

The interrupted durable-download-receipt work is still WIP: new store, header,
status endpoint and frontend session marker are implemented; focused backend
52 tests/typecheck pass. Latest DOM run166 pass/1 fail: recovered-completed
submission on reload loses its visible receipt during initial library refresh.
Fix and verify before reporting completion; full backend/HTTP restart integration
coverage and docs for receipts remain outstanding. Preserve this work. The
ongoing UX goal remains active; Chrome QA must not bypass the disconnected bridge.

## Latest — 15 September, 14:56 Bangkok: idle Redis-outage shutdown fixed

Real isolated Nest tests reproduced shutdown hanging in BullExplorer after
HTTP disposal when Redis was offline. A new pre-shutdown service closes only
idle local workers/producer clients on that path. It observes actual handler
execution, rechecks races after local pause, and leaves active work/healthy
Redis on normal graceful shutdown. Durable queue pause flags, waiting/delayed
jobs, CLI ownership and media are untouched. See WEBSITE_AUDIT for limits;
this is not proof every older watch hang had that same cause.

10 process/socket lifecycle cases and6 unit cases added. Full verification:
351 backend/45 suites,60 UX/lifecycle,157 DOM,186 acquisition,21 CDP and5 local
CDP configuration/runtime checks pass; backend typecheck passes. Read-only
localhost through4200: library/detail200, range audio206/1024bytes. Nest watch
reloaded normally, no manual kill; latest backend49565. Queues idle/unpaused,
no CLI owner.18,333/18,977 saved,172.274658487GB,644 parked, no actionable ETA.

Chrome singleton14004 remains disconnected/not connecting; no Chrome requests
were made. Existing passive watcher89653 remains bounded to~16:20 Bangkok.
Next high-impact UX work: durable per-request download admission/receipts so
lost responses and backend restarts can recover exact submission outcomes,
then the outstanding contract/backlog and authorized real-browser verification.
Do not mark the full goal complete from these offline/HTTP checks.

## Latest — 15 September, 14:45 Bangkok: stale direct Chrome connectors stopped

User again reported CDP prompts. Three direct auto-connect Chrome MCPs were
found under existing Codex40383 in heimdall-mr despite disabled saved settings.
Only verified connector launchers/workers were stopped; all six are gone.
The parent agents, backend57049, singleton14004, queues and media were untouched.
No actual Chrome connection was requested. Prompt-to-process causation remains
unproven; do not claim the passive no-client trace proves no displayed prompt.

Added live Codex process ancestry to `npm run test:cdp-config` (5 checks pass),
plus four classifier tests in `npm run test:cdp` (21 pass). Global/repo rules
now require checking live stale connectors, not only saved configuration; see
scripts/CDP.md. The existing passive watch89653 remains active through roughly
16:20 Bangkok. Do not start another or reconnect Chrome. Read-only plan still
reports18,333/18,977 saved,172.274658487GB,644 parked,0actionable; no backfill ETA.
The isolated backend shutdown investigation and UX acceptance work below remain
unfinished; this prompt investigation took priority and did not restart backend.

## Latest — 15 September: observable playlist preparation and queue receipts

HTTP-side preparation now exposes actual playlist/track/phase and checked/total
through pace `webAdmission`, displayed in the same Current activity strip before
Bull has jobs. Server-side single-batch state wraps the existing LibraryService
loop; it does not schedule a second downloader or change queue/CLI policy.
UI/backend forbid download-folder changes during preparation. Late/lost HTTP
responses cannot make active server preparation vanish or permit another batch.

Visible receipts distinguish queued tracks, no-op results and actual local MP3
additions. `materialize` returns new destinations count; existing callers may
ignore it. Optional `reused` is a subset of compatibility `skipped`, subtracted
from the UI's unchanged count. New checkbox selections survive an older reply.
Queue/resume requests have120s/20s observation deadlines; unknown replies never
become false download failures or automatic repeated POSTs. Resume reconciles
from observed unpaused state.10s pace polls are non-overlapping/disposal-safe.

345 backend/44 suites,157 actual Angular DOM,186 acquisition,50 UX and17 CDP
tests pass, plus backend/frontend typechecks and frontend build (existing
warnings). See WEBSITE_AUDIT for evidence and limits. The empty-selection live
POST was safe and returned0queued/0skipped; library returns841. No real media,
metadata or queued work was changed. No Chrome connection was requested.

Nest watch's old child12707 hung after releasing3000, with zero queue work and
no children. After TERM failed, that verified idle PID was killed; watch started
57049 and the API recovered. **Next important investigation: reproduce/fix this
shutdown hang in isolation**, not repeated healthy-server restarts. Preparation
state is process-local; durable request-correlated receipts are also outstanding
for exact lost-reply recovery across restart. Do not claim full UX completion.
Saved18,333/18,977,172.274658487GB,644 parked and0active/actionable; no ETA.
The bounded CDP socket watch89653 remains running (see entry below); inspect its
existing log, never reconnect Chrome or launch another browser for QA.

## Latest — 15 September: saved-library/track recovery verified in rendered DOM

Completed the interrupted local-loading UX fixes and extended them to track
details. Errors now preserve cached content, name the failed local read in
Current activity, and offer scoped Retry saved library/tracks actions. They do
not trigger Spotify sync or acquisition. Empty/filter/Hide finished states have
distinct wording and direct recovery; active-descendant only names a visible
row. Both local read paths have30-second deadlines and cancel superseded or
disposed requests. Quiet reads cannot leave an older visible spinner stuck;
stale same-playlist track responses cannot replace current tracks.

`npm run test:dom` now passes140/140 actual Angular-template/component DOM cases,
including16 new recovery/race cases. The runner blocks browser fetch/XHR/socket
entry points and cleans its temporary generated directory on bootstrap failure.
It is JSDOM, NOT real browser/layout/audio/Spotify verification.50 UX tests,
17 CDP/source/watcher tests, frontend spec typecheck and production build pass
(existing Sass/size warnings). README and WEBSITE_AUDIT describe test boundaries.
No backend, queue, playlist metadata, MP3 or Chrome connection change was needed.

Next: continue the normative UX acceptance matrix and outstanding backlog;
live browser/Spotify verification still requires explicit single-connection
authorization. Do not call this goal complete or reconnect to make tests pass.
The passive Chrome-request trace below remains bounded and running; inspect
its log/PID instead of spawning another trace.

## Latest — 15 September, 14:21: recurring Chrome prompt attribution

User again reported Chrome CDP permission prompts. Do not call this permanently
resolved: the exact current requester remains unidentified. The existing
singleton PID14004 is unchanged, disconnected/not connecting, with no new
connection attempt since12:40 Bangkok. Effective Codex settings pass all4 checks:
direct connector and Chrome/Browser plugins disabled, generic REPL without a
browser service, unified CUA native-only. Older loaded browser tools must not
be invoked. No real Chrome request, valid Connect POST or browser QA was run.

Added passive `scripts/cdp-socket-watch.mjs`, documented in scripts/CDP.md.
It records only OS client socket/process identifiers; no protocol/session data.
All17 CDP/source/watcher tests pass. A bounded two-hour trace started at14:20:41
Bangkok, PID89653, log `/tmp/spooty-cdp-watch-YrQQug/events.jsonl`, watching
port64165 at500ms intervals. Check that log and PID before starting another
watch; it should end around16:20:41 Bangkok. Initial samples show no client.
Do not treat absence in sampled TCP records as proof a displayed prompt has
gone away. Other agents' MCP processes were inspected but not stopped.

The actual Angular component/template suite now runs browser-free in JSDOM:
`npm run test:dom` passes124/124, no skips. It does not verify pixels, layout,
audio playback or live Spotify. The interrupted saved-library load/error UX
work remains in progress and needs dedicated new cases; preserve it.
Read-only plan:18,333/18,977 songs saved,172.274658487GB unique-inode media;
644 parked outcomes,0 actionable. Web queues idle/unpaused,0 active/queued.
No MP3s, playlist metadata or jobs changed. No active download ETA.

## Latest — 15 September: complete discovery and automatic library refresh

The15-minute dashboard cycle now checks the whole Spotify library, not only
the focused playlist. Recent focused sync cannot hide newly followed playlists;
recent library checks are reused. Existing work, lost observations, quiet-failure
backoff and disposal guards are preserved. Known unavailable/connecting/
disconnected Chrome suppresses quiet metadata submissions. The first explicit
Sync click explains a known disconnection immediately and may open the existing
confirmation UI; it never requests Chrome access until explicitly confirmed.

Library discovery now validates complete paging before returning any rows to
the writer: items/total/offset/limit/terminal next, contiguous safe page URLs,
stable totals, unique valid IDs and row shape. Partial/malformed discovery is a
typed incomplete failure with saved-library wording, not an empty success.
Untitled playlists are retained; missing track counts remain unknown.

Tests exercise new-playlist discovery/hydration through the real backend
adapter/writer and durable failure after a malformed second page, with no
download/queue changes.341 backend tests/43 suites,50 browser-free UX tests,
14 CDP guard tests and4 effective-config checks pass; frontend spec typecheck
and production build pass (existing warnings). Read-only localhost checks still
show841 playlists and working partial audio delivery. All849 live metadata
files retain the prior aggregate hash. No live Spotify success or rendered
browser interaction was attempted; the proxy remains deliberately disconnected.
This is another progress iteration, not completion of the full UX goal.

## Latest — 15 September, 14:00: remaining Codex browser routes restricted

Repeat CDP-prompt investigation found a persistent configuration gap: disabling
the Chrome plugin/direct connector had left the Browser plugin, generic REPL
browser service and unified CUA browser surface enabled. Global config now
disables/removes those browser routes; unified CUA keeps native-app control
only. Global/repo instructions prohibit browser methods still exposed by older
already-open sessions. See scripts/CDP.md for upgrade/verification details.

`npm run test:cdp-config` passes4 effective-config/installed-launcher checks with
no browser or native service started; all14 existing CDP checks pass. The
singleton PID14004 was not restarted or connected. A90-second passive watch
ending14:00:27 Bangkok collected296 samples with zero debugging clients.
This does not identify the latest prompt's exact source or guarantee that an
unrelated application cannot request Chrome access. No other agent, backend,
queue, saved playlist or MP3 was changed. Full live browser QA remains pending.

## Latest — 15 September: trusted baselines and same-count edits

Normal library sync now requires complete saved membership plus a matching
available discovery snapshot before skipping tracks. An equal count is not
enough when revision evidence is absent or the cached membership is unverified.
Focused refresh clears its old snapshot ID; only a subsequent verified library
check establishes a new baseline. Unknown revisions continue to be checked.
An unverified fallback cannot certify a snapshot or count as a verified refresh;
the UI explains this without falsely claiming the older track list was kept.
Fully unchanged metadata no longer gets rewritten; owner/name/rank changes do.

Tests now exercise actual same-count reordering through the session discovery,
collector, adapter and writer with controlled API responses, checking ordered
row numbers, local audio resolution, untouched MP3 inode/content and no queue
mutations. The second unchanged sync fetches discovery only and leaves the
metadata file/inode untouched. This is not live Spotify/browser evidence.
All849 live dumps currently have no snapshot or completeness evidence; this is
legacy playlist-metadata state, NOT a new MP3 duration/correctness audit.
They were not resynced or changed in this iteration. See WEBSITE_AUDIT.md for
verification and the unchanged live-file hash.
302 backend tests,41 browser-free UX tests and14 CDP guard tests pass; frontend
spec typecheck/build pass. Live API remains available with idle/unpaused queues.
Saved18,333/18,977 songs,172.274658487GB;644 parked outcomes, no active ETA.
No Chrome connection was requested. Full rendered/live Spotify QA remains open.

## Latest — 15 September: unified sync lifecycle and cross-tab recovery

Library, focused and legacy saved-playlist bulk sync now use one durable
operation (`operationId`, scope, target, progress, typed failure, result).
`POST /api/library/sync/playlist/:id` acknowledges immediately; the historical
blocking resync endpoint joins the same operation or returns409 for another
scope. All entry points preserve the one-operation lane. State admission must
persist before work starts. Server restart restores an interruption, not a
permanent running flag.295 backend tests pass across42 suites.

The dashboard observes idle sync status every15seconds and follows active work
every2seconds without overlapping requests (10-second deadlines). It sees sync
started/completed in another tab and does not repeatedly refresh for the same
completion. Lost acknowledgements cannot turn old results into new success;
late reads cannot overwrite a newer action. Disposal guards prevent late
callbacks from restarting polling/submitting.40 browser-free UX tests pass,
including14 tests executing the actual component lifecycle in Node (not DOM or
browser tests). Frontend spec typecheck/build pass with existing warnings.

Backend PID69765 was already stopping, with no3000listener, zero active/queued
jobs and no yt-dlp/ffmpeg children. It was terminated; Nest watch replaced it
with PID71212, restoring the API at13:39 Bangkok. No queue/media mutation was
made. The precise remaining shutdown-hook hang still needs an isolated repro;
do not claim this operational recovery is a permanent shutdown fix.

Real4200-proxied focused sync acknowledged in119ms and finished with durable
`failureKind=connection`, keeping all849 metadata files byte-identical
(SHA256 in WEBSITE_AUDIT.md). Saved library returns841 playlists; EARTH Series
retains78tracks and local audio Range returns206/1024bytes. Physical plan:
18,333/18,977 songs,172.274658487GB unique-inode MP3s,644 parked outcomes,
zero actionable songs; no throughput/completion ETA. Chrome proxy PID14004 remains
disconnected and no permission request was issued.14 CDP guard tests pass.

Full goal remains active. Live rendered interaction/Spotify sync verification
is still unperformed pending explicit single-connection authorization; do not
launch another browser. See updated audit backlog for legacy baseline live
proof, identity/coverage work and playlist-unfollow semantics.

## Latest — 15 September: removal-safe sync and empty-state clarity

Spotify removals are now implemented, not merely rejected by a never-shrink
guard. See WEBSITE_AUDIT.md and `shared/spotify-membership.ts`. Shorter/empty
membership requires two matching, fully collected and hydrated API responses.
Unknown rows, inconsistent counts/confirmation, and hydration/HTTP failures keep
the prior metadata. MP3s and queued jobs are not mutated. The anonymous embed
branch has been removed from the playlist API adapter; verified empty is valid.
Stored evidence distinguishes supported songs from excluded episodes/locals;
missing discovery counts remain unknown. Verified empty baselines do not loop.

UI receipt says before→after tracks and explicitly keeps MP3s/queued work.
Empty state distinguishes unloaded, empty Spotify, and unsupported-only lists.
Focused sync exposes lost Chrome connection in Current activity and offers the
existing explicit connection action; no automatic permission request occurs.

288 backend tests,186 acquisition tests,18 browser-free UX tests,13 CDP/bypass tests passed; frontend
app/spec typechecks and production build pass with existing warnings. Real
collector→adapter→writer regression plus media/queue preservation covered.
Angular render/interaction cases added but NOT run. Live HTTP disconnected
EARTH Series sync returns503 clearly and preserves78 tracks and the exact849-file
metadata hash (see audit). No browser reconnect was made. Goal remains active:
focused/bulk sync durability, trusted legacy baselines, identity/coverage work,
and authorized real-browser/Spotify verification still remain.

## Latest — 15 September: close historical CDP bypasses

Repeated live socket checks showed one singleton HTTP process (PID14004),
disconnected/not connecting, and **zero Chrome debugging clients**. No new
connection was requested. Other running chrome-devtools-mcp processes belong
to unrelated Grok sessions and were not connected to main Chrome; they were
not killed. Do not claim these observations prove what is displaying in Chrome.

Removed all direct/isolated Chrome implementations from five unused historical
diagnostic helpers; those entry points now exit2 with supported alternatives.
The supported downloader and Spotify session paths do not invoke them. Added
an application-wide source boundary test plus a dependency-free GitHub workflow
to catch reintroduced direct CDP patterns. Workflow is local, not pushed/run on
GitHub yet. Codex direct MCP remains disabled and its launch command now fails
closed (`/usr/bin/false`, no auto-connect args), verified via `codex mcp get`.
Global and project instructions document this for future sessions.

Verification:13 CDP/bypass tests and15 backend connection tests passed; no real
Chrome request was made. `git diff --check` clean. Saved18,333/18,977 songs,
172.274658487GB unique-inode MP3s; web queues idle/unpaused with0 active/queued.
644 outcomes parked; no active throughput or completion ETA. Media and jobs
were not modified. Do not restart the CLI for parked outcomes.

The preceding connection-UX work is implemented: read-only connection status,
explicit two-step Connect Chrome action, one shared pending request, no retry
on approval failure/status loss, and no implicit sync/download after connection.
Targeted backend tests pass; Angular interaction tests remain typechecked only.
Completeness validation also rejects short/malformed/changing-count playlist
responses;13 targeted session/playlist tests passed and frontend build passed
with existing warnings. Genuine-removal reconciliation remains unfinished.
Continue safe UX work, but do not run browser QA or the valid connection POST
without the user's explicit single-connection authorization.

## Latest — 15 September: visible Spotify sync and durable status

Global **Sync Spotify library** is no longer hidden in Library tools; focused
action says **Sync this playlist**. Both explain metadata vs MP3 downloads.
First-run empty state has a Sync action. Progress/errors/results use Current
activity, not another sidebar banner. Polls are non-overlapping and bounded;
lost observations stop the sync animation and continue status checks without
another POST. A lost POST response is reconciled, not blindly resubmitted.

Sync progress/results persist beside DB_PATH in `spotify-library-sync.json`.
After restart, an unfinished operation becomes interrupted rather than running
forever. Concurrent resyncs of the same playlist share one backend request.
Metadata-only name/owner/order changes trigger a saved-view refresh too.

Verification:250 backend tests +11 browser-free UX tests passed; frontend
app/spec typechecks and production build pass (existing Sass/size warnings).
New Angular interaction tests are written/typechecked, but NOT executed because
Chrome remains deliberately disconnected. Do not call the UI fully verified or
the goal complete. Next: expose a clear Spotify connection prerequisite/recovery
flow, finish individual/bulk sync lifecycle and genuine-removal handling, then
run the full Angular/live-browser matrix only after an explicit single-connection
authorization. Do not open a direct MCP/WebSocket or a new browser as a workaround.

Actual backend disconnected sync returned a terminal `CDP proxy is down` in2ms
and persisted it. All849 metadata files remained byte-identical. Both web queues
are idle/unpaused, no cooldown/configuration error. Physical CLI plan:18,333/
18,977 songs saved,172.274658487GB;644 parked outcomes,0 actionable songs. There
is no active throughput/ETA and no reason to restart the CLI for these outcomes.

## Latest — 15 September: stop repeated Chrome permission prompts

All browser QA must use the singleton HTTP bridge, not direct Chrome MCP.
The direct connector was mistakenly used during QA. Separately, the old bridge
kept timed-out sockets alive; five connections were found. Fixed handshake
cleanup, concurrent connection sharing and stale event isolation; removed
automatic reconnects from startup/health/ordinary requests. Seven simulated
socket/HTTP regression tests pass. See `scripts/CDP.md` and `npm run test:cdp`.

The unhealthy bridge was replaced only after download and Spotify-sync idle
checks. Direct Codex Chrome connectors were stopped; socket inspection showed
zero Chrome debugging clients. The replacement is deliberately disconnected
and will not generate permission prompts. Live browser QA therefore needs a
single explicitly user-authorized reconnect; do not silently initiate one.
Global Codex configuration disables the direct MCP and Chrome plugin, and global
AGENTS.md plus a user-requested memory note preserve this for future sessions.
These changes do not pause download queues or remove files.

## Latest — 15 September: one live activity surface and resumed-web repairs

The user explicitly resumed all web queues, then requested a first-principles
usability redesign while AFK. **Do not restore the paused state described in
older entries.** Keep active jobs running. Backend source changes below were
applied between active jobs; no queues were cleared or media deleted.

The website now has one top activity strip, including exact worker track/stage,
indeterminate or measured progress, scheduled wake-up, pause/CLI ownership and
configuration problems. Spotify resync appears there too, with a completion
receipt. Activity details holds concurrent jobs, chronological recent results,
queue navigation and technical/historical benchmark data. Sidebar status stacks,
the disabled status button and bottom overlay are gone. One playlist saved bar;
short sidebar saved counts; Library tools and Search options collapse secondary
controls. Narrow screens use collapsible playlist navigation. See the normative
15 September information architecture in OPERATOR_DASHBOARD_PRINCIPLES.md.

Read-only `/api/youtube/pace` now includes `webActivity` (actual Bull membership,
in-process stage, session totals/recent events, next delayed timestamp) and
`configurationError`. `shared/web-activity.ts` is observation only; it does not
schedule downloads, alter limits, or count reused files as new downloads.

Live resume exposed three concrete web regressions:

- Blank `QUALITY=` was rejected instead of using documented quality 0.
- Old `YT_SEARCH_BATCH_SIZE=1` / `YT_DOWNLOAD_BATCH_SIZE=1` process variables
  prevented the retained shared profile from starting. The retained profile
  now owns its fixed batching; custom mode still validates legacy overrides.
- Transient `searchAlbum` metadata reached TypeORM UPDATE, which rejected it as
  a nonexistent column. The persistence boundary strips it while preserving
  in-flight search context.

After those fixes, searches and download attempts were observed in real Chrome.
Recovered 33 admissions affected by the configuration bug through the normal
track-retry API, excluding already active/waiting/delayed jobs; 3 other rows were
skipped by durable policy. No generic reopening of exhausted candidates. Some
historical cached sources are now being disqualified by duration and sent back
through candidate selection; this is not successful MP3 throughput.

Live verification: localhost library/filter/playlist navigation, explicit Spotify
resync (EARTH Series retained 78 tracks), playback advanced to 7.63 seconds with
readyState 4/no media error then was closed; activity followed real named searches
and downloads. The real UI operational-retry action was exercised; K Scope — The
Setup subsequently completed. Desktop, 1100px and 760px layout checks passed,
including narrow navigation and absence of document overflow. Final suites:
242 backend + 140 frontend + 186 CLI = **568 passing**; both typechecks and
frontend production build pass with the existing Sass/size warnings. Earlier
status counts are historical; use current API/CLI plan for throughput or ETA.

## Latest — 15 September: actionable UI and real queue membership

The screenshot's EARTH Series (Matt Payne, `7HgFkQvJvZsJZOxN9RypDH`) had
20 false Pending labels: their Bull search jobs already existed, some alongside
older historical jobs. New/Pending is now projected as Waiting only when actual
Bull membership exists; terminal journal outcomes are never reopened by reads.
No one-shot migration or live job deletion was used. Normal admission of a New
row checks existing jobs before changing its label, preserving selected URLs.
Truly unsubmitted New rows can now be admitted by the normal playlist action.

Removed the disabled status-summary button. A separate progress panel names
saved, not queued, queued/paused, processing, reusable and review-needed work.
Pending actions remain usable alongside waiting/running tracks. Global live
work no longer turns unrelated pending tracks into invented waiting work.
Zero-error counters disappear; saved tracks have no red diagnostic clutter.
The historical CLI benchmark is a compact secondary disclosure.

Paused work now has **Resume web downloads… → Resume all web queues**, with an
explicit confirmation that includes older batches, not just the focused list.
POST `/api/youtube/queues/resume` requires `scope: all-web-queues`; one Redis
operation checks ownership and invokes the installed Bull resume script for
both queues. It preserves jobs, markers, safety state and CLI ownership. The
live queues have NOT been resumed by this UI change.

Verification: 233 backend + 118 frontend + 186 CLI tests = **537 passing**;
typechecks and production frontend build pass. Existing Sass/size warnings
remain; work-state styles are a separate stylesheet within existing budgets.
Real Chrome: EARTH Series shows **54/78 saved, 24 queued — paused**; resume
confirmation opened and Keep paused worked; local playback advanced
1.62→13.04 seconds without media errors, then paused. Explicit Spotify resync
succeeded at 08:44:19 Bangkok and retained all 78 tracks. Real Bull workers in
isolated Redis resumed and completed preserved test jobs; owner conflicts and
rename-overwrite hazards failed closed. Missing resume scope returned HTTP400
against the live API without queue mutation. New admission and duplicate
prevention were exercised by frontend/backend tests, without starting a live
bulk download.

Physical catalog remains **18,330/18,977 saved, 172.146744669 GB**. Both live
queues remain paused/active0 with 13,629 search + 1,792 download jobs preserved
(job counts are not unique songs). No active throughput or ETA while paused;
shared CLI plan has 22 actionable unique songs (2 ready, 20 pending) plus625
parked exceptions. Web queue membership and CLI journal pending are different
concepts; do not relabel those journal states or create duplicate jobs.

## Latest — 15 September: retry controls and truthful paused-queue labels

The user explicitly directs agents to fix reported bugs, not stop at diagnosis.
Playlist retry controls no longer disappear because other tracks are waiting,
scheduled or running; CLI ownership and enqueue/validation guards still apply.
`GET /api/youtube/pace` now includes read-only Bull pause/active telemetry for
both queues. The UI says **Work queue — paused**, distinguishes processing from
waiting playlists, identifies units, and does not invent queued membership for
unsubmitted dump leftovers while both queues are paused. Retry result messages
explicitly say paused admissions will not start until queues are resumed.

Real Chrome QA clicked **Retry 20 exhausted searches** on **LTJ Bukem Presents
Earth 1-7**, ID `04Mj5fSvHOHsO01sdTfDSd`. Result: **Queued 21 · 58 unchanged**.
The extra track was copyable Big Bud — Spiritual: existing audio 378.090542s
failed this occurrence's 300.5s Spotify duration, so it was not copied. Fifteen
valid existing tracks were locally materialized; own-folder coverage rose
41→56/79. No new MP3 audio was downloaded, moved or deleted. The Setup and The
Plan retain their selected URLs. The playlist now has **23 Waiting** tracks.

The click also exposed that accepted search jobs remained status New/Pending.
New admissions now persist Queued/Waiting before Bull can advance to Searching;
failed admission becomes a clear failed outcome, not false Waiting. The exact
21 pre-fix test admissions were reconciled to Waiting only after matching their
paused Bull jobs, playlist, ID, artist, title and old state under a maintenance
lease; no jobs were added/deleted by that repair. Its ignored one-shot artifact:
`data/acquire/audits/repair-paused-search-labels-20260915.mjs` (already applied;
do not rerun against changed state). Both queues remain paused/active0, with
13,629 search and 1,792 download jobs preserved. There is no active download ETA.

Verification: **227 backend + 115 frontend + 183 CLI tests = 525 passed**;
backend/frontend typechecks and frontend production build pass (existing Sass
and bundle/style warnings remain). Live API pause state matched Redis, the real
Retry button was enabled, its POST succeeded, and Refresh showed Waiting rows.
Physical catalog remains **18,330/18,977 saved, 172.146744669 GB** unique-inode
MP3 storage. No full-library queue resume or new throughput trial was performed.

## Latest — 15 September: automatic query fallback and per-candidate evidence

Following the independent EARTH Series audit, CLI and web now share
`shared/acquisition/search-discovery.ts`: up to three distinct queries (original,
cached album context, official audio), ten ranked results per query by default,
deduplicated video IDs, title phrase/artist/edition checks, and the unchanged
Spotify duration tolerance: ±5%, clamped to 5–20 seconds. No automatic acceptance
of longer album/12-inch editions. At most two credible candidates lacking a
duration get paced source inspection, after releasing the search slot. Search
exhaustion and operational/network failure remain separate outcomes.

Latest per-track evidence is stored atomically under ignored
`data/acquire/search-diagnostics/` (mode 0600) and available through the read-only
`GET /api/track/search-evidence?artist=...&name=...` endpoint. The UI's **Search
evidence** disclosure shows queries, candidate links/durations, rejection reasons
and selected outcome. Older runs honestly show that detailed evidence was not
saved. Manual Refresh also reloads active track rows so CLI state changes do not
leave stale retry badges. Existing parked outcomes are not automatically reopened.

Live first-class CLI search-only validation `2026-09-15T00-57-31-454Z` completed
normally at **07:58:21 Bangkok**, in 49.36 seconds: **2/2 automatically found**.
The Setup selected `jAcDqjEo6Rw` on query 2 (album context, 251s vs 250.5s target);
The Plan selected `cPT6rELtVVU` on query 3 (official audio, 254s vs 254s). Both
match the independent browser audit; no URLs were manually injected. The first
queries returned unrelated rifle-scope/TV clips, rejected by the new checks.
20 and 28 unique candidates were recorded respectively. No network failures,
bot blocks or MP3 downloads occurred in the successful validation. An earlier
bounded validation caught a successful-process generic-error-field bug; it was
fixed and regression-tested before this successful run.

Only the two audit songs were passed to validation using the ignored two-track
input under `data/acquire/audits/earth-query-validation/`. Never use that input
as a Spotify resync snapshot. Shared journal now has their validated URLs ready;
the other 20 user-reopened EARTH searches remain pending. Physical full-catalog
plan: **18,330/18,977 saved, 172.146744669 GB**, 22 actionable (2 ready + 20 pending),
625 parked. Both Bull queues stay paused/active0, so no active download ETA.
No existing audio was moved, deleted or replaced. This is a discovery validation,
not a new MP3 throughput benchmark; the earlier 9.44/min figure predates this policy.

Verification: **183 CLI + 220 backend + 112 frontend tests = 515 passed**;
backend typecheck and frontend production build pass. Existing Sass and bundle/
style budget warnings remain. Real Chrome QA showed both durable result reports,
selected links, correct tolerances and no horizontal overflow. Local playback
advanced 6.35→16.34s in a 255.5s MP3 with no media error, then paused.
Explicit Unplugged resync completed successfully and retained all three tracks.
Normal Download was inspected on the 17-saved/one-parked Deluxe playlist; its
bulk control was disabled while existing queued work was preserved. No retry
button was clicked and no queue was resumed to bypass that guard. Shared web
download/publication behavior remains covered by the automated integration tests.

## Latest — 15 September: moved media and persistent download-folder setting

The user moved downloaded media to `/Users/dom/Desktop/mp3_downloads`. The
website's sidebar now provides **Download folder → Save & rescan**; its setting
was saved through the real UI and survives backend/browser reloads. Persistence
is ignored mode-0600 `data/settings.json` beside `DB_PATH`; the shared resolver
uses saved `downloadsPath` ahead of the `DOWNLOADS_PATH` environment fallback.
New CLI runs/plans use the same setting. No files were moved or deleted by this
change, and no queue was resumed. Invalid/nonexistent folders are rejected;
an exclusive maintenance lease blocks changes during CLI ownership or runnable
web work while preserving paused backlog.

Live physical CLI plan: **18,330/18,977 songs saved, 172.146744669 GB** unique-inode
MP3 bytes. All 647 accepted exceptions remain parked; `resume.actionable=0`, no
active/buffered acquisition ETA. The web counts playlist occurrences separately:
18,572/23,289 in their own folders and 22,537 available across the selected tree.
Surround Sound now reports 831/862 in its folder, with 23 other-folder reusable
tracks. Do not mistake missing duplicate playlist copies for lost unique audio.

The web now also displays playlist owner attribution from saved subtitles and
retains structured public owner metadata on future successful Spotify library
discovery. “Made for…” is personalization, not ownership/original-creator history.
See `WEBSITE_AUDIT.md` for verification and limitations of both changes.

## Latest — 14 September: completed guarded run and first-class CLI migration

The user accepts the remaining647 unavailable tracks; ordinary reruns should
fast-skip them, not repeat the historical all-error recovery command below.
Run `2026-09-13T08-07-31-213Z` finished normally at06:48:37 Bangkok on14 September.
PID95926 has exited and the Redis lease is absent. Last physical verification:
**18,330/18,977 saved,172.309734447GB** unique-inode MP3 storage. Remaining:
**556 no-candidate at depth10,66 Missing,25 exhausted source-duration errors**.
Default `plan.resume.actionable=0`; no automatic completion ETA exists for these
parked exceptions. Both Bull queues remain paused/active0 with their historical
jobs preserved. No media was deleted or newly downloaded during the migration.

Completed guarded throughput:8,881 new MP3s in941.07615 minutes,
**9.437/min,3.146× the3/min baseline**, zero genuine bot/rate-limit blocks.
Retained settings:4 download batches,1 search batch,240 admissions/ten minutes,
batch8,buffer192,max-searches10,network-retries5,autoStepfalse. This whole-run
rate supersedes the earlier unguarded21/min transition-window figure for
guarded-pipeline claims. It is not a new website throughput benchmark or full
recording-identity certification.

The latest user request promotes the CLI and website to equal entry points
using shared download logic. Start with `scripts/acquire/README.md`, not the
historical trial commands in ACQUIRE.md. Root scripts: `npm run acquire -- …`,
`npm run test:acquire`; package bin `spooty`; `.nvmrc` pins20.19.4. The historical
`scripts/acquire.mjs` entry remains supported. CLI parsing/help/options are
centralized; command-inapplicable/duplicate/invalid flags fail before changes.
`plan` and actual startup share resume decisions; live controls require a
verified owner and target its run ID; stopped/unverified status has no live ETA.

Common core: `src/backend/src/shared/acquisition/` (transport, candidate/duration
policy, source metadata, filename identity, publication/reuse). CLI wrappers
reexport the implementation; Nest's YoutubeService is its batching adapter.
Both adapters retain their scheduler/storage/UI responsibilities and share
`data/acquire/work.sqlite` and `duration-rejections.json` across ownership
handoffs. First-block termination/floor/cooldown remain mandatory.

Migration verification completed: 157 CLI tests, 182 backend tests across
32 suites, and 101 frontend browser tests pass (440 total); backend typecheck
and frontend production build pass. The frontend build retains bundle/style
budget warnings and the existing Sass import deprecation warning.
CLI integration uses isolated Redis/backend/state and exercises real entry
points, takeover/drain/handback, resume and live controls without YouTube.
The shared web adapter also passes real local ffprobe/ID3/atomic-publication
tests using a temporary MP3 and mocked YouTube process protocol.

Real Chrome QA at port4200 exercised library selection, local audio playback
(194.4-second MP3; playback advanced with no media error), Spotify resync
(Unplugged stayed3/3), and normal Download on the 18-track Technimatic Deluxe
playlist. Download reported `Queued 0 · 18 unchanged`; its17 saved tracks and
one depth10 no-candidate remained unchanged. Direct HTTP verification matched.
Both queues remained paused/active0 with download1792 and search13580 pending
jobs preserved. Background Spotify library discovery subsequently reported429;
saved-library browsing/download stayed usable. No new live YouTube acquisition
or post-consolidation throughput benchmark was attempted.

Final web polish: background discovery no longer blocks acquisition from saved
metadata; stale legacy websocket rows cannot hide CLI candidate-depth evidence;
normal no-op results name parked outcomes. CLI and web skip the user-accepted
exceptions unless explicitly reopened. Existing library/audio files untouched.

## Latest — 13 September, 15:08 Bangkok: audit deletion and ten-result CLI

User explicitly authorized permanent deletion of failed-duration files (no
new archives), followed by a graceful CLI restart. Full stopped-set cutoff
14:55:15.557 Bangkok:11,992 physical MP3s/15,239 paths. Final evidence overlay:
**9,501 length-match,2,347 with a failed occurrence,1 corrupt,143 unknown
Spotify identities,0 remaining known-ID duration gaps.** Of the2,347,19 are
mixed-edition shared files with at least one passing occurrence; preserve them.
Length-match is not recording-identity proof. Unknowns are not failures.

Evidence: `data/acquire/historical-duration-audit/full-report.json` is the
immutable pre-delete report; `post-cutoff-source-completion.json` resolves33
known-ID files separately, with exact-ID/title and documented credit-variation
evidence. Do not regenerate the old report against deleted paths. Audit PID40133
finished; marker PID69496 gracefully exited. No audit worker remains necessary.

Deleted2,329 physical files from the active downloads tree, removing
30,780,307,194 bytes from that tree. Main manifest
`data/acquire/duration-deletion/duration-delete-2026-09-13T07-56-36-872Z-e240e5d8.json`
removed2,326 physical files/3,097 paths after full-set fingerprint/hardlink and
fresh ffprobe preflight; all12,142 non-target paths were independently unchanged.
A retained external-linked bad K Scope copy initially rematerialized one alias;
the second graceful drain removed both exact active aliases using
`scripts/acquire/delete-kscope-active-links.mjs`. Its existing outside archive
was NOT modified or newly created; this exception reclaimed zero filesystem
bytes, while removing11,866,100 bytes from downloads accounting. Supplemental
manifest `duration-delete-2026-09-13T08-04-44-668Z-d7b4f1df.json` removed two
unanimous failures:Elégie and Shonen Jump. The latter was0.519s beyond the
defined20s tolerance. Every delete has metadata-only intent/result evidence;
no new media archives or recovery copies were made.

Current acquisition **PID95926/session95374**, run
`2026-09-13T08-07-31-213Z`, started15:07:32 Bangkok:

```sh
/Users/dom/.nvm/versions/node/v20.19.4/bin/node scripts/acquire.mjs run --takeover --authenticated --pot-recovery --retry-errors --search-buffer 192 --max-searches 10 --network-retries 5
```

`--max-searches` defaults10 (range1–50): number of ranked candidate results in
one track query, NOT network repetitions. Default network-retries5 separately
permits five additional failed-network workflow attempts; underlying extractor
behavior and global safety floor/cooldown are unchanged. Wrong/unknown-length
results do not increment retry counters. Exhausting candidates parks a durable
`no-candidate` state; increasing depth reopens it. Old generic candidate errors
are migrated. Journal adds network_attempts/search_limit without resetting work.
The interim run rejected80 wrong-length candidates with zero network retries.

Fixed a demonstrated starvation bug: thousands of unvalidated cached URLs
must not fill the searched-result buffer. Searches now run alongside those
cached extractions; duration-matched searched results have download priority.
Final live run has emitted actual ten-result candidate selections, including
rank2 choices. Verify new MP3 outputs and a complete window before claiming
the new throughput; pre-cleanup guarded rate was7.259/min(2.42x3/min baseline).
Start-of-run physical catalog:9,449/18,977 saved,47Missing,9,481remaining,
81.593137860GB. Prior-rate provisional ETA14 September12:55 Bangkok,
18:22buffered; mixed-edition/unknown repairs remain outside that estimate.

Pace remains4download/1search,240admissions/10min,batch8,buffer192,autoStepfalse.
Both Bull queues paused/active0,1,792download and13,580search jobs retained.
Final startup retained80 unexpired prior admissions and the same cooldown.
Do not restart this healthy CLI or reapply old startup pace flags.

Review bookkeeping uses existing `needs-repair`, not a new unsupported state.
`duration-repair-ledger.mjs` annotates permanent deletion and automatically
resolves only duration-only reviews when new output matches all relevant
expected lengths; manual identity reviews are never auto-resolved. CLI and web
source validators now accept an exact ten-artist credit prefix followed by
additional credits, still requiring exact Spotify ID/title. This prevents
the documented truncated artist lists from blocking the two supplemental
replacements. Other artist mismatches remain rejected.128 CLI tests,22 focused
backend tests and backend type-check passed before final activation.

15:11:33 first-output verification:21 newly published MP3s,5.231/min across
the first4.015 minutes(1.744x baseline),323 candidate disqualifications,
2 no-candidate outcomes,zero network/operation retries,zero blocks. First8
MP3s independently ffprobed and matched against exact Spotify durations;
artifact `data/acquire/max-searches-rollout-20260913.json`. Library9,470/18,977
saved,81.737247236GB,9,460remaining. Startup-rate ETA14 September21:20 Bangkok,
15 September04:52buffered; this supersedes the prior-rate provisional forecast.
The first complete10-minute window ends15:17:32.531 Bangkok; no sustained
ten-result throughput claim yet. CLI remains sole owner and keeps running.

Latest15:13:03 snapshot:40 new MP3s in5.523minutes =7.243/min(2.414x baseline),
468 candidate disqualifications,6 no-candidate outcomes,zero network retries,
zero operation retries/blocks.9,489/18,977 saved,81.864747880GB,9,441remaining.
Current startup-rate ETA14 September12:56 Bangkok,18:22buffered. Healthy PID95926
continues; do not confuse the40-output run with a full ten-minute benchmark.

## Full downloaded-set audit — 13 September, 14:04 Bangkok (IN PROGRESS)

User insists on testing the FULL downloaded set, not a sample. Stay on this
audit through its full pass; do not confuse a launched background worker or
partial suspicious-first results with completion. CLI PID53853 remains healthy
and untouched. No YouTube work, media repair/deletion, queue activation or
pace tuning was performed for this audit.

The audit's extra one-second metadata delay was reduced to the configured
250ms Spotify spacing (still sequential, with the existing Retry-After gate).
Old audit PID77367 drained cleanly and retained its immutable snapshot/cache.
Current audit PID40133/session57640:
`SPOTIFY_META_CONC=1 SPOTIFY_META_GAP_MS=250` Node20.19.4
`scripts/acquire/historical-duration-audit.mjs --gap-ms 250`.
Marker PID69496/session1952 is unchanged and keeps marking main-audit findings.
First resumed iteration encountered a one-minute application backoff because
five cached ambiguous editions were counted as failures, not an observed HTTP
block. Then measured metadata comparison rate rose to about225 songs/min
(previously57/min). Do not infer current speed from restart-average counters
that include that initial backoff. At14:04:10,3,005/11,170 unique catalog songs
compared,850 probable mismatches,1 unreadable,8,164 playable songs awaiting
source comparison. Estimated main pass today14:40 Bangkok,14:51 buffered.

Requested subagent independently inventoried the FULL downloaded tree and
ffprobed all files outside the original snapshot. Fixed cutoff14:00:20 Bangkok:
11,593 physical MP3s,14,791 paths,108.345427199GB. Original11,222 inodes and
14,387 paths unchanged. Extras371 =195 new guarded files (all independently
length-matched) plus176 historical files across197 previously unmatched paths.
Historical extras:33 exact metadata bindings (one probable wrong length,
32 awaiting duration),143 explicitly unknown source identities, all readable.
No hidden matched-catalog historical gap. Read the current inventory/report at
`data/acquire/historical-duration-audit/coverage-gap/`. Prior cutoff inventories
are preserved under its `runs/` directory. `supplemental.json` has228 bound
song/file objects and143 unknown files; `playlist-occurrence-bindings.json`
preserves23,203 exact destination paths, including139 multi-ID paths and200
excluded/dynamic playlist occurrences (identity-only, not re-added to ingest).
Agent is separately checking whether remaining unknown identities have exact
source IDs in historical music-job/event metadata; any additions go to
`coverage-gap/recovered-identities.json`, without changing the fixed cutoff.

Root added `scripts/acquire/full-duration-report.mjs` and tests. It reconciles
the immutable full inventory with main per-inode results and supplementary
probes, checks fingerprints again, and compares exact playlist occurrences
separately (one matching shared-inode edition cannot certify another playlist).
Filename-only conflicting editions stay ambiguous unless every possible known
edition agrees. Run it again after the main pass; output is `full-report.json`
in the main audit directory. Current output is PARTIAL and does not replace
the live main findings/marker. Do not mark from a stale earlier generated full
report. At completion, hydrate the32 exact-ID supplemental source gaps, retry
recoverable unknown metadata, regenerate full report, preserve irreducible
unknowns, and mark its additional verified findings while preserving all
existing ledger evidence. No automatic repairs were requested in this turn.

Concurrent CLI at14:03:56:11,388/18,977 saved,108.746987697GB,7.07 tracks/min
(2.36x3/min baseline), no cooldown. Bulk ETA14 September07:51 Bangkok,
12:18 buffered; content repairs remain separate.

## Historical duration audit — 13 September, 13:36 Bangkok

User explicitly requested a subagent to compare prior downloaded recordings
against Spotify/playlist durations and mark probable bad downloads. The audit
is running independently; do not interrupt guarded acquisition PID53853.
No recording was deleted, replaced, moved, retagged or queued for repair.

Audit PID77367/session55999 runs
`scripts/acquire/historical-duration-audit.mjs --gap-ms 1000`, with Node20.19.4,
`SPOTIFY_META_CONC=1 SPOTIFY_META_GAP_MS=1000`. Snapshot
`2026-09-13T06-31-14-635Z-94ad740f` contains11,170 catalog songs,
11,222 distinct physical inodes and14,387 catalog paths. All inodes have been
inspected:11,221 positive-duration MP3s and one unreadable345-byte file.
197 additional MP3 paths cannot be bound to catalog songs and remain explicitly
outside the comparison denominator. Files published after enumeration are not
in this snapshot; the current CLI enforces its new-publication duration guard.

At13:36:24:262 unique songs duration-compared,149 length-matches,
113 probable wrong-duration songs, one separate unreadable song, and10,907
playable songs awaiting source metadata. Hydration57.90 songs/min; provisional
audit ETA13 September16:45 Bangkok,17:32 with25% buffer. Short clips and longest
files are prioritized, so DO NOT extrapolate this early mismatch rate. Unknown
or conflicting Spotify editions remain unknown/ambiguous, not probable bad.
Matching duration does not prove recording identity.

Root independently re-probed and checked source-cache durations for LEISURE /
Money (239s versus6,390.921s), Max Richter / She Remembers (229.403s versus
9,542.548s), and Four80East / Noodle Soup (254.080s versus10.781s). Fingerprints
and durable review markings matched. Separately verified the unreadable
Peaceful Melody, soave lofi / Cry Me A River file and its three hardlinks;
it is marked as unreadable, not as a duration comparison.

Incremental marker PID69496/session1952 runs
`scripts/acquire/mark-duration-audit.mjs --watch`. Every15s it validates current
file fingerprints and tolerance, then adds probable-duration findings to
`data/acquire/quality-review.json`, preserving existing identity-review evidence
and files. Source audit artifacts are under
`data/acquire/historical-duration-audit/` (`progress.json`, `findings.json`,
immutable `snapshot.json`, per-inode and per-source evidence). Marker status is
`data/acquire/historical-duration-marking.json`; markedUnique is per poll, NOT a
cumulative total. Both workers are resumable; do not start duplicate workers.
Audit and marker have15 passing offline tests. Neither launches YouTube work.

Concurrent CLI at13:36:19:152 new guarded MP3s,7.97/min (2.66x3/min baseline),
11,210/18,977 physically saved,106.815008657GB unique-inode MP3 bytes,
7,720 remaining,47 confirmedMissing, no bot trip/cooldown, no retry exhaustion.
Bulk-download ETA14 September05:45 Bangkok,09:48 buffered; audit and unresolved
repair completion are separate. Review count grows as audit findings arrive.
Web queues remain paused and preserved; pace was not changed for the audit.

## Live duration rollout — 13 September, 13:18 Bangkok

13:20 follow-up: 19 guarded MP3s published, six unsuitable cached candidates
rejected, and five of those already have automatically selected alternatives
from normal CLI searches (no agent searches). Initial 2.5-minute rate7.17/min,
2.39x baseline, is startup-only—not a completed benchmark. Physical plan
11,077/18,977 saved,105.730915539GB,7,853 remaining. At that provisional rate,
bulk ETA14 September07:35 Bangkok,12:09 buffered; no bot trip/cooldown or retry
exhaustion. Existing four historical content reviews remain separate.

User asked why not restart to load the guard; this explicitly authorizes this
graceful upgrade. Stopped new admissions, drained PID27088 without killing any
children, verified returned handoff/zero old children, then started PID53853,
session58366, run `2026-09-13T06-17-13-331Z` at13:17:14.560 Bangkok.
Command: Node20 `scripts/acquire.mjs run --takeover --authenticated
--pot-recovery --retry-errors --search-buffer 192` (no stale pace flags).
Profile remains4 download/1 search,240 admissions/ten minutes,batch8,buffer192.
Every unexpired prior admission was retained, including duplicate batch
timestamps; cooldown and lastBotAt were preserved. A strict whole-array equality
check differed due to expired admissions; the correct unexpired-multiset check
passed. No history reset or pace increase. Owner verified, web queues remain
paused/active0 with1,792 download/13,580 search jobs preserved.

Guard is LIVE (`durationGuard=spotify-v1`), not merely staged. By13:18:28, nine
new guarded MP3s were published; five independently ffprobed again against
Spotify, all within tolerance. Artifact:
`data/acquire/duration-rollout-20260913.json`.54 CLI tests passed before restart.
New guarded throughput is still warming up; do not label an initial burst a
completed benchmark. Old CLI had entered search-heavy work and its pre-drain
last-ten-minute rate was10.2/min, not the earlier23/min cached-URL rate.
At13:18 plan11,063/18,977 saved,105.649790919GB; provisional bulk ETA at the
pre-restart10.2/min is14 September02:10 Bangkok,05:23 buffered. Refresh actual
guarded rate/counts before the next status. Four historical content reviews
remain separate and are not covered by the new-acquisition duration guard.

## Latest implementation checkpoint — 13 September, 10:06 Bangkok

User explicitly requested automatic fuzzy Spotify-versus-YouTube duration
rejection/alternative selection, in the workflow rather than manual agent work.
Root implemented CLI metadata propagation/lazy cache, five-candidate selection,
ID-bound pre-media match filters with pre_process duration evidence, durable
rejected-URL exclusions, automatic bounded fallback, and final ffprobe matching
before publication. Policy is ±5%, min5s/max20s, shared with web backend.
Missing/unknown duration fails closed into durable retry; no silent trimming or
false Missing for all-wrong candidates.54 CLI tests pass, including mixed
nonzero batch isolation and final-file rejection. One real gated Spotify lookup
successfully cached Apollo440/Tears of the Gods377440ms. All remaining songs
had SpotifyIDs at coverage check; none had durations, so lazy hydration is needed.
New cache is `data/spotify-track-metadata`, public metadata only,0600 files.
CLI rejected IDs persist in `data/acquire/duration-rejections.json` on new runs.

**Do not mistake source edits for live activation:** healthy PID27088/session12460
was not restarted and does not hot-load these changes. New CLI runs enforce the
guard; the current run still uses its old codec/positive-duration publication
rule. `status.durationGuard=spotify-v1` is emitted only by a new guarded run.
Web-duration retrofit is complete via the existing requested subagent:
131 backend tests across 18 suites passed; backend typecheck and diff check
passed. Root independently reran all 54 CLI tests and backend typecheck.
Both web queues stay paused, CLI keeps sole YouTube ownership, no test YouTube
processes. Do not activate web or casually stop CLI to deploy the guard.
Existing saved files are not retroactively duration-certified.

At10:06 plan:8,158/18,977 saved,42 confirmedMissing,10,777 remaining,
75.712856749GB unique-inode MP3s. Live4/1/240, no blocks/retries/cooldown,
current-profile23.0937/min (7.6979x baseline). Bulk ETA13 September17:53
Bangkok,19:49 buffered; conditional on continued power/network. Power connected
and charging59% at09:57; no power settings changed. No pace change this turn.

First4/1/240 interval09:40:48.111–09:50:48.111 Bangkok independently audited:
216 distinct codec-valid MP3s,21.6/min,7.2x baseline,2,023,295,404bytes,
no file failures/blocks/retries/sole-owner exclusions. Artifact:
`data/acquire/audit-20260913-four-workers-240-10min.json`.
This is not a guarded-ingest or recording-identity benchmark: cached URLs,
transition carryover and owner review searches/staged downloads are included.
Four known source issues were flagged by the ledger at audit time.

The three JoeHisaishi repairs physically completed09:48 were independently
checked now: original/output hashes, MP3 codec, exact Spotify durations, tags;
DB9498/9501/9504 and journal URLs CAS-updated/read back. Ledger29resolved/4open.
Archives are b764db65538f0a1546062080-169423136 (BottomlessPit/E90OiDedBsE),
7c63d0f60e2278e370eaae37-169423214 (Yubaba/7qzU5R05smY),
e8fcbdc4aba1b259f3f1ef9d-169423406 (Return/fC6M7QKVP4A), under preserved-originals.
No extra acquisitions counted, originals intact. Boysen/TammyAdams/Love remains
unrepaired: owner requestboysen-love-download1-20260913 completed/staged, but
must independently verify candidatej7usC68u6kk against catalog378.117s before
replacement. Three older Naulka/savpex/Nopi reviews remain unresolved.

## Acquisition CLI ownership and recovery

This checkpoint supersedes the older queue-operation instructions below.
The user explicitly requested an acquisition-only CLI over the saved metadata,
approved draining the web workers and transferring ownership, and said they
are AFK and to work autonomously. Do not ask for that handoff approval again.

### Latest operational checkpoint — 13 September, 09:41 Bangkok: 216 audit complete, 240 allowance trial live

**09:43 follow-up:** same live4/1/240 owner, no retries/blocks/exhaustions.
All4 download workers busy while admissions201/240; short-profile20.1779/min
does NOT yet show an improvement over216. Hold through09:50:48.111, then audit;
if allowance remains unfilled with4 busy workers, concurrency (not allowance)
is the next lever to consider. No further pace change now. Latest physical
plan7,626/18,977,11,309remaining,71.092385420GB. At09:43:25 status rate20.1779,
bulk ETA13 September19:04 Bangkok,21:24 buffered; continued power required.

WATER is repaired09:42:57.677 with exact Deep Sea Society TopicBXM0G0bkLQg,
157.636375s vs catalog157.636. Independent MP3/tags/original+output hashes
passed; DB9371 and journal URL corrected/reread. Original/manifest preserved:
`data/acquire/preserved-originals/3badeda09fbf2e4eb6587fcf-169419763/`.
The451.6MB original is archived outside downloads, explaining lower MP3 GB
without data loss. Ledger now26 resolved/three original open. Owner review
actions54 completed,0 pending/active/errors. One owner search and one staged
download occurred during240; account for them, never count repairs as new.
Post-repair216-window audit still210 distinct MP3s,1,300,752,486bytes,zero
file failures/open reviews in window. Artifact:
`data/acquire/audit-20260913-four-workers-216-post-repair.json`.
Original audit retains its historical WATER flag; do not rewrite it.

Requested web subagent completed retained **4/1/216**,idcli-proven-2026-09-13-4x216,
21.0/min evidence with all historical at-audit quality caveats.23 backend
tests/5suites,76frontend tests,both typechecks/diff check pass; real existing
mainChrome disclosure showed retained216/live240 and disabled activation,
original open/scroll restored. Root independently checked liveAPI matches,
Redisowner present, bothwebqueuespaused/active0/preserved1,792and13,580jobs.
No activation, CLIrestart, newwebYouTubework or memory edits.

**LIVE4 download /1 search,240 admissions per ten minutes,batch8,buffer192,
autoStepfalse.** Only allowance216→240 hot-applied02:40:48.111 UTC
(09:40:48.111 Bangkok). Same PID27088/session12460 remains alive, no restart;
first-block floor/cooldown/admission history preserved. Do not change another
lever before the first complete interval ends09:50:48.111 Bangkok and is audited.
All47 offline CLI/report/repair/audit tests pass, including240 acceptance/241
rejection and unchanged persisted history. No test YouTube work.

The completed4/1/216 interval09:30:10.622–09:40:10.622 yielded **210 MP3s,
21.0/min,7x baseline**,210 distinct keys/inodes,1,747,429,446 bytes after two
repairs, no retries/blocks/benchmark exclusions. Independent artifact:
`data/acquire/audit-20260913-four-workers-216-10min.json`. Caveats include
transition carryover,cachedURLs,two owner searches/two staged repairs(not
extra acquisitions),Mode Donna/Sun Fighters initially wrong and repaired
before audit,Deep Sea Society/WATER still wrong at audit. Not full recording
identity or fresh-search throughput proof. The requested subagent is updating
retained web profile4/1/192→4/1/216 with these caveats, NOT activating it.

Physical09:41 plan **7,580 /18,977 on disk**,42 missing,11,355 remaining,
71.093069150GB; at audited21.0/min bulk ETA13 September18:42 Bangkok,20:57
buffered. At09:39:142.276GB free,battery40%,discharging,1:19 estimated left;
continued power required and user warned. No power setting changed.

Sun Fighters/Run Me replaced09:38:12.494 with Topic5kKak4GeVRY,
124.363667s versus authenticated catalog124.363. Independent hashes,codec,
tags passed,DB9339 and journal URLs corrected/reread. Archive+manifest:
`data/acquire/preserved-originals/4237e3df467330221bba7b80-169416976/`.
Mode Donna/Catwalk was repaired earlier this phase; both originals preserved.
Ledger25 resolved/four open: original Naulka,savpex,Nopi plus newDeepSeaSociety.
WATER catalog157.636s vs4.6-hour documentaryDpu3XoY3wQw; exact catalog ID
2L7lQAOBGtelJgVg3cREJN. Owner querydeep-sea-water-search1-20260913 submitted
after240 trial start. Original remains intact. Account for new review workload
in240 benchmark. Completed52 review actions before this new request.

### Earlier operational checkpoint — 13 September, 09:30 Bangkok: four-worker/192 audit complete, 216 allowance trial live

**09:36 follow-up:** live4/1/216 still healthy, admissions216/216, no new
blocks/retries. Prepared (NOT applied) the next bounded240 allowance by updating
the command validator/help216→240; all47 offline CLI/report/repair/audit tests
pass, including rejection of241 and preservation of persisted pace history.
Wait for09:40:10.622 and independently audit216 before changing another lever.
Physical plan7,481/18,977 on disk,11,454 remaining,69.941294496GB. At audited
19.0/min, bulk ETA13 September19:39 Bangkok,22:10 buffered. Power required;
battery44%,discharging,1:42 estimated remaining at09:31; no power changes.

Retained web preset is now **4/1/192** (idcli-proven-2026-09-13-4x192),
derived Bull32download/8search,19.0/min evidence/caveats. The existing requested
subagent completed23 backend tests/5suites,76frontend tests,both typechecks,
diff check and real mainChrome disclosure interactions; original open/scroll
state restored. Root independently checked source/liveAPI and owner/queues:
both paused/active0,preserved1,792downloads/13,580searches. No activation.

This216 phase includes two additional wrong cached sources found by exception
audit. Mode Donna/Catwalk was a37-minute fashion compilation; exact Topic
Fd24vMR6QZ4 replaced it09:35:15.054 after owner-run search/download. Duration
166.909104s matches authenticated Spotify166.909s. Independent hashes,codec,
tags passed; DB9250 and journal URLs corrected/reread. Original+manifest:
`data/acquire/preserved-originals/0c4f90dc41cbf7c8608586c6-169411954/`.
Sun Fighters/Run Me is a38-minute drama episode; authenticated catalog is
124.363s. Ledger needs-repair and owner querysun-fighters-run-me-search1-20260913
queued. Keep these workload/recording caveats in the216 benchmark; repairs do
not count as additional acquired MP3s. Ledger24 resolved/four open for now.

Hot-applied only allowance192→216 at02:30:10.622 UTC (09:30:10.622 Bangkok).
Live profile is **4 download /1 search,216 admissions per ten minutes,batch8,
buffer192,autoStepfalse**. Same healthy PID27088/session12460, no restart;
admission history, cooldown and first-block floor preserved. First complete
new window ends09:40:10.622 Bangkok. Do not treat a startup burst as sustained.
Retained web preset is4/1/192 after the09:36 follow-up, not activated; web queues stay paused.

Independent four-worker/192 audit09:18:10.589–09:28:10.589 found190 new MP3s,
**19.0/min,6.3333x baseline**,190 distinct keys/inodes,1,433,276,303 bytes,
all codec/duration checks passed, no retries/blocks/exclusions/open reviews
inside this window. Artifact`data/acquire/audit-20260913-four-workers-192-10min.json`.
This transition interval includes in-flight carryover and two owner-run searches
plus two staged recording repairs, which were not extra acquired MP3s. The bulk
workload still uses cached URLs; this does not prove fresh-search throughput or
recording identity. The user was explicitly told agent searches are selective
quality exceptions, never a per-song LLM gate on the normal CLI path.

At09:30:22, physical catalog **7,352 /18,977 on disk**,42 confirmed missing,
11,583 remaining,69.220445026GB. At audited19.0/min, bulk ETA approximately
13 September19:40 Bangkok,22:12 with25% buffer, conditional on continued power.
Three recording reviews remain separate from bulk ETA. No new retries/blocks.

### Earlier operational checkpoint — 13 September, 09:18 Bangkok: three-worker/192 audit complete, four-worker trial live

**09:25 preparation:**4/1/192 still live, no retries/blocks; the192 allowance
is full while actual active processes sometimes fall to1, confirming that
admissions now constrain output. Prepared a bounded216-admission trial by
raising only the CLI command validator/help ceiling192→216 (not live pace).
All47 offline CLI/report/repair/audit tests pass; the control test verifies
192/216 requests do not alter persisted admission/cooldown history and217 is
rejected. No live CLI restart. Do not apply216 until the current full window
ends09:28:10.589 and its independent audit is clean.

**09:23 follow-up:** physical plan **7,208 /18,977 on disk**,42 confirmed
missing,11,727 remaining,68.412901040GB. Live4/1/192 fills the admission limit;
current short-profile output20.886/min is above the19.2 ceiling and MUST NOT
be presented as sustained. Ceiling-capped provisional bulk ETA13 September
19:34 Bangkok,22:06 buffered; no new blocks/retries, owner/PID alive. Keep
this profile through09:28:10.589 for its full ten-minute audit before another
lever. Two candidate searches and two staged repairs occurred inside this
phase and must be disclosed in its workload; none counted as extra MP3s.

The two newly flagged full albums are resolved; ledger **23 resolved /3 open**
(original Naulka, savpex, Nopi cases). Zonal/Wrecked was replaced09:21:23.547
with Relapse official individual audio fHZ3uhisseI,386.538667s versusSpotify
386.552s. Original/manifest:
`data/acquire/preserved-originals/bb9cae060d99e05b26af81dd-169397886/`.
Villagers/Age of Aquarius replaced09:22:09.937 with band official studio
trackCr7u-F3Uuyw,523.776s versusSpotify523.103s, original/manifest:
`data/acquire/preserved-originals/ef852d5320457192260c71f1-169400790/`.
Both independently passed original/output SHA256, codec/duration and tags;
DB8895/8939 and respective journal URLs corrected and reread. Owner review
actions completed48, none pending/errors. The original181-file audit retains
its historically observed two wrong sources; subsequent repairs do not make
the original ten-minute interval a blanket correct-recording benchmark.

The requested web-retrofit subagent completed the retained **3/1/192** preset
(id`cli-proven-2026-09-13-3x192`) and18.1/min evidence with caveats, derived
Bull slots24download/8search.119 backend tests/13suites,76frontend tests and
both typechecks passed. MainChrome Refresh/disclosure showed retained3 versus
live4 with disabled activation. No activation or CLI/queue/state writes;
web queues paused/active0 preserving1,792download/13,580search jobs. Agent
completed and returned the existing Spooty tab with disclosure expanded.

**LIVE:4 download /1 search,192 admissions/ten minutes,batch8,buffer192,
autoStepfalse.** Hot-applied at02:18:10.589 UTC (09:18:10.589 Bangkok), changing
only concurrency3→4. PID27088/session12460 remains uninterrupted. Preserve
cooldown/admission history and first-block floor. The first full new trial
window ends09:28:10.589 Bangkok; do not present its startup burst as sustained.

Completed3/1/192 window09:07:00.193–09:17:00.193: **181 MP3s,18.1/min,
6.0333x baseline**, zero blocks/retries/exclusions. All181 distinct inodes
passed independent MP3 checks,2,045,208,458bytes. Artifact:
`data/acquire/audit-20260913-three-workers-192-10min.json`. The interval includes
two owner-run candidate searches and two staged repair downloads, neither
counted as extra acquisition. Two new full-album mismatches (Zonal/Wrecked,
Villagers of Ioannina City/Age of Aquarius) are explicitly flagged, bringing
the ledger to five open/21 resolved at this checkpoint. Exact Spotify metadata
and candidate searches are being checked; originals remain untouched.
Candidate requests`zonal-wrecked-search1-20260913` and
`villagers-aquarius-search1-20260913` were queued through the sole CLI owner.

At09:19:03, physical plan: **7,134 /18,977 on disk**,42 confirmed missing,
11,801 remaining,67.986908089GB. Latest completed rate18.1/min; new-profile
ceiling-capped provisional bulk ETA13 September19:34 Bangkok,22:07 buffered.
Mac still requires continued power (battery52% at09:12,2:13 estimated left).
The user's existing`web_ingest_retrofit` subagent is updating only the retained
web preset to3/1/192 and its181-file evidence, without activation or any CLI
state writes. Root owns CLI monitoring/repairs and these handover documents.

### Earlier operational checkpoint — 13 September, 09:07 Bangkok: three-worker trial verified; allowance trial started

**09:14 Bangkok dashboard follow-up:** live CLI banner now separates current
trial MP3/min and baseline multiple from whole-run averages. Short trials are
labelled provisional, and both ETA dates explicitly render atUTC+7 with the
wordBangkok regardless of browser timezone. Six backend telemetry tests and
all76 library-panel browser tests pass; both TypeScript checks pass. Main
Chrome's existing Spooty tab showed current18.42/min versus whole-run13.09/min,
Bangkok ETAs,841 playlist options and disabled profile activation. The profile
disclosure was opened/closed and its original state restored. No resync,
enqueue, playback, profile activation or extra YouTube work was performed;
the CLI stayed running. Retained web preset remains2/1/144, separately labelled
from live3/1/192 trial pending sustained measurement.

**09:11 Bangkok follow-up:** physical plan reports **6,983 /18,977 on disk**,
42 confirmed missing,11,952 remaining,66.226916057GB;147.255GB free. PID27088
and its Redis owner remain live. Current3/1/192 profile (not yet ten minutes)
averages18.0701/min; provisional bulk ETA13 September20:13 Bangkok,22:58
buffered. Last30 output15.1667/min; zero new blocks/retries/exhaustions.
No further settings change after09:07. Next complete trial interval ends
09:17:00.193 Bangkok. This192 phase includes two owner-run candidate searches
and two staged repair downloads, so account for that work when comparing it;
staged/repair files are not additional acquired MP3s.

Both new recording exceptions below are now **resolved**; ledger21 resolved,
three open (Naulka/Pyramids, savpex/All Flowers For You, Nopi/White Mixed).
Across The Threshold was replaced at09:09:30.899 with artist Topic source
oF1iR0RFRcA,448.532938s,matching authenticated Spotify448.532s; both playlist
copies independently passed codec/duration/tags/hash checks. Original and
manifest preserved at`data/acquire/preserved-originals/76bd88040abae5329a9d30e8-169386150/`.
DB8520/18881 and journal URL were corrected and reread.
Random Friday was replaced at09:10:22.070 with original2012 artist source
L-fGXV1Zr0o,559.392979s,matching both Spotify catalog IDs at559.392s; all four
copies independently passed codec/duration/tags/hash checks. Its incorrect
continuous-mix chapter was NOT used. Original and manifest remain at
`data/acquire/preserved-originals/3ee879c780841a7c5048ffb2-169388603/`.
DB8607/15408/20632/22395 and journal URL corrected and reread. Owner review
work completed44 actions, no pending/errors. No extra acquisition counted.

**LIVE trial: 3 download /1 search processes,192 admissions/ten minutes,
batch8,buffer192,autoStepfalse.** Applied at02:07:00.193 UTC,09:07:00.193
Bangkok. PID27088/session12460 remains uninterrupted. Only allowance changed
in this step; first-block floor/cooldown/history remains intact. A complete
new ten-minute window ends09:17:00.193 Bangkok; do not call it proven early.

Previous3/1/168 trial,08:56:26.592–09:06:26.592 Bangkok: **172 new MP3s,
17.2/min,5.7333x baseline**, zero blocks/retries, no sole-owner exclusions.
All172 distinct files/inodes independently passed ffprobe,1,575,350,244bytes.
Audit: `data/acquire/audit-20260913-three-workers-10min.json`. This first
transition window includes work already in flight and can exceed the16.8/min
allowance ceiling; it is not a sustained17.2/min claim. Immediately preceding
two-worker clean10min was131 files,13.1/min.3 workers repeatedly filled the168
allowance and then waited, motivating the one-lever192 trial.
At09:06:41, **6,901 /18,977 catalog songs physically on disk**,42 missing,
12,034 remaining,65.597308097GB. Conservative bulk ETA13 September21:03
Bangkok,14 September00:02 buffered; continued power required. Five content
exceptions are separate from bulk ETA. Latest battery recheck09:04:55%,
discharging,2:18 estimated remaining; user already warned.

The two prepared Flooting Grooves/Solar Fields candidate searches below were
submitted through the sole CLI owner AFTER the172-file measurement completed.
They use its shared search pool; any staged replacement must use the same owner
and never count as an extra acquired MP3. No web workers were resumed.

### Earlier checkpoint — 13 September, 08:56 Bangkok: autonomous throughput trials resumed

The latest user goal explicitly authorizes increasing throughput parameters
again, superseding the earlier hold below. Continue unattended; no routine
approval questions. Report total catalog songs physically on disk, not just
new-this-run counts, and use Bangkok local times (UTC+7), not ICT.

PID27088/session12460 remains live; run2026-09-13T00-22-15-748Z.
At08:56, plan verified **6,724 /18,977 catalog songs on disk**,42 confirmed
missing,12,211 remaining,63.833567109GB across6,952 unique MP3 inodes.
The prior2-download/1-search/168 profile averaged13.2543 MP3/min (4.4181x
the3/min baseline), zero new retries/blocks; both download workers were busy
while admissions remained below the allowance. Hot-applied only download
concurrency2→3 at01:56:26.592 UTC (08:56:26.592 Bangkok), leaving search1,
batch8,168 admissions/ten minutes,buffer192,autoStepfalse unchanged. Treat this
as an unproven trial until a complete clean observation; do not restart CLI.
Web queues remain paused; do not activate the web preset during CLI ownership.
Three known recording-quality exceptions remain separate from bulk throughput.
Current-rate bulk ETA was14 September00:17 Bangkok,04:08 with25% buffer.
Power recheck08:56: battery59%,discharging,about2:22 remaining; previous warning
was already delivered. ETA assumes continued power. No power settings changed.

Added `scripts/acquire/audit-output.mjs`, a read-only offline completed-window
auditor. It launches only local ffprobe (concurrency2), verifies non-empty
MP3 codec/positive duration and stable file stats, rejects duplicate keys/inodes,
staging and out-of-tree paths, retains known content-review and benchmark
exclusion caveats. It cannot download, control the owner, or write artifacts.
At08:59 it independently reproduced the earlier382-file/3,956,919,778-byte
thirty-minute audit with zero file failures. All47 offline CLI/report/repair/audit
tests pass. The live CLI was not restarted to load these independent helpers.

At09:03 Bangkok, the content ledger has **five open /19 resolved entries**.
Two newly observed long cached sources were flagged: Across The Threshold
(Flooting Grooves and collaborators) is a61-minute downtempo mix vs exact
Spotify448.532s; Solar Fields/Random Friday is a78-minute continuous album mix
vs exactSpotify559.392s. The latter's native chapter297–673s is376s and is NOT
a valid repair for the requested9:19 individual track. Artist Bandcamp agrees:
https://solarfields.bandcamp.com/album/random-friday . Both sources remain
untouched. Two completed review INPUTS were retired (all durable RESULTS
retained), and new catalog-scoped candidate-search requests are prepared as
`flooting-threshold-search1-20260913` and `solar-random-friday-search1-20260913`.
They have not yet been submitted through the hot control; enqueue after the
first clean three-worker ten-minute benchmark at09:06:26.592 Bangkok.

### Historical checkpoint — 13 September, 01:38 UTC: held profile passes clean thirty-minute audit

**Power warning discovered during live monitoring at01:51 UTC /08:51 ICT.**
`pmset -g batt` reports Battery Power,61%,discharging,about2:28 remaining.
The Mac needs mains power for the remaining batch; the user was notified.
Do not stop or restart the healthy CLI merely because of this warning.
Continue monitoring the live session and recheck power. A missing observation
is not proof that the process exited; verify the handle/PID before recovery.
At01:51:09,PID27088/session12460 was still running at the held2/1/168 settings:
1,081 new MP3s,12,280 remaining,63.159547739 GB,13.1259/min,zero retries/blocks.
Conditional on continued power,bulk ETA14 September00:27 ICT,or04:21 buffered.
Free space was151.09 GB at the preceding resource check. No settings were changed,
and no new duration outliers were found among outputs since01:39.

**Then-current user goal (superseded by the latest checkpoint above): hold the current CLI settings, do not increase them, and
babysit to full completion.** Confirmed live PID27088 at01:15:49. Keep2 download
/1 search processes, batch8,168 admissions/ten minutes, buffer192, autoStepfalse.
No further optimization trials are authorized by the current goal. This
supersedes all earlier instructions below to raise one lever. Safety trips and
autonomous recovery still apply; do not clear cooldown/history or restart a
healthy runner. Hold continuations have verified the live process/session,
repaired a recording exception without interrupting it, and completed the
first clean fixed-profile thirty-minute output audit.

**Keep PID 27088 / exec session 12460 running.** Run ID
`2026-09-13T00-22-15-748Z`, explicit authenticated mweb + pinned POT.
Complete ten-minute results: **84**, **104**, **120**, then **143 new MP3s**.
The latest clean window, **00:53:04.286–01:03:04.286 UTC** at allowance144,
yielded **14.3/min, 4.77x baseline**, zero retries/trips. All143 distinct output
inodes independently passed ffprobe; 1,074,022,868bytes at audit. Earlier audits
passed too. First complete mixed-profile half-hour, 00:22:16.979–00:52:16.979:
**308 MP3s, 10.2667/min, 3.42x baseline**. The later clean fixed-profile
thirty-minute result is recorded below.

At **01:04:22.978 UTC** the admission allowance alone was raised to **168 / ten minutes**;
download concurrency remains 2, search concurrency 1, autoStep false. Fresh
status at 01:37:36: **897 new MP3s this run, 12,464 remaining, 61.335530397 GB**.
The held-profile sample is 12.945/min: provisional bulk ETA 14 September
00:40 ICT, or 04:41 with 25% buffer. Allowance ceiling16.8/min is not
achieved output. Refresh before reporting; these are bulk estimates, not an
ETA for the three unresolved recording-quality exceptions. A clean rolling
ten-minute window, 01:07:29.390–01:17:29.390, produced120 outputs (12/min) with
no overlapping exclusion. This does not replace the faster144 retained preset
or authorize changing the held CLI settings. The first clean thirty-minute
observation, **01:06:35.561–01:36:35.561 UTC**, yielded **382 new MP3s,
12.7333/min, 4.2444x baseline**, zero blocks/retries. All382 current files
independently passed ffprobe again:382 distinct keys/inodes,3,956,919,778 bytes.
Evidence is `data/acquire/audit-20260913-held-profile-30min.json`. It explicitly
retains the known White recording mismatch and the repaired Overload case;
this is codec-valid file output, not a blanket recording-identity guarantee.
No parameters were increased. Session12460 was directly polled and remains running;
PID27088 was independently confirmed alive. Existing caffeinate assertions
already prevent sleep. At01:21, free space was154.90 GB and rough final MP3
storage was175.84 GB, based on the mean unique-inode file size. Refresh this
projection as the catalog mix changes. A fresh01:36 check found152.65 GB free.
Both web queues were independently rechecked paused/active zero at01:36,
preserving1,792 download and13,580 search jobs; the CLI lease remained present.
Important benchmark exclusion: web-retrofit legacy tests accidentally allowed
yt-dlp child processes during **01:05:51–01:06:07 UTC**. Whether they reached
YouTube is unknown. Test children were terminated, and later inventory showed
only CLI-owned processes. CLI was not interrupted; no new CLI blocks/retries.
`data/acquire/benchmark-notes.json` records this; the read-only benchmark command
flags overlapping windows as excluded from sole-owner comparison while retaining
real output counts. The168 trial's first10min is not eligible. Take a clean
observation after01:06:07; the read-only benchmark now also reports lastFull10
with exact interval and overlap flag. Test suites now default-deny real
subprocess launches. All44 CLI/report/repair offline regression tests pass.
Prior144 benchmark is unaffected.
Zero new retries or block signals. Earlier resumed run added 110 files.
Do not mistake a short-profile burst for sustained output. Refresh before
reporting, and sustain the held settings with autonomous failure recovery.
CLI validation now allows bounded trials through 192 admissions/ten minutes;
that ceiling is not the live setting. Cached URLs still dominate this run;
search-heavy full-library throughput remains to be measured.

**Quality follow-up at 01:38 UTC: 19 resolved, three open entries.**
Two duration outliers were found during the hold, without changing pace:
Nōpi/Luke Mandala Overload - Mixed is a131-minute AURA podcast, and Nōpi White
- Mixed is a65-minute Anjunadeep Edition. White remains under repair review.
Overload was repaired at01:31:26.369 from the publisher's exact Sinca album
source, using independently fetched millisecond catalog boundaries
1850.725–2205.924. Full catalog duration3717.733 seconds and staged MP3 duration
3717.717333 differ by16ms. This corroborates shared time-zero alignment; the
boundaries are catalog-derived, explicitly NOT native YouTube chapters.
The355.199-second replacement, exact tags and original/staged/replacement hashes
were independently verified. DB row7938 and saved journal URL now identify
CvWWFfrkQus. Original and source-proof manifest are preserved in
`data/acquire/preserved-originals/a00e1683637e44e6da653f18-169369233/`.
No extra acquisition was counted. The local helper rejects unrelated albums,
publishers, incomplete/out-of-order timings, runtime mismatch and changed files;
three new offline tests bring the CLI/report/repair total to44 passing tests.
The CLI owner completed all new inspect/search/staging requests (40 review actions
completed in this run, zero errors, none still pending). Public Spotify track
metadata independently confirms the exact requested releases:
Overload, track2s7E5f33pQm8r8nxZvEYqa, is355 seconds on Summer2026 DJ Mix,
album04vowP53gkCv5gZpdy8wsZ. White, track7Hg7wXfR3a5SkBfIutUSm8, is418 seconds
on The Sound of Akbal Music Vol2, album0Lx0TqZDQG5c9U83mzudsg.
The correct full Sinca Summer2026 mix was found on Proton, videoCvWWFfrkQus,
and its description links that exact Spotify album; it has no explicit chapters.
Do not blindly trim by rounded durations: exact API timing evidence is retained
in `data/acquire/sinca-summer-2026-catalog.json`. The separate Overload
Topic source8H_86rI3IeE is438 seconds, and White Topic33pThoh9Pms is491 seconds;
these are different unmixed versions, not verified substitutes. The latest
review request/result files retain all search evidence. The two earlier open
Naulka/savpex cases below also remain unresolved. Bulk work continues.

Naulka / Pyramids is an 86-second movie-trailer usage of the requested 200-second
track, corroborated by its label, not a complete song. A quoted-title search is
returned zero candidates. savpex / start history was replaced at01:02:29 with
the exact270-second Topic source7Ub6obU6-sg; its original/hash manifest is
`d8f343aa2e0e73c0c0419104-169356534`. Tive/Pool was a40-minute gaming video;
replaced at01:06:09 with verified148.56-second Topic sourceuEkNzOEj5Ws,
archive`8e8432fdbe9e63c30b849cfb-169358385`. DB rows7572/7619 and journal URLs
were corrected after independent codec/duration/tag/hash verification.
savpex / All Flowers For You remains under review
against the 234-second album catalog; its cached source is an aespa remix.
The live review-work results file is authoritative for those request outcomes.
All earlier16 entries were resolved: eleven complete-source replacements
and one explicit-chapter repair this morning, plus four earlier chapter repairs;
no extra acquisition counts. The latest Schumann/Horowitz Kinderszenen No. 1
file was a full cycle; explicit source chapter 38–129 seconds matches the
91-second catalog movement. Its preserved original and verified replacement
are under archive folder `7660e51f6c9e6bbf143fbd8b-169341057`.
Yeat / Money so big was a 258-second live EsDeeKid medley; replaced at 00:53:28
with the verified 160.03-second solo album recording (catalog 2:40). Original
archive: `2ef08d8f7c78f3876097c3d2-169350375`. DB row 7472 and CLI journal now
point to PK9ruiebkys; original/replacement hashes, MP3 and exact tags checked.
Independent verification checked every preserved original and replacement
SHA-256, and the newly replaced files' codec, duration, tags and durable source
URLs. Originals remain under data/acquire/preserved-originals. Review results
are retained; completed requests are idempotently skipped. The request file
currently has 32 entries; retire completed inputs (not durable results) before
adding more. Three known recording reviews remain; bulk file verification is
not a claim that every recording in the library has been manually identified.

The backend also received the stderr-only false-block fix. Dashboard has a
freshness/owner-checked CLI banner, explicit baseline and GB/ETA/buffer, and
guards against overlapping acquisition. 75 frontend regression tests pass.
Seven telemetry/audio backend tests pass, including the separate provisional
ETA rate; 75 frontend tests pass again after that change. The audio endpoint formerly advertised
byte ranges while returning the entire file; Express sendFile now supplies
real ranges (live request verified HTTP 206, exactly 1,024 bytes).
Main-Chrome UI verification loaded 841 saved playlists, refreshed actual CLI
telemetry and checked disabled acquisition controls. Playback was attempted
in the background tab but remained readyState 0, so **audible/advancing browser
playback in that tab is not verified**; player was paused and closed. A separate
local-only headless browser with explicitly allowed autoplay verified real MP3
decoding and advancing currentTime (readyState 4, duration 329.76 seconds).
This does not prove the ordinary hidden-tab click workflow. Do not claim full
browser QA. No extra resync or web download was submitted during CLI ownership.
At 00:51:48 a stalled watch shutdown was recovered after confirming both web
queues paused and active zero. Its old child had stopped listening but retained
one Angular proxy socket. Bootstrap now uses Nest's forceCloseConnections;
replacement backend PID 3619 and real browser CLI telemetry were verified.
CLI PID 27088 was not touched. See WEBSITE_AUDIT for the exact evidence.

The user-requested subagent retrofit is implemented. Agent
`/root/web_ingest_retrofit` finished and returned the existing Spooty Chrome tab
to root. The web pipeline retains audited144 as a separate proven preset,
supported clients/private jars, reviewed executable/plugin hashes, ownership
guards, logical Bull16/8 slots feeding yt-dlp2/1, and a conservative192-job search
backlog gate. No web work may launch whileCLI owns. Future preset selection
requires no CLI lease, both queues paused/active zero, and no cooldown or safety
floor; it never resumes queues. It was NOT activated live.
Verification: 118 backend tests across13 suites,76 frontend tests, both type
checks and diff check passed. Root independently reran41 CLI/report tests and
verified liveAPI200 with retained144 versus actual168, owner key present, and
both queues paused/active0, preserving1792 download/13580 search jobs.
Main-Chrome interaction loaded841 playlists, expanded the profile panel and
confirmed guarded buttons. Web execution has NOT been throughput-benchmarked;
resync and playback were not re-exercised in this scoped retrofit. See
WEBSITE_AUDIT for full evidence and the separately recorded test-isolation
incident. Do notresume queues merely to test the retrofit.

The user asked whether agent web searches (specifically Tive/Pool) are on the
normal per-song critical path. They are NOT: the CLI searches saved catalog
queries itself, downloads, converts, codec/duration-checks, tags and publishes
without LLM/agent calls. Agent web searches were selective recording-identity
audits and exception repairs. Bulk acquisition continues independently, but
automated correct-recording selection is not fully proven; do not equate the
file throughput benchmark with a blanket recording-identity guarantee.

### Earlier checkpoint — 13 September, 00:23 UTC: false-block detector fixed

**Live runner PID 27088, exec session 12460**, run
`2026-09-13T00-22-15-748Z`. It replaces PID 84370, which stopped gracefully
at 00:21:49 with no active YouTube processes. Command is the same authenticated
POT command below plus `--window 96 --download-conc 2 --search-conc 1`.
Do not restart it merely to inspect or load cosmetic changes.

The 00:19:57 apparent block exposed a deterministic local bug: the classifier
was applied to stdout JSON, so RUZE / Come Together's `duration: 429` tripped
the HTTP-429 rule. The file was published 48 ms later; both interrupted
processes had generic/no-result errors, not a recorded remote block diagnosis.
The 12 September 11:59 Marcello output likewise contains chapter boundary 429
and was published 51 ms after its trip. This does not reclassify every older
failure. The detector now checks **stderr diagnostics only**, preserving
immediate split-chunk bot/429 termination and emitting a safe `block_signal`
event identifying the emitting client. Regression tests reproduce the JSON
false positive and prove metadata/quoted error phrases cannot trip it.
**40 CLI tests pass.**

The replacement retains every admission and the existing cooldown until
00:23:22 UTC; none was erased. The explicit 96/ten-minute, two-worker trial
is restored because the triggering JSON was data, not a YouTube failure.
Prior run produced 110 new MP3s, with 74 independently rechecked in its first
complete ten minutes (7.4/min, 2.47x baseline). Four interrupted bulk jobs are
durable retries. At replacement start: **13,361 remaining, 53.824692863 GB**.
Three wrong-source files were replaced with verified matching recordings;
originals and hashes are preserved. Quality ledger: 7 resolved / 7 unresolved.
Review requests/results persist; the new owner has not yet re-enqueued the
one unfinished inspection. Re-enqueue explicitly when appropriate, preserving
finished IDs. Failed review IDs require fresh IDs for a deliberate retry.

The dashboard now receives an allowlisted, fresh, live-owner-checked CLI
projection on GET /api/youtube/pace without altering the underlying web pace.
It displays CLI throughput, baseline, unique GB, remaining, ETA/buffer and
paused-web ownership separately. Four backend telemetry tests and frontend/
backend type checks pass; browser interaction and frontend regression run are
in progress. Backend watch reloaded without affecting the independent CLI.

### Earlier checkpoint — 13 September, 00:07 UTC: autonomous recovery resumed

The user explicitly said to pursue the goal and recover from failures
autonomously. This supersedes the obsolete client restriction and the approval
hold below. **Do not ask again to choose a supported client or restore the
authorized YouTube-only cookie export.** Keep physical files, jobs, session
privacy, sole ownership and first-block cooldown safeguards.

**Live runner: PID 84370, exec session 8122**, run
`2026-09-13T00-06-25-871Z`. Command:
`node scripts/acquire.mjs run --takeover --authenticated --pot-recovery --retry-errors --search-buffer 192`.
Acquisition started 00:06:27.204 UTC. Both web queues were drained (active zero)
and paused, preserving 1,792 download / 13,580 search jobs. Inherited floor
1 process / 8 download admissions per ten minutes; previous cooldown expired
naturally, not cleared. `process_start` confirms explicit **mweb + cookies +
the pinned existing POT provider**. At 00:06:47.921 UTC the previously exhausted
Sigur Ros / Fjogur Piano completed, with a valid 512.813-second MP3.
Do not restart this live worker merely to inspect it.

The earlier 00:05:12 canary (PID 78281 / session 4443) stopped normally before
any network work: the master cookie file was discovered empty, dated September
12 at 20:18 local time. It incorrectly assigned 864 local cookie errors in
28 seconds; **all reopened with --retry-errors**, no MP3s or jobs deleted.
The YouTube-only export was restored from the existing authorized CDP bridge,
18 cookies, 2,466 bytes, mode 0600, no values exposed. Each yt-dlp process now
gets an independent private copy, so child cookie-jar rewrites cannot truncate
the master. Empty authenticated startup now fails before queue/state changes;
mid-run missing-cookie state holds admission instead of exhausting tracks.

Anonymous client is `visionos`, cookie client `web_creator`, explicit POT route
`mweb`. Recovery uses the existing provider 2.0.0 at loopback :4416 and the
previously pinned plugin SHA-256. Allowlisted warning diagnostics and requested
client/cookie-mode events replace hidden warnings, without logging secrets.
**38 CLI tests pass**, including cookie isolation and authenticated hold;
`git diff --check` passes. No backend watch reload was required.

At startup: 13,471 bulk songs, 52.957825739 GB unique-inode MP3s, nine unresolved
content repairs. Refresh live metrics before reporting rates/ETA. The goal is
not complete. The product goal record was previously marked blocked; the user
has now resumed the work, and its prior blocked condition no longer applies.

### Earlier checkpoint — 12 September, 12:26 UTC: compatibility preflight enforced; no live CLI

**Do not restart the CLI with the current player-client setting.** The installed
`yt-dlp_macos --version` is **2026.08.19** and its SHA-256 exactly matches the
official release checksum:
`0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202`.
That version's `INNERTUBE_CLIENTS` does not contain `android_sdkless`.
Its `_get_requested_clients` warns, skips unknown clients and substitutes
defaults if nothing remains. Spooty's `--no-warnings` hides that warning.
Thus the historical sdkless labels are requested argv, not actual protocol
evidence. This does not establish the remote cause of every bot/403 failure.
Exact primary-source URLs and checksum evidence are recorded in ignored,
mode-0600 `data/acquire/client-compatibility-review.json`. Changing the explicit
AGENTS.md client requirement needs user approval; do not silently select another
client, disable cooldowns or re-export cookies as a speculative fix.

The CLI now enforces this before any Redis lease, queue pause or run-state
write. `node scripts/acquire.mjs doctor` checks only the local binary digest
and configured client, returning exit 2 for the current unsupported pairing.
`run --takeover` was tested with an unreachable Redis endpoint: it rejected in
66 ms with the correct compatibility error, exit 1, leaving control/handoff/
pace hashes unchanged. `Transport` also checks the pairing on construction.
`scripts/acquire/client-policy.mjs` centralizes the still-unchanged prescribed
client; compatibility recognition is not permission to choose another client.
Unknown binary/client pairings fail closed pending an exact-release review.
**36 CLI tests pass**; `git diff --check` passes. The client-change approval is
still unanswered. No YouTube request was made by these diagnostics.

The second acquisition worker **34513 / 11262** ended normally at
**12:12:11 UTC** with **60 new MP3s, 56 searches, 37 retries**. Its return to
96 tripped at **11:59:07.930 UTC**, then its floor retry tripped again at
**12:08:42.357 UTC**, setting cooldown through **12:30:33.041 UTC (19:30 ICT)**.
The earlier 191/20-minute result remains a file-output measurement, not proof
that 96 is sustainable. The one MP3 published 51 ms after the first trip is
pre-recovery carryover, not evidence that the floor recovered.

The new handoff **68546 / session 73315**, run `2026-09-12T12-12-36-164Z`,
was stopped normally during its drain at **12:22 UTC**, before it launched any
CLI YouTube work. This was a deliberate response to the confirmed configuration
mismatch, not an observation timeout. PID absence and exec exit zero verified.
Both Bull queues were then re-paused: **1,786 download and 13,580 search jobs
preserved**, with **five download and one search already-active jobs** still
allowed to finish. Actual YouTube pool is zero behind the unchanged cooldown.
No active web job was killed. No CLI owner is now running; do not poll old
closed handles. `status.json` is the older stopped acquisition snapshot.

The staged runner supports explicit catalog-scoped `review-work` requests
(up to five search candidates, bounded public source descriptions, staged
candidate MP3s outside the library), a strict one-total-process recovery floor,
and cancellation of unadmitted gate waits on graceful stop. Default search
buffer is 192; **4,108 cached URLs** make further speculative search unnecessary.
No `review-work.json` has been queued. **34 CLI tests pass**, including candidate
staging, safety-floor admission and stop behavior; `git diff --check` passes.

Two more actual local chapter repairs are verified: Marcello/Ponseele/
Il Gardellino first movement **212 seconds**, and Bruch/Vengerov/Masur first
movement **489 seconds**. Their complete originals remain in
`preserved-originals/1f98fc36a23ccbcd49c99da4-169266500/` and
`preserved-originals/7f92d223e84bc94691da6d1c-169264757/` under `data/acquire`.
Independent codec, duration, tags and original/replacement hashes all passed.
Repairs do not increment acquisitions. The ledger now has **13 entries:
four resolved, nine unresolved**. The newly recorded unresolved Bach Badinerie
selected Sato/Netherlands Bach Society's full suite rather than the requested
Kolner/Muller-Bruhl performance; do not trim the wrong recording.

Fresh disk/catalog scan: **13,471 bulk songs remain**, **52.957825739 GB** of
unique-inode MP3s, 5,464 catalog keys saved and 42 confirmed misses. Current
output is zero and ETA unproven. Conditional on recovery and every floor credit
yielding a new MP3: **24 September 12:09 ICT**, or **27 September 10:19 ICT**
with 25% buffer; the pending client decision and nine content repairs add
unestimated time. The full acquisition goal remains active and unfinished.

### Earlier operational checkpoint — 11:56 UTC: source review deployed; two movements repaired

**NEW live worker:** PID **34513**, exec session **11262**, run
`2026-09-12T11-48-47-488Z`. The previous PID 58761 / session 60669 drained
normally and exited zero at **11:48:46.206 UTC**, with **832 new MP3s, 2,232
searches, 69 retry events, five exhausted errors**. Do not poll/restart the old
session. This was a deliberate implementation reload for source inspection,
not a response to an observation timeout. The new command was:

`node scripts/acquire.mjs run --takeover --retry-errors --inspect-review --search-buffer 4096`

It paused and drained the briefly resumed web workers without killing them;
acquisition started **11:50:14.659 UTC**. Web queues must remain paused while
this runner owns YouTube. Existing admission history and cooldown survived.
At **11:50:42.189 UTC**, the allowance was deliberately returned to **96 per
ten minutes**, keeping **two download workers, one search, autoStep false**.
No new bot/429 trip occurred. The 104 trial did not establish an improvement:
its complete **11:38:00.271–11:48:00.271 UTC** window produced **94 MP3s,
88 searches, eight media-403 retries, zero bot trips, zero long outputs**.
All 94 files independently passed codec/duration/new-inode verification.
That is **9.4/min**, compared with the cleaner 96 trial's **9.55/min over
twenty minutes**. The first eight 403s all recovered with cookie retries, but
a second batch of eight failed with 403 during the graceful drain and was
preserved for retry. Do not blindly raise to 112 because 104 accepts starts.

**Source inspection is live and exercised:** all ten original sources were
inspected through the CLI owner at **11:50:38–11:50:46 UTC**, with no inspection
errors. It charges download admission credits, shares the same process pool,
and never counts as an MP3 success. `source-review.json` is mode 0600 and
retains only allowlisted public recording/chapter fields. New normal download
events now include the source evidence too; 34 such events were observed by
11:56:36 UTC. `inspect-review` can schedule unresolved source inspection on
this compatible live worker without a restart, but its projection does not
include descriptions or multi-result candidate search. Do not run standalone
YouTube probes outside this owner.

**Two real repairs completed and verified locally** using `scripts/acquire/repair.mjs`:

- Kleiber/Vienna Beethoven 5 I: source `PPl8nIbzMj0`, verified first chapter
  **0–442 seconds**. All three canonical playlist links now contain the
  **442-second** movement rather than the full symphony.
- Rostropovich/Karajan/Berlin Dvorak concerto I: source `dPlMZmmH3b0`, first
  chapter **0–942 seconds**, matching the catalog. Its canonical file is now
  **942 seconds**, not the full concerto.

Original recordings are hard-linked intact under ignored
`data/acquire/preserved-originals/0eb1046c90c2fec7203f191d-169242343/original.mp3`
and `data/acquire/preserved-originals/aa4d6575d3a609a9164ad8ad-169242782/original.mp3`.
Their combined **136,325,468 bytes** remain recoverable outside `downloads/`.
Adjacent `repair.json` manifests record source/chapter rationale, original and
replacement SHA-256, each changed target and final verification. Independent
post-repair checks passed all four canonical paths, MP3 durations, catalog-key
tags, replacement hashes and intact original hashes. Both ledger entries are
`resolved`; repair outputs did not inflate new-download counters. No blind
catalog-duration trimming was used. **27 CLI tests pass**, including actual
temporary audio repair, preserved originals, atomic playlist-link replacement,
changed-target refusal, source inspection, controls and all prior safeguards.
`git diff --check` passes.

**Eight content repairs remain, all original files still intact.** The six
previously suspected entries now also have independent recording-catalog
duration evidence, stored in the ledger. Inspection changed the next action:

- Mehta/Munich Brahms 1 I actually selected **Karajan 1987**, source
  `-B9nERqEmUA`; do not cut the wrong performer into the requested track.
- Maag/LSO Mendelssohn 3 IV selected **Orozco-Estrada/hr-Sinfonieorchester**,
  `rw6slNXSzNg`; needs a new matching source.
- Queyras/Prague Dvorak concerto III selected **Kobekina/Tonhalle Zurich**,
  `wBFeeOt_SGY`; needs a new matching source.
- Wang/Dudamel Rachmaninoff 3 I: `5bX_yRzCuM4` title only identifies Wang;
  chapter 15–1052 is much longer than the requested 15:50. Confirm the
  orchestra/conductor or select the correct recording; do not blindly cut.
- Jansons/BRSO Beethoven 6 and Ott/Salonen/BRSO Grieg sources identify the
  expected performers (ARD Klassik) but expose no chapters.
- Haitink/Persson/Stotijn Mahler 2 title and total duration agree with the
  intended recording, but available chapters group multiple movements;
  do not treat 0–2547 as the requested first movement.
- Poska/Flanders Beethoven 2 IV uses an expected-performer source with
  chapter 1528–1909 (381 seconds) versus catalog 373. Check the ending or
  recording/cut before accepting it. The repair helper's ordinary 2%/3-second
  corroboration tolerance deliberately does not blindly accept this difference.

The five old exhausted cookie jobs were reopened and have each returned
**age-verification-requires-cookies** twice so far despite cookie-backed
attempts; they are Sigur Ros / Fjogur Piano, Asher / Say It Right, Prae Chanaa /
Kluen, Preecha Padpai / Kod Sao Tiang and K Scope / The Setup. These are not a
missing-cookie-file problem. Their bounded retry state remains live; evaluate
an alternate matching source/client within owner policy later instead of
claiming that another cookie export alone fixes them.

At **11:56:16.188 UTC**, the new owner was verified live with **31 new MP3s,
13,500 bulk acquisitions remaining, eight content repairs, 52.6962 GB** of
unique-inode MP3s under `downloads/`, and no new bot trip. At **11:56:36 UTC**,
cross-run last-thirty-minute output including the handoff was **8.3667/min**
(2.789x baseline), last ten **6.3/min**. At that 30-minute rate the bulk ETA
was **13 September 21:51 ICT**, buffered **14 September 04:34 ICT**. The new
run-only startup average is lower because inspection/inherited admission
credits and retries consume time. Distinguish these rate scopes; never present
the 9.6/min allowance as achieved output. Bulk ETA excludes the eight repairs.
The full goal remains active and substantially unfinished.

### Earlier operational checkpoint — 11:38 UTC: clean 20-minute 96 trial; testing 104

**Keep the same live worker:** PID **58761**, exec session **60669**, run
`2026-09-12T06-45-57-172Z`. Do not restart merely to inspect it. The 96 retry
completed **11:17:35.313–11:37:35.313 UTC** with **191 newly published MP3s,
188 searches, zero blocks, and zero new retries**. This is **9.55 MP3 files/min,
3.183x the 3/min baseline**, across a full twenty minutes, beyond the earlier
96/three-worker failure at 16.912 minutes. Independent ffprobe, nonempty file,
new-inode and creation-time checks passed all **191 distinct files/inodes**.
This validates file publication, not recording identity; ten long-form
movement selections in this interval are flagged separately below. Excluding
all ten leaves 181 other files / 20 minutes = 9.05/min, still not a claim of
manual identity verification for those other files.

At **11:38:00.271 UTC**, only the allowance was raised **96 to 104 per ten
minutes**, retaining **two download workers and one search worker**,
`autoStep: false`, the immediate first-block stop and safety floor. The CLI's
manual validation ceiling was extended from 96 to this specific next trial,
104, with a test rejecting 105 without changing the control file. No backend
restart or queue handoff occurred. The first full 104 window ends
**11:48:00.271 UTC**. Its opening partial-minute burst is in-flight carryover,
not an achieved 24/min or sustainable 10.4/min. Check real completions and
block/retry counts before any further increase.

At **11:38:37.729 UTC**, the same verified owner had **736 new MP3s this run**,
**13,628 unique bulk acquisitions remaining**, **51.7069 GB** unique-inode
MP3s, rolling ten-minute rate **9.6/min**, thirty-minute **9.3/min**, and
unchanged 53 retries. Both Bull queues were directly checked paused, active
zero, preserving **2,738 download / 13,582 search** jobs. At the completed
96-profile rate of 9.55/min, the bulk ETA was **13 September 18:26 ICT**, or
**14 September 00:23 ICT** with a 25% time buffer. Repair time is excluded.

**Content review now has ten unresolved entries, not one/four.** Four have
recording-catalog duration evidence and status `needs-repair`: Kleiber
Beethoven 5 I, Rostropovich/Karajan Dvorak concerto I, Jansons Beethoven 6 I,
and Ott/Salonen Grieg concerto I. Six more single-movement titles produced
30–82 minute files and are `needs-review`: Poska Beethoven 2 IV, Maag
Mendelssohn 3 IV, Haitink Mahler 2 I, Queyras Dvorak concerto III, Wang/Dudamel
Rachmaninoff concerto 3 I, and Mehta Brahms 1 I. Exact paths, original inodes
and bytes are in mode-0600 ignored `data/acquire/quality-review.json`. All
originals and playlist links remain intact. Do not call these content-verified
tracks, blindly trim at rounded catalog times, delete originals, or launch
YouTube probes outside the sole CLI owner. Known content review blocks overall
goal completion; bulk ETA excludes review/repair duration.

**New source-evidence capture is staged, not yet loaded by this live PID.**
`scripts/acquire/source.mjs` changes only the existing download's after-move
print projection, retaining public video ID/title/duration/performer/channel
and bounded chapter boundaries. It deliberately excludes full yt-dlp info
documents, signed media URLs, cookies and headers. Transport passes this
allowlisted evidence to `mp3_verified` events on the next normal run; no extra
YouTube requests. This is not a content-repair implementation and has not yet
been exercised on a real download. The old live worker still emits its old
result shape. **23 CLI tests pass**, including projection, streamed callback,
privacy, exact 104 control and all prior ownership/rate/reporting coverage;
`git diff --check` passes. A deliberate future graceful reload for implementing
repair/evidence may use `--retry-errors` to reopen the five old cookie errors,
but do not restart just for a status refresh or those five jobs.

### Earlier operational checkpoint — 11:24 UTC: 96 retry active; one content repair

**Keep the same live worker:** PID **58761**, exec session **60669**, run
`2026-09-12T06-45-57-172Z`. At **11:17:35.313 UTC**, only the allowance was
raised **88 to 96 per ten minutes**, retaining **two download workers and one
search worker**, `autoStep: false`, and all first-block emergency trips.
This is a deliberate retest of the earlier failed allowance under lower
download concurrency (2 rather than 3), lower search load, and available
recovery material. The first complete ten-minute checkpoint is
**11:27:35.313 UTC**; the earlier failure happened after about 17 minutes,
so check beyond **11:34:35 UTC** before treating a short result as sustainable.

The completed 88-profile first window **11:06:16.315–11:16:16.315 UTC**
produced **89 new MP3s and 90 searches**, no blocks or new retries, and no
long-form outputs. Independent checks passed **89 distinct files/inodes and
89 distinct source video IDs**, with valid MP3 durations and catalog-key tags.
Work already in flight at the setting change explains why output can slightly
exceed the 8.8/min admission ceiling; do not project a sustainable 8.9/min from
that boundary. The earlier failed 96 trial had 200 searches in its first ten
minutes, not 90. The completed entire 88 phase was 105 MP3s / 11.3166 minutes,
including boundary work; this is not a steady-rate claim.

At **11:23:34.390 UTC**, the verified live owner had **588 new MP3 files in
this run**, **13,777 unique acquisitions remaining**, **49.6731 GB** of unique-
inode MP3s, a rolling ten-minute file rate of **9.5/min**, and a thirty-minute
rate of **8.8333/min**. Retries remained 53 and no new block had occurred.
Both web queues were directly rechecked paused with active zero and all
**2,738 download / 13,582 search** jobs preserved. Cookie permissions remained
0600 and free disk was 163.60 GB at the earlier 11:10 check.

**New content-quality issue, not a network failure:** the file published at
**11:18:01.031 UTC** for `Ludwig van Beethoven, Wiener Philharmoniker, Carlos
Kleiber - Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio` is **2012.043917
seconds (33:32)**. The [recording catalog](https://classical.music.apple.com/us/recording/ludwig-van-beethoven-1770-pp27-1644892939)
lists the requested first movement as **7:21** and the whole work as about
33 minutes. This is a duration/segment mismatch; exact source-recording
identity and a correct movement boundary still need verification.

The original **61,760,758-byte inode 169242343 on device 16777233** and all
three playlist links (Classical Essentials, Epic Classical, This Is Beethoven)
remain untouched. Exact paths and evidence are in the new mode-0600 ignored
`data/acquire/quality-review.json`. Its status is **needs-repair**. Do not
blindly truncate at the rounded catalog duration, discard the source, or
launch YouTube work outside the CLI owner. A correct matching movement or a
verified segment repair remains part of the unfinished goal.

Reader-only reporting now exposes **contentReviewPendingUnique: 1** and
**completionBlockedByContentReview: true**, without restarting the live writer.
MP3 rate/counts still mean codec/duration/file publication, not verified musical
identity. Bulk ETAs exclude unresolved repair time. A corrupt review ledger
also blocks completion. **21 CLI tests pass**, including this distinction.
Do not mark the goal complete just because the bulk remaining count reaches
zero. The five earlier cookie-dependent exhausted jobs also still need
`--retry-errors` on the next normal run; do not restart solely for them.

### Earlier operational checkpoint — 11:06 UTC: verified 8.0/min, now testing 88

The **2-download/1-search, 80-per-ten-minute** profile completed its first full
window, **10:55:39.848–11:05:39.848 UTC**, with **80 new MP3s and 80 searches**:
**8.0 MP3/min, 2.667x the user's baseline (+166.7%)**. There were zero blocks,
zero additional retries and zero long-form outputs. Independent checks passed
all **80 files / 80 new inodes**, positive MP3 durations, and artist/title tags
matching their catalog keys. A separate earlier audit also passed all 188
post-cookie-recovery files checked; those audits overlap and must not be summed.

At **11:06:16.315 UTC**, only the allowance was raised **80 to 88 per ten
minutes**. Download concurrency remains 2, search concurrency 1, `autoStep`
false, and all first-block guards enabled. This is a bounded next throughput
test below the earlier failed 96 setting, not a restart or queue handoff.
The first complete 88-profile window ends **11:16:16.315 UTC**. Work already
in flight at the change completed immediately afterwards, so its initial
very high partial-minute rate is a boundary burst, not achieved 28+/min.

At **11:06:30.703 UTC**, the same verified live PID **58761** / session
**60669** had **431 new MP3s in this run**, **13,934 unique remaining**, and
**47.7803 GB** of unique-inode MP3s. Two downloads and one search were active;
retries remained 53 with no new block. The latest rolling ten-minute rate was
7.9/min; the completed fixed 80-window result above was 8.0/min. The new
**8.8/min ceiling is not yet a sustained result**. At that ceiling only, the
conditional ETA was **13 September 20:30 ICT**, or **14 September 03:06 ICT**
with a 25% work-time buffer. At the proven ten-minute rate of 8/min, the
provisional projection remains about **13 September 23:08 ICT / 14 September
06:24 ICT buffered**. Keep the same worker running and revalidate live state.

### Earlier operational checkpoint — 10:58 UTC: two downloads, one search, 80/ten minutes

**Latest live sample, 10:57:58.462 UTC:** same verified PID/session, **366 new
MP3s in this run**, **13,999 unique remaining**, **47.3316 GB** unique-inode
MP3s. Latest rolling ten-minute output: **7.9 MP3/min, 2.633x baseline**;
the window includes tuning changes and is not a fixed-profile claim. The
allowance remains 80, two download workers and one search worker; retries
remain 53 with no new blocks. One download process was active at that sample.
The 2+1/80 first complete ten-minute checkpoint remains **11:05:39.848 UTC**.

Acquisition remains owned by **PID 58761 / session 60669**, run
`2026-09-12T06-45-57-172Z`. The user explicitly challenged passive waiting
at the 40-URL cap and prioritized increasing actual throughput. Two further
single-lever changes have now been applied without restarting or resuming
the preserved Bull queues:

1. **10:53:15.837 UTC:** download concurrency **1 to 2**, keeping search at 1
   and the allowance at 64. The previous download worker was almost fully
   occupied but eight admission credits remained unused. Five completed
   eight-song batches took 346.304 process-seconds in total, with roughly
   23–29 seconds until their first output. The second worker filled the unused
   credits and overlapped executable/network startup. The 1+1/64 phase ended
   after **40 MP3s / 6.3423 minutes**, with no blocks or additional retries;
   all 40 files independently passed codec, duration, and new-inode checks.
2. **10:55:39.848 UTC:** allowance **64 to 80 URLs per ten minutes**, keeping
   download concurrency 2 and search concurrency 1. The completed added-worker
   batches had filled the cap without new errors. The 2+1/64 phase produced
   24 MP3s in 2.4002 minutes, but included already-in-flight work at its start;
   do not present its burst rate as a sustained ten-minute result.

At **10:56:27.999 UTC**, the verified live owner reported **351 new MP3s in
this run**, **14,014 unique remaining**, and **47.2256 GB** of unique-inode
MP3s. Two download processes and one search process were active at **80/80**
admissions. Retries remained at **53**, with no new block since 09:55 UTC.
The latest rolling ten-minute output was **7.1 MP3/min, 2.367x baseline**;
that rolling window spans the tuning changes, not a fixed 80-profile test.
The new profile's first full ten-minute window ends **11:05:39.848 UTC**.
`autoStep` remains false and every first-block emergency trip remains enabled.

At the 8/min ceiling, the provisional capped ETA was **13 September 23:08
ICT**, or **14 September 06:26 ICT** with a 25% work-time buffer. The 80 setting
was the fastest prior clean ten-minute profile; the earlier 96 setting failed
after about 17 minutes. Continue acquiring and use actual output, admission
utilization, failures, and that known failure history to guide further tests.
Do not restart merely to observe or reopen the five old cookie errors.

### Earlier operational checkpoint — 10:47 UTC: increased allowance to 64

The user challenged why throughput was still being held at the current limit.
The **40-per-ten-minute allowance was an operator-selected recovery test, not
a demonstrated YouTube maximum**. Read-only verification at 10:46:25 UTC
showed both pools idle, 40/40 admissions used, no new retries, and the same
verified live owner. The allowance, not available worker concurrency, was
the immediate bottleneck. Continuing to wait for thirty minutes was delaying
the user's stated throughput priority.

At **10:46:55.297 UTC**, only the allowance was increased to **64 URLs per
ten minutes**. The same PID **58761**, session **60669**, remains running
with **one download plus one search process**, `autoStep: false`, and all
first-block trips enabled. No worker restart, queue resumption, cookie export,
or other YouTube probe occurred. The new **6.4 MP3/min ceiling is a target,
not an achieved rate**. Its first full ten-minute window ends
**10:56:55.297 UTC**. Use measured utilization and output to guide the next
single-lever change; do not retain the superseded thirty-minute hold below.

The completed 40-URL phase delivered **80 MP3s in 18.0907 minutes**, with
zero blocks, zero additional retries, and zero long-form outputs. Its first
complete ten-minute result remains **40 MP3s = 4.0/min (+33.3% over baseline)**.
There is no thirty-minute result for that setting. At the change, **14,085
unique songs remained**, using **46.5939 GB** of unique-inode MP3 storage.
At the new 6.4/min ceiling only, the conditional ETA was **14 September
06:28 ICT**, or **14 September 15:38 ICT** with a 25% work-time buffer.

### Earlier operational checkpoint — 10:39 UTC: clean 4.0 MP3/min ten-minute result

The new **1-download/1-search, 40-URL/ten-minute** profile completed its first
full window, **10:28:49.853–10:38:49.853 UTC**, with **40 newly verified MP3s
and 40 completed searches**, zero block signals and zero additional retries.
That is **4.0 MP3/min, 1.333x the user's 3/min baseline (+33.3%)**, including
executable startup, conversion, and the idle admission-window tail. An
independent post-publication audit passed all **40 distinct new files/inodes**
for MP3 codec, positive duration, and creation during the trial. No output was
longer than thirty minutes. All 20 CLI regression tests also passed.

At **10:38:53.703 UTC**, PID **58761** / session **60669** remained the verified
live owner, with one download and one search process starting the next window.
This fifth run now has **240 new MP3s**; **14,125 unique songs remain**, using
**46.2567 GB** of unique-inode MP3 storage. Retries remain at 53. The current
phase average at that snapshot was **3.9745/min**, giving **15 September
04:53 ICT**, or **15 September 19:41 ICT** with a 25% work-time buffer.

**Do not increase another lever yet.** The same worker continues unchanged;
the first thirty-minute measurement ends **10:58:49.853 UTC**. No sustained
thirty-minute claim is available yet. Both original Bull queues were directly
verified paused with active zero and all **2,738 download / 13,582 search**
jobs preserved. All 26 existing library rows covering the first 23 files after
cookie recovery were Completed with their stale errors cleared. Cookie-file
permissions remain 0600. No browser/session values were exposed.

### Earlier checkpoint — 10:28 UTC: authenticated recovery and 40-URL trial

The same live CLI (PID **58761**, session **60669**) completed **eight new
MP3s after the authorized cookie export**, bringing this run to **200 new
MP3s**, **14,165 unique remaining**, and **45.8830 GB** of unique-inode MP3s.
Retries stayed at 53. Its most recent complete ten-minute window was
**0.8 MP3/min**, reflecting the safety-floor allowance, not a throughput win.

At **10:28:49.853 UTC**, with both owned pools idle, only the admission
allowance was deliberately raised to **40 URLs per ten minutes**. Download
and search concurrency remain **one each**, `autoStep` remains false, and
all first-block emergency trips remain enabled. The control was applied
without restarting the worker or resuming either Bull queue. Measure this
new phase separately; its **4/min ceiling is not an achieved rate**. The
first complete ten-minute window ends **10:38:49.853 UTC** and the first
thirty-minute window ends **10:58:49.853 UTC**. The earlier 96-profile burst
and its long recovery holds are not part of this new phase's rate.

At the new ceiling only, the conditional completion projection was
**15 September 04:30 ICT**, or **15 September 19:15 ICT** with a 25% work-time
buffer. Replace that projection with measured output once the window matures.
Keep the same worker alive and inspect `status`/`benchmark`; do not launch
independent YouTube probes or increase another lever during this measurement.

### Earlier operational checkpoint — 10:19 UTC: authorized cookie export completed

The user explicitly requested that the agent obtain YouTube cookies from their
logged-in main Chrome. **18 YouTube-only cookies** were exported through the
existing bridge at `127.0.0.1:17331` to the configured `cookies.txt`. The export
is Netscape-format, mode **0600**, and Git-ignored. Authentication-cookie
presence and format were checked without printing names or values. No new
DevTools WebSocket, browser instance, or tab activation was used. Spotify
cookies were not collected. `scripts/export-youtube-cookies.mjs` records this
scoped export procedure and refuses to overwrite an unexpectedly nonempty file.

The existing CLI detected the file automatically: at **10:19:49 UTC**, its
verified live owner reported `recoveryCookiesAvailable: true`, recovery wait
zero, and **one search plus one download process** at the unchanged safety
floor. No restart or pace increase was performed. At **10:20:19 UTC**, the
same worker had published **four additional verified MP3s** after the cookie
export, bringing this run to **196 new MP3s**, **14,169 unique remaining** and
**45.8398 GB** of unique-inode MP3s, with no additional retries at that check.
The cookie-bearing recovery path is therefore producing actual audio again;
this is not yet a sustained-throughput benchmark. Additional anonymous work had completed
between earlier holds before the user returned. The earlier credential-access
block below is now historical; revalidate current results before resuming work.

### Earlier operational checkpoint — 08:07 UTC

The one-hour wait did **not** restore downloads. The same live CLI (PID **58761**,
session **60669**) resumed at the **1-download/1-search, 8-admissions/ten-minute
safety floor** around 08:04:34 UTC. One search completed, but **no MP3** was
produced. A second download bot/rate-limit signal at **08:04:55.415 UTC** killed
both owned processes after about 21 seconds. There was no process timeout.

The configured `cookies.txt` is still a regular **zero-byte file**; only its
metadata was checked, never its contents or browser credentials. The runner is
again held, with next anonymous-recovery eligibility at **09:04:55 UTC /
16:04:55 ICT**. It remains the verified live owner; do not restart it, resume
the web queues, raise the pace, or run independent YouTube probes during this
hold. Both Bull queues remain paused with active zero, and all completed files
and 2,738 download / 13,582 search jobs are preserved.

Current fifth-run totals: **152 new MP3s, 337 completed searches, two blocks**;
**14,217 unique songs remain**, using **45.4157 GB** of unique-inode MP3 storage.
Current profile output is **0/min**, so no measured ETA exists. Conditional on
successful recovery at the 0.8/min cap: **25 September 00:16 ICT**, or
**28 September 02:19 ICT** with a 25% work-time buffer. The full first-hour
result remains **2.533/min, 15.6% below baseline**; the initial 9.2/min burst is
not a sustained win.

The previous goal turn proved the safety-floor retry also fails after the
required wait. A third consecutive goal-turn check at **08:09:36 UTC** again
confirmed session **60669** live, the PID/Redis owner valid, no new MP3s, and
the configured recovery file still zero bytes. The strict blocked threshold
is now met: acquisition cannot make further meaningful progress without
upstream access recovering or usable authorized recovery material. The goal
is being marked **blocked, not complete**. No authority to extract/repair
browser credentials was granted, and none were accessed.

This goal-status change does **not** stop or restart the existing CLI. It
remains in its guarded background wait, with the next recovery eligibility
above. All queues and completed files stay preserved. If the user resumes
the goal, revalidate the same handle/state and begin a fresh blocked audit;
never relabel an observation timeout as a stopped worker.

### Trial history and implementation

- Read `ACQUIRE.md` and `scripts/acquire.mjs`. No Spotify resync is part of this
  experiment. The comparison baseline is **3 verified MP3s/minute**.
- First run `2026-09-12T05-40-52-799Z`: **51 new MP3s / 10.921 minutes =
  4.670/min (+55.7%)**, 144 searches, no bot/rate-limit trip. Three download
  failures were the same unresolved Sigur Rós track; successes were verified
  with ffprobe and published before being counted. Local reuse linked 66
  songs and was excluded from throughput. The first full ten-minute window
  contained 42 MP3s (4.2/min). Graceful stop/handback was exercised successfully.
- Second run `2026-09-12T05-53-06-257Z` completed: **57 MP3s / 17.285 minutes
  = 3.298/min (+9.9%)** including the long graceful drain. Its first complete
  ten-minute window was 47 MP3s (4.7/min, +56.7%). Two cached selections were
  eight and ten hours long, materially extending the drain. All files and jobs
  were preserved; there was no new rate-limit trip.
- Third run `2026-09-12T06-11-36-278Z` completed cleanly with **155 MP3s in
  15.005 minutes**. That whole-run average contains startup bursts and a profile
  change; do not promote it as sustained throughput. Its **80-URL-only first
  complete ten-minute window produced 80 MP3s = 8.0/min, 2.67x baseline (+167%)**,
  with zero rate-limit trips and zero long-form outputs. The 80 phase began
  06:16:33.146 UTC and ended 06:27:40.779 UTC (96 MP3s total / 11.127 minutes).
  Independent post-publication ffprobe audit passed all 92 files checked.
- Fourth run `2026-09-12T06-27-41-871Z` completed cleanly with **139 new MP3s
  and 256 search results / 13.232 minutes**. Its first full ten-minute combined
  window delivered **80 MP3s and 213 search results**, zero rate-limit trips,
  and zero counted MP3s predating the run. Local reuse was excluded. Two
  long-form outputs were retained for review. The runtime's remaining counter
  overcounted by three because it excluded legitimate dot-prefixed filenames;
  the files were present and the acquisition counter was independently valid.
- **Current fifth run:** `2026-09-12T06-45-57-172Z`, PID **58761**, exec session
  **60669**, command `node scripts/acquire.mjs run --takeover --window 96
  --search-buffer 4096`. Acquisition began **06:47:39.542 UTC** after graceful
  handoff. It tested **3 download + 1 search processes**, autoStep false, with
  a 9.6/min admission ceiling. Its **first complete ten-minute interval delivered 92 new MP3s
  (9.2/min, 3.07x baseline, +206.7%) and 200 completed search results**, with
  zero rate-limit trips. Independent post-publication audit passed all 92
  MP3 codec/duration checks and confirmed every file was created within the run.
  **The profile then failed at 07:04:34.242 UTC**, after **152 MP3s / 16.912
  minutes (8.988/min before the trip)**. One bot/rate-limit signal immediately
  killed the owned process groups and tripped to **1 download + 1 search,
  8 admissions/ten minutes**, autoStep false. No clean thirty-minute result
  exists. Do not promote the earlier 9.2/min sample as sustainably achieved.
  The same PID/session remains alive, waiting for the existing one-hour
  recovery policy to expire at **08:04:34 UTC / 15:04:34 ICT**. Keep it intact;
  do not send independent YouTube probes or raise the pace during recovery.
  Verify all state live before acting. All 152 completed MP3s independently
  passed post-stop codec/duration and creation-time checks; the one long output
  is the explicitly named `Earth, Vol. 7 - Continuous Mix` (72.8 minutes).
- Recovery checkpoint: **14,217 unique remaining**, **45.4157 GB** unique-inode
  MP3 data, **0 measured MP3s/min for the recovery profile**. No measured ETA
  exists while held. Conditional on successful recovery at the 0.8/min cap:
  **24 September 23:15:49 ICT**, or **28 September 01:18:38 ICT** with a 25%
  work-time buffer. Both Bull queues have active zero and remain paused
  (2,738 download and 13,582 search jobs preserved at the checkpoint).
- Whole-experiment audit at **07:15:39.555 UTC**: all five runs contain **554
  distinct new file keys / 554 distinct inodes**, nonempty and born during their
  respective runs, plus 732 completed searches and one block. From the first
  acquisition start **05:41:56.220 UTC**, the 93.722 wall minutes include every
  intervening handoff and the ongoing hold: **5.911 new MP3s/min, 1.97x baseline**.
  This mixed-profile aggregate is time-specific, declines during the hold, and
  must not be confused with current output (zero) or sustainable 96-profile
  throughput. No new YouTube probes were needed for the audit.
- The fifth run's **complete first hour, 06:47:39.542–07:47:39.542 UTC**, is
  now independently counted from its event log: **152 MP3s + 336 searches,
  one block; 2.533 MP3s/min including downtime, 15.6% below baseline**. The
  recovery phase's first complete 30-minute window has zero outputs. The
  aggressive setting is therefore not a sustained win despite its clean
  9.2/min initial sample. The same session **60669 / PID 58761** has been
  repeatedly polled live through **07:48 UTC**, not restarted; recovery
  eligibility remains **08:04:34 UTC**, with the counts/disk above unchanged.
- The fifth run loads all current safeguards and accounting fixes, including
  global missing-recovery-material waits, correct dot-prefixed artist/playlist
  indexing, direct known-destination reuse, and publication returning whether
  it actually created a file. A concurrently appearing existing destination is
  now local reuse, never a new MP3 success. There is no pending runtime restart
  required for those changes. Keep this run intact through recovery.
- The short atomic publication paths, corrected admission reservations,
  empty-cookie fast failure and nonfatal pace mirror outages are implemented.
  Backend filename alignment was applied only after backend activity reached
  zero; Nest reloaded while the third CLI retained ownership. All 18,977 saved
  songs were audited for CLI/web filename parity, with zero mismatches or
  overlong file/folder segments.
- The configured cookie file is zero bytes (metadata checked only, contents
  never read). Five cookie-dependent tracks are explicitly parked as errors;
  fresh anonymous work is now held by global bot recovery. Do not harvest browser sessions or mutate
  credentials merely to repair this. `--retry-errors` can reopen them once
  the configured recovery material is repaired.
- `status` and the ordinary reporter now separate the current profile's measured
  rate/ETA from the whole-run audit average and from the conditional admission-
  cap ETA. `currentProfileMp3PerMinute` is zero during the new recovery phase;
  `eta` is null and `etaAtAdmissionCeiling` explicitly conditional. The reporting
  changes apply to readers immediately without restarting the live writer.
  The future writer uses the same normalization. `benchmark` separates profiles,
  ignores unchanged control reapplications during stop, and leaves incomplete
  10/30-minute windows null. All normalized ETAs use the current profile's
  average, capped by admission and including the recovery wait. Earlier raw
  result/status snapshots may contain whole-run or uncapped burst ETAs; use the
  reporters for normalized estimates, not the raw writer's old fields.
  The ordinary reporter's top-level historical ETA fields now also honor the
  current CLI profile/floor while ownership is live; they are null during this
  zero-output recovery phase, rather than projecting the prior fast rate.
- **Both Bull queues are intentionally paused while the CLI owns acquisition.**
  All jobs are preserved. Nest and Angular remain running. Do not resume the
  web queues during a CLI run: the ownership guard will stop CLI children if
  that happens. Use the CLI's status/control commands, not the backend pace API,
  to control the active experiment.
- `node scripts/acquire.mjs status` checks the actual PID and Redis owner.
  State/journal/logs are under `data/acquire/`. Use Node 20.19.4. The ordinary
  `scripts/yt-progress-report.mjs` now counts CLI publication events as well as
  web events, and exposes a separate `acquisition` object with verified owner,
  CLI-only rate, remaining count, ETA, buffer and disk usage.
- Normal `node scripts/acquire.mjs stop` drains current batches, hands the
  recent admission/cooldown history back, and restores original queue pause
  states. A crash resume merges both histories without erasing batch credits.
  The stop command now omits any prior pace instruction, preventing a stop from
  silently reapplying an old fast profile after a safety-floor trip. This fix
  works with the existing live worker; it does not require a restart.
  Do not infer completion from a stopped CLI: inspect remaining songs and
  exhausted retries.
- Browser verification passed: 841-playlist load, selecting 2023, a newly
  acquired MP3 playing with time advancing, and successful Pause. The temporary
  verification tab was closed. The existing user tab belongs to another browser
  automation session and was left alone. CLI activity counts currently live in
  the CLI reporter; the web UI still represents the preserved paused Bull jobs.
- Known remaining checks: observe recovery at the safety floor, then evaluate
  sustainability without assuming permission to override autoStep false. Review unusually long cached YouTube
  selections (saved metadata lacks expected duration). Long filenames are now
  handled consistently by CLI, backend playback and ordinary progress reports.
  Twenty CLI tests plus 49 reused backend tests pass. Full artist/title match
  review is not implied by codec/duration verification.
  The bulk acquisition is still running; this goal is not complete.

**Written:** 2026-09-11 02:15 UTC\
**Repo:** `/Users/dom/src/spooty`\
**Owner machine:** macOS, Node 20.19.4 via nvm (`/Users/dom/.nvm/versions/node/v20.19.4/bin`)\
**App:** Spooty 2.4.1 (NestJS backend :3000 + Angular 19 UI :4200), TypeORM sqlite, BullMQ+Redis, yt-dlp + ffmpeg.

This document is for an agent (or human) resuming the same job: **finish MP3s for every track in the user’s Spotify playlists, while raising YouTube/yt-dlp throughput as far as it will go without a ban (429 / bot-check).** Completing the remaining ~18k unique songs is **days**, not a single session. Do not treat queue-empty as a session gate.

## 2026-09-11 12:33 ICT checkpoint (supersedes the live counts below)

- **16,653 unique open songs are reported.** Unique-inode MP3 storage is
  unchanged at **22.134 GB / 2,523 files** across 4,310 playlist paths. The
  short decrease since 11:38 is from six diagnostic rows moving to terminal
  error, not from new MP3s; do not mistake it for download progress.
- A pinned bgutil 2.0.0 HTTP provider now runs on loopback `:4416`, and its
  official plugin ZIP is loaded only for post-bot download recovery. Ordinary
  anonymous work and ordinary age-gate fallback remain `android_sdkless`.
- Three bounded two-URL POT batches generated tokens without a 429/bot signal,
  but initially returned only `Requested format is not available`. The batch
  path no longer repeats unresolved POT members through an identical unbatched
  call; it preserves the first sanitized yt-dlp error and lets Bull delay a
  later retry.
- A one-URL format probe found the actual cause: the bundled yt-dlp 2026.08.19
  could not solve YouTube's current `n` challenge under Node 20 and therefore
  saw storyboard images only. Repeating with the already-installed Node
  22.13.0 as yt-dlp's **EJS-only runtime** exposed normal audio formats. Nest
  and the provider remain on the required Node 20.19.4 stack.
- Runtime now sets
  `YT_JS_RUNTIME_PATH=/Users/dom/.nvm/versions/node/v22.13.0/bin/node`; both
  batched and unbatched yt-dlp calls use `--js-runtimes node:<path>`. The two
  queues are paused at zero active work until 12:37 ICT so the two manual
  format probes and six recorded starts together remain within the physical
  8-start/10-minute safety floor. Resume download only for a bounded two-song
  canary; keep search paused until that creates verified MP3s.
- Backend build, `git diff --check`, and **115 tests / 17 suites** pass. The
  formal 12:30 rolling 120-minute rate is cooldown-dominated at 0.067 MP3/min,
  which mechanically projects 3 March 2027 raw / 16 April buffered and is not
  representative of the last clean ~4.6 MP3/min ceiling.

## 2026-09-11 11:38 ICT checkpoint (supersedes the live counts below)

- **16,656 unique songs remain and 16,656 unique open rows remain.** Unique-
  inode MP3 storage is **22.134 GB / 2,523 files** across 4,310 playlist paths.
  The latest local-only pass hardlinked 8 playlist rows / 7 song identities and
  pruned 8 obsolete search jobs, bringing locally reusable open work to zero.
- The real YouTube block persists on both the anonymous `android_sdkless` route
  and the fresh cookies + `android_sdkless` fallback. Confirmed attempts at
  11:08, 11:13, and 11:18 all failed in about 21--23 seconds; every first
  signal killed the download/search process groups and left no orphan process
  or batch temp directory.
- Live pace remains at the mandatory **1 download + 1 search / 8 starts per 10
  minutes** floor with `autoStep=false`. A manual 30-minute recovery cooldown
  is active until about 11:49 ICT rather than repeating a known-bad probe every
  4--5 minutes. Do not override it. The pace gate now also enforces this going
  forward: a repeated floor block within one hour automatically backs off for
  15--30 minutes (`YT_REPEAT_BOT_*`) rather than using the initial 3--6 minute
  cooldown again.
- A scheduler starvation bug was fixed: for one hour after a confirmed bot
  event, every post-cooldown search and download evaluates the persisted signal
  at actual pace admission and starts cookies + `android_sdkless`, even if its
  Bull job entered the wait before the signal. Cookies-required mode now fails
  closed when the configured file is unavailable instead of silently retrying
  the anonymous route. `YT_DOWNLOAD_COOKIE_FALLBACK_MS` controls the shared
  one-hour recovery window. Search recovery includes batch and unbatched paths,
  does not duplicate the cookie attempt, and does not bypass a fresh bot signal
  inside the same attempt.
- A stale durable-state bug found through live browser testing was fixed.
  Recovered jobs now reset `Downloading -> Queued` and `Searching -> New` before
  waiting; only the yt-dlp `onStart` transition advertises active work. The UI
  now correctly shows `0 downloading · 0 searching` throughout the cooldown
  while preserving 17 queued playlists.
- A deterministic `LibraryService` test exposed an equal-sized truncation bug:
  the incomplete Spotify response became the pending write candidate before its
  `truncated` flag was rejected. Assignment now happens only after that guard,
  and the test proves the pre-existing dump bytes remain unchanged. Equal-count
  snapshot refresh and idempotent local-MP3 hardlink reuse are covered too.
- Backend build, `git diff --check`, and **109 tests / 17 suites** pass on Node
  20.19.4. Live browser verification passed 841-playlist load, needs-work-first
  ordering, incomplete playlist detail, real MP3 Play -> Pause -> stopped, safe
  CDP-down Spotify sync fallback, queue visibility, and the stale-active fix.
- Logical URL admissions now emit `download_start` events. Combined with the
  monitor's API-only live control writes, this makes batch start accounting
  auditable without letting the watchdog clobber `downloadStarts` in the pace
  state file.
- The isolated 11:49 post-cooldown canary did start exactly one two-URL
  cookies+sdkless batch, but YouTube still returned a bot check after 12 seconds:
  2 logical starts, 0 verified MP3s. The global kill left no media child or batch
  directory, and the new repeated-floor policy selected a roughly 27-minute
  cooldown ending around 12:17 ICT. Both queues are resumed behind that gate.
- Nest now defaults its unauthenticated API listener to `127.0.0.1` rather than
  all interfaces. `BIND_HOST` is configurable for an intentional proxy setup;
  live `lsof`, direct API, and Angular proxy checks passed after restart.
- The installed yt-dlp is the current stable **2026.08.19** release and the
  cookie file was freshly updated at 10:31 with mode 0600, so neither an old
  extractor nor an obviously stale cookie export explains the block.
- At 11:35, rates were 0.0 MP3/min (10m/30m/60m) and 1.867 (120m). The
  120-minute rate projects **17 Sep 16:18 ICT raw / 19 Sep 05:29 ICT with 25%
  buffer**. The queue was briefly paused for a controlled source reload; all 15
  active pace waiters were recovered without deletion, the loopback backend was
  verified, and both queues were resumed behind the unchanged cooldown.

## 2026-09-11 11:00 ICT checkpoint (supersedes the live counts below)

- **16,656 unique songs remain.** Unique-inode MP3 storage is **22.134 GB /
  2,523 files** (4,302 playlist paths).
- The no-cookie download path remains genuinely bot-blocked even at the 1+1/8
  floor. Single recovery probes at 10:43, 10:49, and 10:53 all tripped fresh
  cooldowns. Do not override the persisted floor/cooldown.
- Download batching is now deployed behind `YT_DOWNLOAD_BATCH_SIZE` (default
  `1`) and is live-canarying at **2 unique URLs per yt-dlp process**. The
  backend was restarted with Bull download ceiling 12, search ceiling 3,
  search batch 3, and conservative environment fallbacks 1+1/8; persisted pace
  remains authoritative.
- Batch downloads use a controlled ID-named temporary directory, verify
  non-empty outputs, atomically copy to independent arbitrary playlist paths,
  deduplicate duplicate URLs, attribute progress/results per video ID, reserve
  sliding-window starts per unique URL, emit success per verified unique URL,
  and clean exact temp directories on completion/shutdown.
- A first live two-URL batch started correctly with one yt-dlp process. The
  existing bot block fired before media could complete. The new emergency stop
  tripped pace once, killed the concurrent download and search process groups,
  cleaned the temp directory, and scheduled both download rows as
  `youtube-retry-1-cookies-first`. No orphan yt-dlp/ffmpeg remained.
- The delayed retry path now starts cookies + `android_sdkless` after the
  mandatory cooldown when a persisted or marked prior error is a true bot
  signal. Age restrictions remain non-rate-limit and retain the normal
  no-cookie then cookies + `android_sdkless` fallback. Legacy pre-upgrade retry
  names infer cookies-first from their persisted error after row reload.
- Node 20.19.4 backend build and **92 tests / 16 suites** passed, including
  batch result/progress/duplicate/partial/shutdown cases, global kill-all,
  logical pace accounting, new marked retries, legacy retry migration, and age
  gate distinction. All 13 patched files byte-matched the clean replay.
- At 11:00, block-affected rates were 0.0 MP3/min (10m), 0.70 (30m), 1.90
  (60m), and 3.142 (120m). The 120-minute rate projects **15 Sep 03:21 ICT raw /
  16 Sep 01:26 ICT with 25% buffer**. Queue state was 439 download waiting + 12
  pace-gated + 4 delayed, and 18,580 search waiting + 3 gated + 3 delayed.

## 2026-09-11 10:35 ICT checkpoint (superseded by 11:00 above)

- **16,656 unique songs remain.** Unique-inode MP3 storage is **22.134 GB /
  2,523 files** (4,302 playlist paths).
- Search batching is implemented behind `YT_SEARCH_BATCH_SIZE` (default `1`).
  The live batch-3 canary used three Bull search workers feeding one paced
  no-cookie `android_sdkless` yt-dlp process. It correctly mapped real
  `--dump-single-json` results by original query, completed **33 searches in
  10.24 minutes (3.22/min)**, and did not increase search-process concurrency.
  Backend build and all **62 tests / 12 suites** passed under Node 20.19.4.
- The same window completed **41 MP3s in 10 minutes (4.10 MP3/min)**, but at
  10:34:39--10:35:02 all five in-flight downloads received genuine
  `Sign in to confirm you're not a bot` responses. Each affected yt-dlp was
  killed as soon as its own output exposed the block, and the first signal
  moved the live system to its required floor: download 1 + search 1, 8
  download starts / 10 minutes, with cooldown. Do not clear or override this
  confirmed trip.
- Safety follow-up for the next naturally drained backend restart: the first
  blocked process was killed immediately and closed the global pace gate, but
  the other four already-running download process groups were not proactively
  killed; they each continued until receiving the same block over the next 23
  seconds. On the first confirmed rate signal, `YoutubeService` should kill all
  tracked yt-dlp process groups, not only the process whose output carried the
  signal. Add a concurrent-process regression test before deploying that fix.
- An earlier age-restricted video (`Sign in to confirm your age`) exposed an
  over-broad classifier and caused a false floor trip. The rate-limit matcher
  now detects explicit `not a bot` rather than every `sign in to confirm`.
  Age restrictions still take the existing cookies + `android_sdkless`
  fallback. Regression tests cover both age variants and the real bot variant.
- Because the confirmed block occurred at the end of batch 3, the planned
  batch-6 search step was **not** attempted. Search batching itself stayed
  clean; wait for the required floor/cooldown and a later clean recovery before
  considering another throughput step.
- The 10:35 rolling 30-minute rate was pause/block-affected at **2.93 MP3/min**;
  the 120-minute rate was **3.525 MP3/min**, projecting **14 Sep 17:20 ICT raw /
  15 Sep 13:01 ICT with 25% buffer**.
- Live browser verification after the patch passed: all 841 playlists loaded,
  needs-work sorting and active states were correct, new completions appeared
  in playlist detail, and a real local MP3 toggled Play -> Pause -> Play.

## 2026-09-11 10:08 ICT checkpoint (superseded by 10:35 above)

- **16,731 unique songs remain.** Unique-inode MP3 storage is **21.353 GB /
  2,448 files** (4,227 playlist paths). Both queues remain live; 442 download
  jobs are waiting and continue to provide runway.
- The measured practical maximum is `downloadConc=5`, `searchConc=1`,
  `maxPerWindow=64`, `autoStep=false`. The latest clean uninterrupted 5+1
  confirmation made 47 MP3s in exactly 10 minutes (**4.70 MP3/min**); an
  earlier sample made 46 in 10.10 minutes (**4.552 MP3/min**). A one-step 6+1 probe made 44 in
  10.18 minutes (**4.324 MP3/min**) with zero blocks, about 5% slower, so live
  pace was restored to 5+1 without restarting or interrupting the queues.
- At 10:08 the rolling 10-minute rate was **4.6 MP3/min**, the 30-minute window
  **4.53**, and the 60-minute window **4.47**, with zero blocks. The 30-minute
  rate projects **13 Sep 23:39 ICT raw / 14 Sep 15:02 ICT with 25% buffer**.
- Earlier direct samples were: 3+3 = **2.41 MP3/min**, 3+1 = **3.635**, 4+1 =
  **4.036**, 5+1 = **4.552**, and 6+1 = **4.324**. All of these samples were
  block-free. The 10-minute start ceiling is not binding.
- A controlled audio-only-first selector probe (`ba/bestaudio/best/18`) made 45
  MP3s in 10.38 minutes (**4.333 MP3/min**), below the original no-cookie
  `18/ba/bestaudio/best` selector, so the original was restored. Both pauses
  naturally drained every active job before the watcher restarted.
- The packaged 35 MB universal yt-dlp takes about **59--69 seconds** even for
  `--version` while the pipeline is busy (roughly 0.75 seconds CPU). Sampling
  shows its PyInstaller child importing extracted Python modules and spending
  most wall time in macOS `dyld` validation/`fcntl`; this launch path, rather
  than media transfer or ffmpeg, is the next credible throughput bottleneck.
- A supported PyInstaller `TMPDIR=/tmp/spooty-ytdlp-runtime` launch test was
  inconsistent (51.4 then 63.2 seconds) and was not adopted. The exact required
  `ytdlp-nodejs/bin/yt-dlp_macos` remains in production.
- A live 5-download/2-search split made 41 MP3s plus 18 searches in 10 minutes
  (**5.90 total operations/min**). Clean 5+1 made 47 MP3s plus 12 searches in
  10 minutes, the same 5.90 total operations/min but 13% more files on disk.
  Therefore 5+1 was restored live without pausing or restarting.
- macOS slept for about 15 minutes during the first 5+1 attempt and caused Bull
  `Missing lock` wake errors. A persistent tmux window
  `spooty-backend:keep-awake` now runs `caffeinate -is`; both user-idle and
  system sleep assertions are active without holding the display awake.
- Nest was cleanly drained and restarted with Bull ceilings download **6** /
  search **3**. The live pace gate, not the idle sixth worker, holds actual
  yt-dlp work at the measured 5+1 allocation. Do not restart merely to lower
  the worker ceiling.
- Controlled local-audio sweeps during the throughput work reconciled 39 more
  rows and pruned 41 satisfied jobs. The first larger sweep at 08:03 reconciled
  178 rows and removed 177 jobs.
- Tmux window `spooty-backend:reuse-sweeper` runs the guarded local-only cycle
  every 30 minutes with a 100-candidate threshold. The first pass correctly
  skipped at 99 rows; when the threshold is met it naturally drains both
  queues, hardlinks already-present sibling audio, prunes satisfied jobs, and
  resumes in `finally`.
- Its first applied pass completed in 86 seconds: 139 rows / 98 normalised keys
  were hardlinked, then 7 satisfied download jobs and 132 search jobs were
  removed. Both queues resumed automatically and local reusable open rows
  returned to zero.
- No YouTube bot/429/API-page event occurred during the clean allocation tests.
  The first confirmed event must still kill that yt-dlp immediately and trip
  globally to 1 download + 1 search / 8 starts per 10 minutes.

## 2026-09-11 08:00 ICT checkpoint (superseded by 09:15 above)

- **17,200 unique songs remain.** The formal 10-minute rate is **2.5
  MP3/min**; the clean 3+3 stage produced 57 MP3s and 66 searches in 23.6
  minutes (**2.41 MP3/min**, **2.79 searches/min**) with zero blocks.
- The canonical 30-minute rate is **2.23 MP3/min**, down 0.77/min from 07:30
  because the window contains the controlled backend drain/restart. The direct
  3+3 stage is about 32% faster than the earlier 2-download/3-search sample.
- Hold `downloadConc=3`, `searchConc=3`, `maxPerWindow=64`, `autoStep=false`.
  Download concurrency 4 remains the known failing boundary; the window is not
  binding at 25 starts/10 minutes.
- ETA from the stable current stage is **early 16 Sep raw / 17 Sep with real-world
  buffer**. The more conservative formal 30-minute projection is **16 Sep 16:21
  ICT raw / 18 Sep 00:27 buffered**.
- Unique-inode MP3 storage is **16.612 GB / 1,979 files** (3,391 paths). At the
  observed 8.39 MB average, the projected final library is about 161 GB; current
  free space leaves roughly 70 GB margin.
- The full website audit and architecture are in `WEBSITE_AUDIT.md`. Live browser
  verification covered library load, needs-work ordering, filter/sort, playlist
  detail, real local play/pause, queue drawer, and CDP-down resync safety.
- The whole-library enqueue button is now disabled while any queued/searching/
  downloading work exists. Local MP3s, Spotify dumps, Redis state, and scratch
  coverage reports are now ignored by Git.
- At 08:03 a controlled natural drain reconciled 178 reusable rows (162 new
  hardlinks and 16 existing files) and removed 177 satisfied Bull jobs before
  both queues resumed. The reconciliation apply guard now requires both queues
  paused with both download and search active counts at zero.
- `scripts/local-reuse-cycle.mjs` wraps that workflow: dry-run by default;
  `--apply` requires at least 50 candidates, refuses an already-paused queue,
  naturally drains active work, runs reconcile/prune, and resumes in `finally`.
  Its SIGINT-during-drain path was exercised live and both queues resumed.
- CDP `:17331` remains down, so private Spotify discovery/resync still needs one
  user-approved main-Chrome connection. The saved library and YouTube pipeline
  do not require CDP and remain fully operational.
- Two audit follow-ups are deliberately deferred: all legacy dumps lack a
  trusted snapshot baseline, and Nest listens on `*:3000`. Fix the baseline
  semantics and bind Nest to `127.0.0.1` at a controlled queue drain; do not edit
  backend source under watch while live yt-dlp processes are active.

## 2026-09-11 07:40 ICT live update (supersedes the recovery snapshot below)

- The zero-request recovery succeeded. Both download and search are live, and the URL-ready queue is holding around 780 rows instead of draining.
- A generic media-data `HTTP Error 403` is now correctly treated as a video/client retry, not a global YouTube block. Only bot-check, 429, or `Unable to download API page` trips the pace gate.
- Clean one-lever samples established download 3 / window 64 and search 3 as healthy. The live allocation is now `downloadConc=3`, `searchConc=3`, `maxPerWindow=64`; its first nine MP3 completions and matching search batches were clean. The window is not binding at roughly 20–30 starts/10 minutes.
- Live pace changes now interrupt workers sleeping on the old window/cooldown. Previously the 8→16 update left four workers idle until the original ten-minute timer expired. Regression coverage is in `youtube-pace.spec.ts`; backend Jest is **45/45 passed**.
- Backend is in tmux `spooty-backend:backend` on Node 20 with Bull ceilings download **4**, search **3**. The durable pace gate is `3/3/64` with `autoStep=false`; download concurrency 4 remains the known failing boundary.
- At 07:40: **17,249 unique sources remain**, 30-minute rate about **2.9 MP3/min**, ETA **15 Sep raw / 16 Sep with 25% buffer**, and disk is **16.198 GB / 1,931 unique MP3 inodes**. Canonical progress remains `node scripts/yt-progress-report.mjs`.
- The emergency path was corrected to match `AGENTS.md`: the first confirmed bot/429/API-page failure kills that yt-dlp, records the attributed failing lever, applies a real cooldown, and globally trips to search 1 / download 1 / window 8. Backend Jest remains **45/45 passed**.
- Hold `3/3/64` for a longer unattended sample. On the first confirmed block, let the backend trip globally; do not classify a bare media 403 as a block.

## 2026-09-11 06:22 ICT takeover update (supersedes the live snapshot below)

- Backend and pace monitor are durable tmux windows in session `spooty-backend`; frontend is live on `:4200` and backend on `:3000`.
- A fresh 8-way probe produced 7 bot-checks and one MP3. A later floor probe produced 8/8 bot-checks. This is an active YouTube block, not queue starvation.
- **Both Bull queues are intentionally paused for a zero-request recovery window. Do not resume before 06:56 ICT.** Resume download only at first; leave search paused because 969 download rows already provide runway.
- Guarded tmux window `spooty-backend:resume-download` is scheduled for **06:56:09 ICT** (`scripts/resume-download-at.mjs`). It will refuse to resume if pace is no longer exactly 1×8 with `autoStep=false` or if either queue is unexpectedly unpaused.
- Pace is `downloadConc=1`, `searchConc=1`, `maxPerWindow=8`, `autoStep=false`. After a clean floor sample, raise one lever at a time.
- The current backend process uses Bull worker concurrency download **4** and search **3** (startup ceilings 4×64); the persisted live pace gate is what holds actual yt-dlp work at 1×8 during recovery.
- SQLite: status 0 = 19,281 rows; status 2 = 849; status 4 = 2,987; status 5 = 8 genuine no-result rows. Filename-normalized status 0–3 = **17,361 keys**, all of which now genuinely need a source MP3; local reusable open rows are zero.
- A guarded local-only sweep created 762 hardlinks and reconciled 6 existing files, completing 768 rows without YouTube or extra unique-inode bytes. It then pruned 769 satisfied paused jobs. Bull is now download `paused=849 active=0`; search `paused=19,281 active=0`.
- Two orphaned watch-mode backend children were stopped and their 24 jobs were recoverably moved back to the paused list. One backend and one Redis now remain.
- Disk: **15.143 GB / 1,819 unique MP3 inodes**. Current 30/120-minute rates and ETAs are pause-dominated; establish a fresh rate after the 06:56 floor resume before using an ETA for planning.
- Requeued 150 transient bot/timeout/search failures without duplicates. `node scripts/requeue-transient-errors.mjs` is dry-run; add `--apply` only for the reported eligible rows.
- yt-dlp now uses dedicated process groups; timeout/rate-limit kills the whole packaged-binary tree, and search/download timeouts default to 90s. Transient failures use delayed 15/30/60-minute Bull retries instead of occupying workers. Download-start history persists across backend restarts. Cover-art fetch failure no longer turns a valid MP3 into an error.
- Full backend Jest: **44/44 passed**; backend type-check, frontend app/spec type-checks, and production frontend build passed. Browser: library selection, local MP3 play/pause, filtering, sort changes, the active-queue drawer, and a completed-playlist download no-op passed; live download state updated. Playlist auto-resync was exercised but failed because CDP `:17331` is down. Restarting only `scripts/cdp-keepalive.mjs` still requires one user Chrome **Allow** click.
- `node scripts/yt-progress-report.mjs` is the canonical status command. It reports unique remaining songs, 10/30/60/120-minute throughput, rate-derived ETA plus a 25% buffer, unique-inode MP3 usage, Bull queue state, and live pace state; use `--write` to update the comparison snapshot.
- Search and download workers now reload current SQLite state and reuse a verified Completed sibling MP3 before touching YouTube. `LibraryService.download()` also links local audio before deciding an existing row should be skipped/retried.
- Same-song work is serialised inside the backend, so higher concurrency cannot search or download duplicate playlist rows simultaneously; the follower reuses the URL or completed MP3.
- Search and download now pass exactly `android_sdkless` to yt-dlp: first without cookies, then cookies plus the same client only. No implicit `android`, `mediaconnect`, or `web` client is included.
- The UI default is now `Needs work first`: active and incomplete playlists precede terminal/done playlists, finished rows no longer win merely because they have stale queued siblings, the focused-resync timer is disposed correctly, and equal-count resyncs refresh the UI. Live browser verification showed incomplete `2023` at the top instead of a done playlist.
- `SpotifySessionService` now obtains its sole background session only from keepalive `GET /tab`; it no longer calls `Target.createTarget` or `Target.attachToTarget` itself.
- Opening the UI now starts incremental Spotify library discovery, uses snapshot IDs/counts to resync only new or changed playlists, and sorts unfinished work first. Full architecture, audit findings, verification, and remaining work are in `WEBSITE_AUDIT.md`.
- `REDIS_RUN=false` is now parsed correctly (rather than spawning a second Redis because the string was truthy). `scripts/recover-stale-active.mjs` is the guarded paused-queue recovery tool.
- `scripts/reuse-local-audio.mjs` and `scripts/prune-satisfied-queue-jobs.mjs` are dry-run by default and require `--apply`; both refuse unsafe live-queue conditions.

To resume download only after the recovery window:

```bash
cd /Users/dom/src/spooty/src/backend
export PATH="/Users/dom/.nvm/versions/node/v20.19.4/bin:$PATH"
node - <<'NODE'
const { Queue } = require('bullmq');
(async () => {
  const q = new Queue('track-download-processor', { connection: { host: '127.0.0.1', port: 6379 } });
  await q.resume();
  console.log({ paused: await q.isPaused(), counts: await q.getJobCounts('waiting', 'active', 'paused', 'delayed') });
  await q.close();
})();
NODE
```

Watch the first eight download starts/results. Keep 1×8 on any bot; if all are clean, test `maxPerWindow=16` before raising download concurrency. Keep search paused until download health is established.

---

## 1. Goal (what “done” means)

1. Every non-excluded playlist track that can be found on YouTube exists as an MP3 under `downloads/` (skip files already on disk; hardlink copies across playlists).
2. Throughput is **maximised without getting banned**. The first confirmed
   429/bot-check/`Unable to download API page` kills that yt-dlp process and
   trips the global pace gate to 1 download + 1 search / 8 starts per 10 minutes
   with cooldown. A bare media-data HTTP 403 is not a global block.
3. User-facing progress is **MP3s/minute** and **ETA vs last report**, not theoretical cap dates.

### Explicit non-goals / bans from the user

- No torrents / Pirate Bay.
- No lectures about legality.
- **Never** open a **new** Chrome DevTools WebSocket, never `Target.activateTarget`, never an extra “Allow” loop. The only CDP path is the existing keepalive HTTP bridge (see §6).
- Do **not** print cookies/tokens in chat.
- Do **not** `POST /api/library/download-remaining` unless the **download wait queue is empty**. Re-queuing the whole library duplicates Bull jobs.
- Hard-exclude algorithmic playlists: Daily Mix(es), DJ, Discover Weekly, Release Radar, On Repeat, Repeat Rewind, Daily Drive.
- Do not raise the 10-minute window as a vanity “384/h” target. The window is a ceiling; we have never filled 64 or 96.
- Nest `--watch` **wipes `dist/`**. Durable sqlite **must** be `/Users/dom/src/spooty/data/spooty.sqlite` (`DB_PATH`). Never a db under `dist/`.

---

## 2. Current live snapshot (at handover)

| Item | Value |
|---|---|
| Unique remaining (status 0–3, `artist\|\|name`) | **17,753** |
| Unique on disk (status 4 distinct names) | ~1,607 |
| Rows status 4 / 5 | 2,208 / **128** |
| Status 2 queued (have YouTube URL, waiting download) | **791 rows / 741 unique** — search is **ahead** of download |
| Playlists in sqlite | 841 |
| Pace | `downloadConc=8`, `searchConc=6`, `maxPerWindow=96` |
| Freeze | **TRIP downloadConc** bot-check → 8. `lastGood.downloadConc=8`, `lastFail.downloadConc=9` |
| lastBotAt | 2026-09-10 ~14:44–15:15 UTC (three bot events) |
| Unique MP3 disk | **15.13 GB** (1,817 inodes / 2,455 paths; hardlinks) |
| Volume free | **207 GB** (was ~341 GB at session start — watch disk) |
| Nest | **running** `npx nest start --watch` from `src/backend` with env below |
| UI | `ng serve` :4200 (restarted after 10h wrapper kill; detached nohup) |
| Redis/Bull | download `active 12 wait ~785`; search `active 6 wait ~20k` |
| CDP keepalive `:17331` | **DOWN** (wrapper 10h kill; reconnect needs Chrome **Allow** on the existing browser WS) |
| 30-min progress scheduler | `01a08a18795c73e1b1ac09eade3ce30c` every 30 minutes |

**Nest env (process that is live):**

```
DOWNLOADS_PATH=/Users/dom/src/spooty/downloads
STATIC_PLAYLISTS_PATH=/Users/dom/src/spooty/PLAYLISTS_2026-09-08/playlists
COOKIES_PATH=/Users/dom/src/spooty/cookies.txt
DB_PATH=/Users/dom/src/spooty/data/spooty.sqlite
DOWNLOAD_CONCURRENCY=12
SEARCH_CONCURRENCY=6
YT_YTDLP_CONC=12
YT_SEARCH_CONC=6
YT_DOWNLOAD_PER_WINDOW=96
YT_SEARCH_GAP_MIN_MS=400
YT_SEARCH_GAP_MAX_MS=1200
YT_DOWNLOAD_GAP_MIN_MS=800
YT_DOWNLOAD_GAP_MAX_MS=2500
```

BullMQ `@Processor` concurrency is **class-load / process-start**. Pace JSON can say 8 while 12 workers exist; extra workers wait on `YoutubePace` slots. To actually run N download workers you **restart Nest** with `DOWNLOAD_CONCURRENCY=N` and `DB_PATH` pointing at `data/spooty.sqlite`.

---

## 3. How the pipeline works

```
Spotify playlist (dumps / session / spclient)
    → sqlite track_entity (status 0 New)
    → Bull queue track-search-processor
        → YoutubeService.findOnYoutubeOne (yt-dlp ytsearch1)
        → status 2 Queued + youtubeUrl
    → Bull queue track-download-processor
        → YoutubeService.downloadAndFormat (yt-dlp + ffmpeg → mp3)
        → hardlink into playlist folder under downloads/<playlist>/
        → status 4 Completed or 5 Error
```

**Statuses:** 0 New, 1 Searching, 2 Queued, 3 Downloading, 4 Completed, 5 Error.

**Unique remaining** for ETA:\
`SELECT COUNT(DISTINCT artist||'|'||name) FROM track_entity WHERE status IN (0,1,2,3)`\
Playlist copies of the same song share one unique; unique remaining can stay flat while path-count/hardlinks grow. That is not a stall.

**Disk:** count **unique inodes**, not `du` of every path. Hardlinks share bytes.

**Skip on disk:** already-downloaded files are skipped; do not re-download.

**YouTube search argv** (`src/backend/src/shared/youtube-search-args.ts`): first attempt `android_sdkless`, **no cookies**. Cookies only as fallback. “No YouTube result” is a miss, **not** a 429.

**YouTube download:** `android_sdkless` first, then `cookies+sdkless` if retryable. ffmpeg `/opt/homebrew/bin/ffmpeg`. yt-dlp from `ytdlp-nodejs`.

**URL reuse:** `src/backend/src/track/track-url-reuse.ts` — if another row with same artist+name already has `youtubeUrl`, skip search.

**Spotify:** session via Chrome tab + CDP keepalive (when up). Playlist paging in `spotify-playlist-v2.ts`. Private API 429s are **Spotify**, not YouTube — do not trip YouTube pace for those.

---

## 4. YoutubePace (the throughput brain)

**Files:**

- `src/backend/src/shared/youtube-pace.ts` — slots, window, per-lever trip, midpoint probe
- `src/backend/src/shared/youtube-pace.spec.ts` — Jest
- `src/backend/src/shared/youtube-pace.controller.ts` — `GET/POST /api/youtube/pace`
- `src/backend/config/yt-pace.json` — durable state (Nest cwd = `src/backend`)
- `src/backend/config/yt-events.jsonl` — `download_ok` / `search_ok` / `bot`
- `src/backend/config/yt-progress-last.json` — last 30-min report snapshot
- `scripts/yt-progress-report.mjs` — canonical progress, ETA, disk, queue, and pace report (`--write` persists the snapshot)
- `scripts/yt-pace-monitor.mjs` — watchdog; must **not** smash all levers to 1×8

**Levers (independent):**

| Lever | Meaning | Floor | Cap in code | Live |
|---|---|---:|---:|---:|
| `downloadConc` | concurrent yt-dlp **downloads** | 1 | 12 | **8 (frozen)** |
| `searchConc` | concurrent yt-dlp **searches** | 1 | 6 | **6** |
| `maxPerWindow` | download **starts** per 10 min | 8 | 96 | 96 (never filled) |

`conc` in the JSON/API is an alias of `downloadConc`.

**Courtesy gap** is slept **before** acquiring a slot (`sleepReady`). Another job can take a slot during the gap.

**429 / bot-check:**

- `isYoutubeRateLimit()` matches 429/bot/unable-to-download-api-page and **ignores** local `errno 65` / no route to host. A bare media-file 403 is video/client-specific and proceeds to the cookies+sdkless fallback instead of tripping the global gate.
- stderr chunk in `YoutubeService.run` **kills that yt-dlp** and `tripRateLimit(lever)`.
- `tripRateLimit` is **idempotent** once that lever is at last-good (`cur <= lastGood` and `lastFail` set). Chunk + post-run + retry must not smash 8→1.
- Download 429 must **throw** inside `pace.run` so it is **not** counted `download_ok`.
- Search 429 must not freeze download conc (monitor checks `liveTrip` first; `inferTripLever(reason)`).

**Binary-search probe:** after `cleanMsToStep` (15 min) with no bot, `maybeStep()` sets lever to `probeMidpoint(lastGood, lastFail)` — strictly between them, never ≥ last-fail.

### Freeze trap (read this)

Live: `lastGood.downloadConc=8`, `lastFail.downloadConc=9`.\
`probeMidpoint(8, 9)` is **null** (`fail <= good+1`).\
**The automatic probe will never try 10 or 12 again.** Raising download conc is a **manual** `POST /api/youtube/pace` (and Nest restart if you need more Bull workers). Doing that without fixing bot-check handling is how you get another hour of ~0/min.

---

## 5. What this session already did (chronology)

Work spanned 2026-09-10 (local +7 = evening into 11 Sep).

### Before the “five levers” goal

- Full-library resync 841 playlists; dumps ~23k tracks; Recents/embed caps documented.
- Durable sqlite moved to `data/spooty.sqlite` after nest `--watch` wiped `dist/.../db.sqlite`.
- YouTube pace: 8/10 min conc 1 → 16/2 → 32 → **64/10 min conc 4** (“8× trial”). Window never filled; observed ~16–29 finishes / 10 min because **search and download shared 4 yt-dlp slots** and each unique song is two yt-dlp calls.
- Measured: search wall ~80s (mostly slot wait), actual download+ffmpeg **~52s p50 ~41s**.
- CDP keepalive at `http://127.0.0.1:17331` (script `scripts/cdp-keepalive.mjs`); SIGTERM ignored, kill `-KILL` by PID in `/tmp/spooty-cdp-keepalive.pid`.

### Five levers (implemented in code)

1. **Download conc 8** (Bull `DOWNLOAD_CONCURRENCY=8`) — real lever vs raising the 64 window.
2. **Split pools:** search 1–2 (then 6) vs download 8 (then 12). Search no longer occupies a download slot.
3. **Search client:** first attempt android_sdkless, no `cookies.txt`.
4. **Gap does not hold a slot.**
5. **Reuse `youtubeUrl`** for same artist+name.

Plus: per-lever 429 freeze + midpoint probe; tests in `youtube-pace.spec.ts`, `youtube-search-args.spec.ts`, `track-url-reuse.spec.ts`.

### Aggression after “maximize, idc how”

- Search **2→6**, download **8→12**, window **64→96**, gaps cut to ~0.4–1.2s search / ~0.8–2.5s download.
- Nest restarted with those env vars (~14:04 UTC). Search filled 6 immediately; download was starved before because search was 2.

### Ban / freeze

- **14:44, 15:00, 15:15 UTC:** three `Sign in to confirm you’re not a bot` events on **download**.
- Freeze **downloadConc 12 → 8**. Probe **9** also bot-checked → lastFail=9, lastGood=8 → **stuck at 8**.
- Search 6 was **not** frozen.
- Status-5 errors climbed ~9 → **128**, almost all the same bot message (one row per video). Individual bot pages after the freeze often become status 5 instead of another global trip (idempotent trip).

### Overnight rate (UTC 30-min `download_ok` buckets)

Not a flat 3/min. Oscillation:

| Window | /min |
|---|---:|
| 13:00–14:30 | 2.4–2.6 |
| 14:30–16:00 | **1.5 → 0.1** (bot-check wave) |
| 17:00 | **3.2** |
| 18:00–19:00 | **0.2–0.6** |
| 20:00–20:30 | **3.2** |
| 21:00 | 1.7 (dip starting) |

Peak **~3.2 MP3s/min** = 8 download slots × ~2.5 min occupancy per file. Real ffmpeg ~50s; the rest is bot-check / cookies fallback occupying the slot (timeouts up to 180s).

**Why not stomp 12 again:** 12 is what triggered the freeze. Same 8 slots with fail-fast on bot is the next 2–3×, not more parallelism.

---

## 6. Chrome CDP (Spotify only)

YouTube download does **not** need CDP. Spotify playlist/token refresh does.

- Script: `scripts/cdp-keepalive.mjs`
- HTTP: `http://127.0.0.1:17331/health` → `{ ok, connected, endpoint, pid }`
- Reads Chrome `DevToolsActivePort` (recently `[historical browser endpoint redacted]`)
- **Standing order:** reconnect that bridge only. Never `chrome-devtools` MCP new socket, never `Target.activateTarget`.
- **Current:** process **dead**. Restart:

```bash
export PATH="/Users/dom/.nvm/versions/node/v20.19.4/bin:$PATH"
cd /Users/dom/src/spooty
rm -f /tmp/spooty-cdp-keepalive.pid
nohup node scripts/cdp-keepalive.mjs >> /tmp/spooty-cdp-keepalive.log 2>&1 &
disown
```

If log says `connect timeout — click Allow in Chrome`, the user must click **Allow** once. Wrapper `max_runtime` 10h previously SIGKILL’d the bridge; `nohup`+`disown` so it is not in the grok command process group.

Grok `run_terminal_command` `timeout: 0` + `background: true` is supposed to disable wrapper timeout; in practice a 10h cap still killed nest/ng/cdp. Prefer `nohup` for anything that must outlive the session.

---

## 7. How to take over (operational)

### Confirm the pipeline is still draining

```bash
curl -sS http://127.0.0.1:3000/api/youtube/pace
sqlite3 /Users/dom/src/spooty/data/spooty.sqlite \
  "SELECT COUNT(DISTINCT artist||'|'||name) FROM track_entity WHERE status IN (0,1,2,3);"
redis-cli llen bull:track-download-processor:active
redis-cli llen bull:track-download-processor:wait
```

If Nest is down, start it with the env in §2 from `src/backend`:

```bash
export PATH="/Users/dom/.nvm/versions/node/v20.19.4/bin:$PATH"
export DOWNLOADS_PATH=/Users/dom/src/spooty/downloads
export STATIC_PLAYLISTS_PATH=/Users/dom/src/spooty/PLAYLISTS_2026-09-08/playlists
export COOKIES_PATH=/Users/dom/src/spooty/cookies.txt
export DB_PATH=/Users/dom/src/spooty/data/spooty.sqlite
export DOWNLOAD_CONCURRENCY=12   # workers; pace still caps downloads at 8 until you unfreeze
export SEARCH_CONCURRENCY=6
# ... other YT_* as in §2
cd /Users/dom/src/spooty/src/backend
npx nest start --watch
```

After kill, **move Bull `active` → `wait`** and delete `:lock` keys or jobs sit 15 minutes (`lockDuration`). Do **not** `FLUSHALL` Redis.

**Do not** POST `/api/library/download-remaining` unless download **wait is 0** and unique remaining is still large (jobs lost). Last remaining enqueue was `queued=21851 skipped=1436` early in the session.

### UI

```bash
cd /Users/dom/src/spooty/src/frontend
npx ng serve --proxy-config proxy.conf.json --host 127.0.0.1 --port 4200
```

Proxy to :3000. Bulk buttons: resync-all, download-remaining.

### Progress reports

Scheduler id `01a08a18795c73e1b1ac09eade3ce30c`, **every 30 minutes**. Prompt: MP3s/min and ETA vs last snapshot file `config/yt-progress-last.json`. **Do not** mention “ceiling if 64/10 min filled.” Lead with throughput and ETA delta.

Events: `src/backend/config/yt-events.jsonl` type `download_ok`. Use **wall clock** last 30 min, not “30 min before last event” (that hides stalls).

### Tests

```bash
cd /Users/dom/src/spooty/src/backend
npx jest src/shared/youtube-pace.spec.ts src/shared/youtube-search-args.spec.ts src/track/track-url-reuse.spec.ts --runInBand
```

---

## 8. Recommended next work (priority order)

Do **not** start by posting `downloadConc: 12` again.

1. **Fail fast on bot-check (highest leverage)**\
   In `downloadAndFormat` / `run()`: on `isYoutubeRateLimit`, kill yt-dlp, **do not** cookies-retry, **do not** wait 180s. Throw, mark track error or retry later. Same 8 slots should approach ~8–9/min if occupancy returns to ~50s.\
   Watch: cookies fallback on bot often hangs and is what filled slots overnight.

2. **Don’t trip global freeze on every single bot video after the first**\
   Already partly idempotent. Ensure a lone “not a bot” on one video does not cool-off the whole pool for 3–6 minutes if already frozen at last-good. Individual failures → status 5, keep other slots working.

3. **Only then** retry download conc 9–12, with lastFail cleared or lastGood still 8 so a trip returns to 8, not 1.

4. **Restore CDP keepalive** if Spotify resync is needed (user clicks Allow).

5. **Disk:** 207 GB free vs ~18k unique × ~8.1 MB ≈ 145 GB more unique. Headroom OK but much tighter than this morning. Unique-inode GB is the number that matters.

6. **Status 5 (~128):** mostly bot-check. After fail-fast, consider a **slow retry** of those IDs (not a full remaining re-queue).

7. If `probeMidpoint` should retry 12 after a long clean window, change the algorithm (e.g. lastFail=12 still, probe 10). Today it will **not**.

---

## 9. File map

| Path | Role |
|---|---|
| `data/spooty.sqlite` | **Only** durable DB |
| `src/backend/.env` | `DB_PATH=.../data/spooty.sqlite` |
| `src/backend/src/shared/youtube-pace.ts` | Gate |
| `src/backend/src/shared/youtube.service.ts` | yt-dlp spawn, chunk-kill, throw on 429 |
| `src/backend/src/shared/youtube-search-args.ts` | Search argv |
| `src/backend/src/track/track-url-reuse.ts` | Skip search if URL exists |
| `src/backend/src/track/track.service.ts` | find/download; no extra tripRateLimit on retry |
| `src/backend/src/track/track-download.processor.ts` | `DOWNLOAD_CONCURRENCY` |
| `src/backend/src/track/track-search.processor.ts` | `SEARCH_CONCURRENCY` |
| `src/backend/config/yt-pace.json` | Live pace |
| `src/backend/config/yt-events.jsonl` | Throughput log |
| `scripts/cdp-keepalive.mjs` | CDP HTTP bridge |
| `scripts/yt-pace-monitor.mjs` | Watchdog (sqlite path **must** be `data/spooty.sqlite`) |
| `cookies.txt` | yt-dlp cookies; **do not paste** |
| `downloads/` | MP3s |
| `PLAYLISTS_2026-09-08/playlists` | Static dump used for resync |

---

## 10. User communication preferences

- No cap-ceiling ETA sermons. Throughput = **MP3s/min**. ETA = date + delta vs last ping.
- Report every **30 minutes**, not every 60s.
- Maximize throughput; they got angry when we only raised a unused window cap.
- After a 429 they still want speed, but “without us getting banned” is in force. Fail-fast + careful conc is the path, not ignoring bot-check.

---

## 11. Immediate health checks for the incoming agent

```bash
curl -sS http://127.0.0.1:3000/api/youtube/pace
curl -sS -m 2 http://127.0.0.1:17331/health   # expected down until Allow
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4200/
sqlite3 /Users/dom/src/spooty/data/spooty.sqlite \
  "SELECT COUNT(DISTINCT artist||'|'||name) FROM track_entity WHERE status IN (0,1,2,3);"
```

If pace `downloadConc` is 8 and `reason` starts with `TRIP downloadConc`, you are in the freeze described in §4. Do not “fix” it by slamming 12 without §8.1.
