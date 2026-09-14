# Handover: Spooty library MP3 backfill + YouTube throughput

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
- Reads Chrome `DevToolsActivePort` (recently `ws://127.0.0.1:64165/devtools/browser/7fe206ba-…`)
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
