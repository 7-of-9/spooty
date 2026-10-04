# YouTube acquisition CLI

## Web runtime compatibility — 15 September 2026

The retained `cli-proven` web profile uses the shared batch size 8, regardless
of deprecated `YT_SEARCH_BATCH_SIZE` / `YT_DOWNLOAD_BATCH_SIZE` values inherited
from older web-only launch commands. Custom profile mode still validates those
overrides. A blank `QUALITY=` means the documented MP3 quality 0; explicitly
incompatible format/quality settings still fail visibly. None of this raises
pace, changes the safety floor, resets admission history, or resumes queues.

The web activity strip reports current work separately from historical CLI
throughput. Its details show server-session counts: new publications, local
reuse, and other queue checks are separate. `/api/youtube/pace` exposes current
stage/names and the next scheduled queue time, without authentication material.

## Current discovery policy — 15 September 2026

The shared CLI/web search now tries up to three query variants, stopping on the
first title/artist/edition-and-duration match. `--max-searches 10` means ten
ranked results **per query** (at most thirty slots before ID deduplication), not
three network retries. At most two credible missing-duration candidates receive
paced metadata-only extraction. The ±5%/5–20-second duration guard is unchanged.
Latest per-candidate evidence lives in `data/acquire/search-diagnostics/` and is
available from the web track's **Search evidence** disclosure. See the CLI
README for exact limits, legacy-report behavior and unchanged parked-work rules.
Historical descriptions below of a single-query search describe the old policy.

The user promoted the CLI to a first-class entry point on14 September2026.
Start with **[the CLI README](scripts/acquire/README.md)** for supported commands,
all flags, restart behavior and the shared CLI/web pipeline. This file retains
historical experiment, recovery and audit evidence; old live PIDs and trial
startup flags below are historical, not instructions to restart accepted misses.

The acquisition path reads saved playlist JSON and SQLite's existing YouTube URLs. The
duration guard added on 13 September lazily hydrates missing Spotify track
durations through the existing logged-in session bridge; it does not rescrape
playlists. The target comparison is
**3 newly verified MP3s per wall-clock minute**.

The ordinary per-song path is entirely programmatic: use a saved URL or run
the CLI's batched YouTube search, download, convert, verify with ffprobe, tag,
publish and update durable state. There is no LLM/agent call or browser search
in that path. Agent web searches have been selective recording-quality audits
and exception repairs, performed while the independent CLI keeps running.
Duration matching does not establish recording identity; a wrong performance
or remix of similar length can still pass.

## Historical duration review

Historical artist/title review keys are preserved, not migrated destructively.
The shared SourceReviewIndex binds them to new Spotify source keys only through
explicit catalog/reference/audit IDs. Source inspection, historical-duration
snapshots, benchmark review reporting and replacement bookkeeping use that same
lookup. Unbound records stay unresolved; a duration replacement cannot certify
performer identity or resolve a multi-source group. Nothing is reopened or
repaired by reading this evidence. See the CLI README for inspection diagnostics.

The user-requested historical audit compares existing catalog MP3s with source
Spotify durations without downloading or replacing media. It snapshots every
physical copy (hardlinks count once), probes locally, then uses cached source
durations before conservatively hydrating missing metadata. It applies the
same fuzzy policy as new ingest: ±5%, minimum5 seconds, maximum20 seconds.
Missing metadata, conflicting Spotify editions and changed files are not
labelled probable bad. Unmatched paths are disclosed separately. Length-match
does not certify recording identity, and prioritizing extreme durations means
early results cannot estimate the library-wide error rate.

Run or resume only when its existing worker is no longer alive:

```sh
SPOTIFY_META_CONC=1 SPOTIFY_META_GAP_MS=1000 /Users/dom/.nvm/versions/node/v20.19.4/bin/node scripts/acquire/historical-duration-audit.mjs --gap-ms 1000
```

Artifacts live in `data/acquire/historical-duration-audit/`: `progress.json`
contains coverage and the audit-only ETA; `findings.json` contains source and
actual durations, tolerance, paths and verdicts; `snapshot.json` fixes scope.
Per-inode/source artifacts make the audit resumable. `--cache-only` performs
no Spotify lookup. For a later snapshot use `--output` with a new subdirectory
under that audit directory. A finished pass may retain unknown or unreadable
items, so `pass-finished` is not equivalent to complete duration certification.

`node scripts/acquire/mark-duration-audit.mjs --watch` incrementally annotates
the existing `data/acquire/quality-review.json` ledger. It rechecks current file
fingerprints and duration policy, preserves existing review evidence, and never
mutates media, queues or pace. Missing source duration is not marked bad.
The separately confirmed unreadable file has its own explicit unreadable
review entry. Marking status is `data/acquire/historical-duration-marking.json`.
Do not start duplicate marker workers. See the latest HANDOVER checkpoint for
live PIDs; both audit and marker run alongside the sole-owner acquisition CLI.

The active full audit now uses `SPOTIFY_META_CONC=1 SPOTIFY_META_GAP_MS=250`
and `--gap-ms 250`; the earlier one-second audit spacing remains an optional
conservative setting, not an enforced lower bound. The authenticated session
gate and Retry-After handling are still enabled. About225 comparisons/minute
were observed after resumption versus57/minute at one-second spacing.

For full physical coverage, `scripts/acquire/historical-duration-coverage-gap.mjs`
inventories every MP3 path (including previously unmatched files), probes all
physical files missing/changed from the first snapshot, and retains exact
metadata bindings from current, excluded and historical local playlist data.
It is entirely offline and preserves each cutoff under its `coverage-gap/runs/`
directory. `playlist-occurrence-bindings.json` keeps edition IDs per destination
instead of merging them across similarly named songs. The fixed-cutoff combined
report is generated by `node scripts/acquire/full-duration-report.mjs`; it
accounts for matches, mismatches, unreadable files, unknown identities, missing
durations and conflicting editions. Do not call a partial report complete.

## Automatic duration guard — 13 September 2026

New CLI runs and the web acquisition paths enforce the same Spotify-duration
policy: ±5%, with a minimum 5 seconds and maximum 20 seconds. The source duration
comes from saved metadata or a lazily populated private public-metadata cache
at `data/spotify-track-metadata/<SpotifyID>.json` (`SPOTIFY_TRACK_METADATA_PATH`
override). No cookies or tokens are stored there. Missing source duration or
conflicting source identity is retryable and cannot silently bypass the guard.

CLI search examines up to **10 ranked candidates per query** by default.
`--max-searches 5` selects five instead (allowed range1–50). Since 15 September,
up to three distinct query variants are tried automatically; candidate depth
is not the query count or the network-retry budget. See the current section at
the top for identity checks and bounded missing-duration inspection. The website
uses the same policy. Cached URLs are subject to the same
ID-bound yt-dlp duration filter **before media download**. An independent final
ffprobe check must also match Spotify before tagging/publication/Completed.
Rejected candidates are excluded and alternatives are scheduled through the
normal pools, never through an agent or a recursive worker call. No suitable
candidate is a durable `no-candidate`/needs-work outcome, not a network error
or fabricated Missing. Increasing `--max-searches` reopens a previously
exhausted candidate selection; restarting with the same limit does not loop it.
Only an explicitly empty successful search can establish no YouTube result.
CLI rejections persist in `data/acquire/duration-rejections.json` and never
consume failure counters. `--network-retries 5` independently permits five
additional network attempts (initial request plus five), with existing backoff
and global safety cooldown intact; range0–20. Non-network operational failures
keep their separate five-failure cap. `--retry-errors` only reopens exhausted
failure jobs. No file is silently trimmed.

The network budget counts CLI workflow repetitions, not individual HTTP
requests inside yt-dlp. Candidate-selection metrics are reported separately.
Only searched, duration-matched ready results fill the search buffer; untested
cached URLs cannot starve fresh search, and prepared results have download
priority. Exact ten-artist credit truncation is accepted for duration metadata
only when Spotify ID/title still match and the retained credits are an exact
prefix; changed artists/titles/IDs remain rejected.

After the explicitly authorized historical deletion, missing files are
reacquired through the ordinary catalog scan—no separate repair queue is needed.
Review annotations record deleted evidence and resolve duration-only flags
only after a newly verified replacement. Mixed-edition shared files and
unknown identities are preserved for separate review. See the latest HANDOVER
checkpoint, which supersedes the earlier activation snapshot below.

**Live activation:** the user requested a restart after implementation. PID27088
drained cleanly; guarded CLI PID53853 started at13:17:14 Bangkok on13 September,
run `2026-09-13T06-17-13-331Z`, session58366. It retained4 download/1 search,
240 admissions per ten minutes, admission history and cooldown. The first nine
guarded outputs were recorded by13:18:28, five independently reprobed against
Spotify; see `data/acquire/duration-rollout-20260913.json`. This is first-output
validation, not a completed guarded-throughput benchmark. Web workers remain
paused while the CLI owns YouTube. Historical files are not retroactively
duration-certified; existing content-review items remain separate.

For a read-only, offline filesystem check of a complete fixed-profile window:
`node scripts/acquire/audit-output.mjs --from <ISO-start> --to <ISO-end>`.
With no interval it selects the latest profile's last complete ten minutes.
It independently probes MP3 codec/duration, rejects duplicate keys/inodes,
staging and out-of-tree paths, flags benchmark exclusions and known recording
reviews, and reports actual bytes. `--details` includes per-file evidence.
It never launches YouTube work, changes a queue, or writes any files.

## Recovery resumed — 13 September 2026

Latest user direction: **autonomous throughput trials are authorized again;
continue unattended without interrupting the healthy CLI.** This supersedes
the earlier hold. At 08:56 Bangkok on 13 September, download concurrency alone
was raised from 2 to 3; search1, batch8,168 admissions/ten minutes, buffer192,
autoStepfalse remained unchanged. That first ten-minute window yielded172
independently verified MP3s (17.2/min,5.73x baseline), including transition
carryover; not a claim of sustained output above the16.8/min allowance.
At09:07 Bangkok only the allowance was raised to192/ten minutes; download3,
search1,batch8,buffer192 remain unchanged. Refresh live state and measure a
complete window before treating a trial as proven. Preserve safety trips/cooldowns and
recover failures without routine questions. Updates must include catalog songs
actually on disk / total, unique-inode GB, actual rate and Bangkok local ETA.

At09:18:10.589 Bangkok, download concurrency alone rose3→4, keeping192
admissions/ten minutes,search1,batch8,buffer192. The completed3/1/192 first
ten-minute trial produced181 independently codec-verified MP3s,18.1/min,
6.0333x baseline, no blocks/retries. Two full-album recording mismatches are
explicitly flagged in its audit; this is not blanket recording-identity proof.
Evidence: `data/acquire/audit-20260913-three-workers-192-10min.json`.
The four-worker/192 first ten minutes09:18:10.589–09:28:10.589 Bangkok yielded
190 independently verified MP3s,19.0/min,6.3333x baseline, no blocks/retries.
Artifact:`data/acquire/audit-20260913-four-workers-192-10min.json`. This includes
transition carryover and two owner searches/two staged repairs (not extra MP3s).
The bulk run has used cached URLs, so fresh-search throughput remains unproven.
At09:30:10.622 Bangkok only allowance192→216 was hot-applied; download4,
search1,batch8,buffer192 remain unchanged. First complete new window ends
09:40:10.622 Bangkok. PID27088/session12460 was not restarted. Retained web
preset is now4/1/192, not activated. Preserve first-block floor/history.

At09:40:48.111 Bangkok, allowance alone rose216→240 after the completed216
window produced210 independently codec-verified MP3s,21.0/min,7x baseline,
with no blocks/retries. Evidence:`data/acquire/audit-20260913-four-workers-216-10min.json`.
Read its recording-quality/transition/review-work caveats; one known wrong
source remained at audit. Live4/1/240 first ten minutes end09:50:48.111 Bangkok;
wait and measure before further tuning. The existing subagent is updating the
retained web profile to4/1/216 without activation. No live CLI restart.

09:43 follow-up: retained4/1/216 now verified in tests and real mainChrome,
distinct from live240; no activation. WATER was independently repaired after
the216 measurement, and the repeat filesystem audit verifies all210 files
with no known open recording reviews in that window. Historical original
flags/caveats remain in the original artifact. Three older content reviews
remain open.240 profile's initial workers are all busy with allowance unfilled;
observe its full window before choosing the next lever, do not restart CLI.

The user explicitly instructed autonomous failure recovery. Do not ask again
to replace an obsolete client or restore the already-authorized YouTube cookie
export. The installed official yt-dlp **2026.08.19** skips `android_sdkless` and
substitutes defaults, so the CLI now selects **visionos** anonymously,
**web_creator** with cookies, or **mweb** with the existing pinned loopback POT
provider. The initial recovery run uses the latter route explicitly.
Historical file counts remain real output but do not prove the old requested
player-client labels. Exact-release compatibility checking remains enabled.

```sh
node scripts/acquire.mjs run --takeover --authenticated --pot-recovery --retry-errors --search-buffer 192
```

The runner inherits the floor, cooldown and admission history; raise one pace
lever only after actual recovery MP3s. Both web queues must be drained and
paused. `--authenticated` selects cookie-backed work immediately;
`--pot-recovery` uses the already-installed hash-pinned 2.0.0 plugin and checks
the existing provider at `127.0.0.1:4416`. No new browser or remote service is
required. Every child gets a separate mode-0600 cookie jar because yt-dlp can
rewrite it on exit; the master export is never passed to a child directly.
Authenticated startup refuses an absent/empty jar before altering queues,
and a missing jar during the run holds admission rather than burning retries.

`node scripts/acquire.mjs doctor` performs a read-only local binary/client
compatibility check, with no network or queue access; exit 2 means it is not
ready. `run` enforces that check before taking ownership or writing any state.
The rejected-run path leaves control, handoff and pace files unchanged.
Unknown binary/client pairings require exact-release review. CLI diagnostics
retain only allowlisted warning categories, never raw cookie/session output.

The runner now supports `review-work` for explicit saved-catalog search,
source inspection and candidate download requests. Requests come from
`data/acquire/review-work.json`; candidate downloads are staged outside the
library, never counted as acquired MP3s, and require a separate verified
replacement. At 01:08 UTC on 13 September, 18 recording-review entries were
resolved with original/replacement hashes verified; two remained open:
Naulka / Pyramids (incomplete trailer usage) and savpex / All Flowers For You
(recording identity unresolved). Originals are preserved. Repairs are not
counted as extra acquisitions, and known open reviews block overall completion.
At the emergency floor, search and
download together are restricted to one process; normal pools remain separate.
Graceful stopping cancels unadmitted waits without killing active processes.
All 44 CLI/report/repair tests pass. See the latest HANDOVER checkpoint before using the
commands and historical measurements below.

### Corrected false-block detector and current benchmark

The detector previously scanned stdout metadata for error text. A successful
track with `duration: 429`, or a chapter boundary at second 429, could therefore
trip the HTTP-429 safeguard. RUZE / Come Together reproduced this at 00:19:57
UTC on 13 September; the earlier Marcello source also contains a 429 chapter
boundary. This does not prove every earlier failure was false.

Both CLI and web worker now classify **stderr diagnostics only**. Split-chunk
real bot/HTTP errors still stop immediately. The CLI emits an allowlisted
`block_signal` source/client event, never raw session material. The replacement
worker retained admission history and let the existing cooldown expire.

Its first full ten minutes, **00:22:16.979–00:32:16.979 UTC**, produced **84
MP3s: 8.4/min, 2.8 times the 3/min baseline**, with no new trips or retries.
All 84 distinct files independently passed ffprobe again. This includes an
inherited cooldown and separate review work; it is not a thirty-minute result.
The next complete window, **00:32:44.221–00:42:44.221 UTC**, produced **104
MP3s: 10.4/min, 3.47 times baseline**, zero retries/trips. All 104 independently
passed ffprobe again. At **00:42:53.327 UTC**, the allowance alone was raised to
**120 download admissions / ten minutes**, still two download workers and one
search worker. Its first full window, ending 00:52:53.327 UTC, delivered **120
MP3s: 12/min, 4x baseline**, zero retries/trips, with 120 distinct output files
independently checked again. At **00:53:04.286 UTC**, only the allowance was
raised to **144/ten minutes**. Its full window ending **01:03:04.286 UTC**
produced **143 MP3s, 14.3/min, 4.77x baseline**, with no retries/trips.
All 143 distinct output inodes independently passed ffprobe again. One
wrong-source file in that window was subsequently repaired; this is a
codec-verified output benchmark, not a blanket recording-identity audit.
This is the retained known-good profile: two download processes, one search
process, eight URLs per batch, and a 192-URL search buffer.
The first complete mixed-profile half-hour delivered 308 MP3s (10.2667/min,
3.42x baseline), including the inherited cooldown. Cached
URLs dominate these windows; the search-heavy phase has not yet been measured.
The full-library worker remains live. Validation permits subsequent measured
trials up to 192/ten minutes, not an automatic change or a claimed achieved rate.

At **01:04:22.978 UTC**, the allowance alone was raised to **168/ten minutes**.
This remains a trial, not the retained web preset. Web-retrofit legacy tests
briefly launched unintended yt-dlp children at **01:05:51–01:06:07 UTC**;
whether they reached YouTube is unknown. Only those test children were stopped,
the CLI continued, and the tests now deny unmocked subprocess launches.
`data/acquire/benchmark-notes.json` records the overlap; `benchmark` excludes
affected windows from sole-owner comparisons without erasing real outputs.
The first ten minutes of the 168 profile are therefore ineligible. Use a fresh
clean observation after 01:06:07, and do not confuse a 16.8/min admission ceiling
with measured throughput.

The held profile subsequently completed a clean thirty-minute observation,
**01:06:35.561–01:36:35.561 UTC**: **382 MP3s, 12.7333/min, 4.2444x baseline**,
with zero retries/trips and no settings increases. All382 distinct current files
independently passed ffprobe; the audit is saved in
`data/acquire/audit-20260913-held-profile-30min.json`. Cached URLs dominate;
search-heavy throughput and universal recording identity remain unproven.
At01:38,19 recording-review entries are resolved and three remain open.
The latest Overload repair uses exact millisecond catalog boundaries from the
publisher-linked complete album, with full-runtime agreement within16ms;
its manifest explicitly distinguishes derived boundaries from native chapters.
Originals and staged-source hashes are preserved, and repairs are never counted
as extra acquired MP3s. No live CLI restart was required.

The web retrofit retains the audited 144 profile separately from mutable live
pace. Its UI distinguishes that preset from the running CLI trial. Server-side
ownership guards prevent web acquisition while the CLI lease exists. The
future preset-selection endpoint requires no owner, paused/drained web queues
and no active cooldown or safety floor; it does not resume queues. Web execution
has not been throughput-benchmarked while the CLI owns YouTube work.

## Run

Use the required runtime:

```sh
export PATH="/Users/dom/.nvm/versions/node/v20.19.4/bin:$PATH"
node scripts/acquire.mjs plan
node scripts/acquire.mjs --help
```

`plan` is read-only. It reports unique songs, saved files, cached URLs, searches
still needed, inode-deduplicated GB and the ETA at the comparison baseline.
Its membership comes from the saved snapshots, so it can include songs not
yet represented in SQLite or in the old Bull queue. Only an explicit empty
YouTube search result is a permanent miss.

Once a graceful transfer from the live web workers has been authorized:

```sh
# Bounded first experiment. Exercise search too despite the large URL backlog.
node scripts/acquire.mjs run --takeover --limit 24 --search-buffer 4096

# Sustained measurement; stop admitting work at 30 minutes, then drain batches.
node scripts/acquire.mjs run --takeover --minutes 30 --search-buffer 4096

# Continue the entire remaining snapshot library, resuming durable outcomes.
node scripts/acquire.mjs run --takeover
```

The default profile inherits the current concurrency, admission window and
cooldown. `--batch-size 8` amortizes the packaged executable's startup over
multiple URLs. Search and download pools operate independently. Search pauses
when enough known URLs are waiting; `--search-buffer` sets that high-water
mark. Downloads prefer audio-only formats before falling back to format 18.
MP3 encoding remains quality 0, as in the application.

Explicitly change one throughput lever at a time after a clean measured run:

```sh
node scripts/acquire.mjs pace --window 64
node scripts/acquire.mjs status
node scripts/acquire.mjs benchmark
node scripts/acquire.mjs stop
```

The first confirmed 429, bot check or API-page block kills this runner's yt-dlp
process groups immediately and returns to the shared safety floor and
cooldown. Local routing failures do not trip that rule. There is no automatic
increase. Normal attempts use explicit anonymous `visionos`; authenticated
work uses `web_creator`, or `mweb` downloads with `--pot-recovery`, after any
cooldown. These replace the obsolete `android_sdkless` setting. No cookie or
token content is printed or stored in reports.

## Ownership and restart

`run` without `--takeover` refuses a live web queue. With an authorized
takeover, it pauses new Bull admissions and lets active jobs finish. It does
not delete jobs, kill the backend, reload Nest or interrupt a running web
download. The CLI starts only after both active queues and the backend's
actual YouTube pool are empty. A Redis lease prevents a second CLI runner.
If someone externally resumes the web queue or the lease is lost, CLI
admission stops and its own child processes are terminated.

The CLI has its own durable journal at `data/acquire/work.sqlite`, outside
Nest's build output. A streamed result is verified with ffprobe (MP3 codec
and positive duration), tagged, published, linked into all matching playlist
folders, and reconciled to existing SQLite rows. Already saved files and
confirmed misses are skipped. Operational failures get bounded deferred
retries; five failed attempts leave an explicit error. `--retry-errors`
reopens those exhausted CLI attempts on the next run.

An absent or zero-byte recovery cookie file is detected using file metadata
only. An explicitly authenticated run holds admission without starting yt-dlp,
spending download credits, or exhausting queued tracks. Anonymous work keeps
running otherwise. The live owner sees a restored cookie file automatically;
`--retry-errors` reopens earlier exhausted attempts on a later run. A
track-specific authenticated retry never pulls fresh anonymous tracks into the
same cookie-bearing batch unless the whole run selected `--authenticated`.

The user subsequently authorized a YouTube-only cookie export from logged-in
main Chrome. `scripts/export-youtube-cookies.mjs` uses only the existing local
CDP bridge, never a new WebSocket or browser instance. It filters YouTube
domains, validates authentication-cookie presence without printing values,
and atomically writes the Git-ignored configured file with mode 0600. It
refuses an unexpectedly nonempty target rather than overwriting credentials.
The already-running CLI detects the repaired file without a restart; eight
new verified MP3s demonstrated successful recovery on 12 September. This is
separate from reopening the five previously exhausted retries on a later run.

After those eight successes, a deliberate one-lever trial raised only the
allowance to 40 URLs per ten minutes, retaining one download process, one
search process, `autoStep: false`, and all block safeguards. Its first full
window, **10:28:49.853–10:38:49.853 UTC on 12 September**, produced **40 new
MP3s and 40 search results**, with zero blocks or additional retries:
**4.0 MP3/min, 33.3% above the 3/min baseline**. All 40 distinct new outputs
also passed independent post-publication codec, duration and creation-time
checks. This includes the idle admission tail; it is a complete ten-minute
result, not yet a sustained thirty-minute benchmark. The live runner was left
at the same setting for the longer measurement.

The user then clarified the priority of increasing throughput over extending
that fixed-profile wait. At **10:46:55.297 UTC**, after **80 new MP3s in
18.0907 minutes**, no new retries or blocks, and verified idle workers at
40/40 admissions, only the allowance was raised to **64 per ten minutes**.
Concurrency remained one download plus one search, and all emergency trips
remained enabled. The 6.4/min allowance is a ceiling, not an achieved result;
the 40-URL phase has no thirty-minute benchmark. Raising process concurrency
while the admission allowance is already exhausted would not admit more work.

At **10:53:15.837 UTC**, the single download worker was almost fully occupied
while admission headroom remained, so download concurrency was increased to
two at the unchanged 64 allowance. Search concurrency stayed one. Five prior
eight-song invocations took 346.304 process-seconds; all 40 published outputs
passed an independent audit. The added worker filled the unused credits.
At **10:55:39.848 UTC**, after those batches completed without new failures,
only the allowance was raised to **80 per ten minutes**, keeping two download
workers and one search worker. All block protection remains enabled. At
10:56:27 UTC the rolling ten-minute output was **7.1 MP3/min (2.37x baseline)**,
but that window spans tuning changes. A complete fixed-profile ten-minute
result for this new 2+1/80 setting was not yet available at that checkpoint.

That 2+1/80 profile subsequently completed **10:55:39.848–11:05:39.848 UTC**
with **80 new MP3s and 80 searches**, no blocks, no additional retries, and
no long-form outputs: **8.0 MP3/min, 2.667x baseline (+166.7%)**. All 80 files
independently passed MP3 codec/duration, new-inode/creation-time, and catalog-key
tag checks. A separate audit of 188 post-recovery files also passed audio and
tag checks; these overlapping audit counts are not additive.

At **11:06:16.315 UTC**, only the allowance was increased to **88 per ten
minutes**, retaining two download workers and one search worker. This tests
a smaller step below the earlier failed 96 setting. All safety trips remain
enabled. Already-in-flight work completed just after the change, so the new
profile's initial partial-minute burst is not a sustainable throughput claim;
use complete windows and capped forecasts. Its first complete ten-minute
window ends **11:16:16.315 UTC**.

The subsequent two-worker **96-per-ten-minute** retest completed
**11:17:35.313–11:37:35.313 UTC** with **191 new MP3 files / 20 minutes =
9.55/min**, 188 searches, no blocks or additional retries. All 191 outputs
independently passed codec, duration, nonempty-file and new-inode checks.
Ten single-movement selections in that window have suspicious full-work
lengths and are tracked separately in the content-review ledger; file
verification is not recording-identity verification. Excluding all ten gives
181 other files / 20 minutes = 9.05/min, without implying those other files
were individually listened to or identity-verified.

At **11:38:00.271 UTC**, only the allowance was increased to **104**, keeping
two downloads, one search and all first-block guards. This is an explicit
bounded next experiment, not a proven YouTube ceiling. At that checkpoint the
CLI accepted `--window 8..104`. After the 13 September protocol and false-block
fixes, the validation ceiling was extended to 192 for further **measured,
one-lever trials**; this does not itself raise the live allowance. Values above
192 are rejected without changing control state.
Its first complete ten-minute window ends **11:48:00.271 UTC**. Early output
can carry across a profile boundary; do not project its partial-minute burst.

Source-evidence capture was also added to the CLI for its **next normal run**;
the current PID has not loaded it. It uses the existing download's result
projection to retain only public video title/ID, duration, artist/track/album,
channel/uploader and bounded chapter times. No additional network request or
full info document is required. Signed media URLs, cookies and HTTP headers
are deliberately excluded. Recording evidence helps inspect mismatches but
does not itself establish an exact recording match or repair an existing file.

To inspect the original sources of already-saved, unresolved review entries:

```sh
# At a normal graceful load, inspect the review ledger, then keep acquiring.
node scripts/acquire.mjs run --takeover --retry-errors --inspect-review

# A compatible live runner can also accept this request without a restart.
node scripts/acquire.mjs inspect-review
```

Inspection is scheduled inside the sole CLI owner, uses its download process
pool, charges one admission per unique video, and respects the same cooldown
and first-block stop. It does not download another audio file, modify the
original MP3, alter saved-track status or increment MP3 successes. Whitelisted
public recording/chapter evidence is written to ignored mode-0600
`data/acquire/source-review.json`. Errors leave the content review unresolved.
The command refuses an older runner that lacks support. An inspection request
neither reapplies an earlier pace setting nor cancels a requested graceful stop.

This was exercised on the ten known full-work selections on 12 September:
all ten inspections completed through the sole owner. Source titles also
exposed several wrong-performer selections, not just missing movement cuts.
The eight unresolved issues remain in the review ledger; never assume a file
with the requested ID3 tags proves the source performer is correct.

`scripts/acquire/repair.mjs` provides explicit local chapter repair for an
independently corroborated recording. It requires matching source video and
performer words, an identified source chapter, a close catalog-duration check,
and unchanged original file/device/inode/byte identity at every playlist path.
It archives the full original before replacing any canonical path, records
each replacement durably, and verifies MP3 duration, tags and file hashes.
It is not an automatic trim-to-catalog-duration policy. The first two repairs
were Kleiber/Vienna Beethoven 5 I (442 seconds, three playlist links) and
Rostropovich/Karajan/Berlin Dvorak concerto I (942 seconds, one link). Original
recordings and repair manifests remain under `data/acquire/preserved-originals/`.
These local repairs do not increment new-download throughput.

If a global bot-recovery period requires that missing material, the runner
waits without assigning failures to untouched songs. After the existing
one-hour authenticated-recovery policy expires, anonymous work can resume at
the safety floor; concurrency/admission is never automatically raised.

Publication uses short, randomly named adjacent temporary files. Ordinary
filenames are unchanged; unusually long names are shortened at Unicode
code-point boundaries with a stable hash suffix to fit a 255-byte segment.
The library filename helper uses the same convention so playback can locate
those files.

`stop`, SIGINT and SIGTERM stop new admission and drain existing batches.
A second signal kills only CLI children. Each batch has a bounded deadline.
`stop` discards any earlier pace instruction from the control request, so it
cannot accidentally reapply a fast profile after a subsequent safety trip.
An ordinary exit hands the complete recent download admission history and
cooldown back to Nest before restoring each queue's original pause state.
If that handback fails, queues remain paused and the CLI reports the problem.
After an ungraceful crash, a new run resumes the journal after the old Redis
lease expires. Never resume web work until the CLI process is confirmed gone
and its `data/acquire/pace.json` admission history has been handed back.

While the CLI owns the paused queues, a temporary backend pace-API outage is
reported but does not stop acquisition. Redis ownership and queue-pause checks
remain mandatory. Final handback is still fail-closed: the backend must accept
the complete admission history before its workers are resumed.

## Measurement

`data/acquire/status.json` and `result-<run>.json` contain:

- newly verified MP3s / elapsed wall-clock minutes, including executable
  startup, YouTube waits, encoding, retries and cooldowns during acquisition;
- the multiple of 3/min and percentage improvement;
- rolling 10- and 30-minute rates (shorter windows explicitly use elapsed time);
- unique remaining songs, a continuous ETA and a 25% buffered ETA; forecasts
  use the current profile's measured rate, cap startup bursts at the current
  admission allowance and include cooldown/recovery holds;
- unique inode bytes in GB, active batches and actual yt-dlp processes;
- exhausted retries, so stopping or queue exhaustion cannot imply completion.

Local hardlinks do not inflate the acquisition counter. Search results and
download starts are not MP3 successes. `status` checks both the recorded PID
and current Redis owner and labels stale snapshots. Startup handoff/setup is
outside the acquisition interval; all yt-dlp cold starts are inside it.

`mp3PerMinute` remains the whole-run audit average. Use
`currentProfileMp3PerMinute` and `currentProfileBaselineMultiple` for the
current setting. A newly tripped recovery profile with no successes has a
zero measured rate and no measured ETA; it must not inherit the failed fast
profile's average. `etaAtAdmissionCeiling` is a separate, explicitly conditional
estimate assuming recovery succeeds and every permitted admission yields a
new MP3. `earliestRecoveryAt` exposes the current hold's expiry. The status and
ordinary progress-report readers normalize an already-running writer without
restarting it.

Per-run JSONL logs record sanitized outcomes and process timings, including
time to first output. No raw stderr or authenticated request material is
retained. Cover-image fetching is omitted from this acquisition experiment;
title/artist tags are written locally. Existing web playback discovers the
published files. The website does not yet display the CLI's active process
counts; use `status` while it owns acquisition.

Verification confirms a readable MP3 and positive duration, not a human-checked
artist/title match. Cached YouTube selections are reused. Some saved snapshots
have no expected duration, so a long result cannot be automatically identified
as a bad match; per-song durations are retained in the publication events for
review rather than silently discarding potentially valid long-form audio.

Known recording/segment mismatches are recorded separately in
`data/acquire/quality-review.json`. The status, benchmark and ordinary-report
readers expose `contentReviewPendingUnique`, `contentReviewInCurrentRun`, and
`completionBlockedByContentReview`. A malformed ledger blocks completion
rather than silently clearing the warning. These reader changes take effect
without restarting acquisition. The raw MP3 counters continue to describe
codec/duration-verified file publication, not human-verified recording identity;
bulk acquisition ETAs do not estimate unresolved content repairs.

One specific mismatch was confirmed on 12 September: the Kleiber/Vienna
Beethoven Fifth first movement is [listed as 7:21 in the release catalog](https://classical.music.apple.com/us/recording/ludwig-van-beethoven-1770-pp27-1644892939),
but the acquired file is 33:32, approximately the complete symphony's duration.
The original file and its three playlist hardlinks remain untouched. Correct
recording/segment verification and repair remain required; do not blindly trim
at a rounded catalog duration. The saved snapshots contain no track durations,
so this check used a public recording catalog, not a Spotify resync or an
independent YouTube probe.

The existing `scripts/yt-progress-report.mjs` also includes CLI publication
events, so scheduled progress checks continue to count actual new MP3s. It
includes the CLI owner verification and its separate acquisition ETA/rate.
The top-level rolling rates span both web and CLI activity during a handoff;
the nested `acquisition` result isolates the CLI experiment. While a live CLI
owns the queues, top-level historical ETA fields are also limited by its
current measured profile and admission cap, including the recovery wait. They
are null when that profile has not yet produced a measurable rate, so a
scheduled report cannot continue projecting the failed fast profile.

`benchmark` separates the current run at each manual pace change or emergency
trip, reporting verified MP3s and elapsed time for each profile. Complete
ten- and thirty-minute windows are left null until enough time has elapsed.
It also counts long-form outputs for review; an initial burst is never relabeled
as a sustained benchmark.

## Evidence so far

On 12 September, the installed `yt-dlp_macos --version` took **50.79 seconds**
wall time, with 0.47 seconds user CPU and 0.19 seconds system CPU. It made no
YouTube request. This supports testing startup amortization; it does not
prove why macOS delayed startup or establish the CLI's achieved MP3 rate.
During the later recovery hold, a second local-only `--ignore-config --version`
check completed successfully in **11.065 seconds** with the same version,
2026.08.19. The binary contains a native arm64 slice on this arm64 machine and
has no quarantine attribute. Startup cost is variable; neither an architecture
mismatch nor a quarantine flag explains the observed earlier delay. No system
security settings were changed and these checks made no YouTube requests.

The CLI's local tests cover snapshot exclusions, URL/disk reuse, hardlink
accounting, ETA math, error sanitization, out-of-order search responses, and
streamed partial download success. The refusal path was exercised against
the live queue and left its admission unchanged.

The user then authorized the handoff and unattended operation. Run
`2026-09-12T05-40-52-799Z` drained the existing workers in approximately one
minute and started acquisition at 05:41:56 UTC. At 05:46:57 UTC it had produced
**25 ffprobe-verified MP3s in 5.027 minutes = 4.973/min**, approximately 66%
above the 3/min reference. This is a short initial sample, not a sustained
30-minute result. The inherited profile was three download processes, one
search process and 48 admitted URLs per ten minutes. Search resolved 64 songs
in the same interval. One unresolved download was scheduled for retry; there
had been no rate-limit trip.

The first complete ten-minute window contained **42 verified MP3s (4.2/min,
+40%)**. After the admitted batches drained normally, the complete first run
finished with **51 MP3s in 10.921 minutes (4.670/min, +55.7%)**, 144 completed
searches and three deferred download failures. All CLI child processes exited,
admission history was handed back, and the original Bull pause states were
restored. A second authorized run then started a 64-URL/ten-minute trial with
the same three download processes and normal search backpressure.

That second run's first complete ten-minute window produced **47 MP3s
(4.7/min, +56.7%)**, with no rate-limit trip. It exposed repeated authenticated
retry failures because the pre-existing cookie file was zero bytes. The trial
was then asked to drain normally so fixes could be loaded: skip futile empty-
cookie attempts, avoid double-reserving admitted window credits, tolerate
temporary backend mirror outages, and support long destination filenames.
The ten-minute rate does not exclude any startup or retry time within that
window; the final whole-run rate also includes its graceful-drain tail.

The second run ultimately finished with **57 MP3s in 17.285 minutes
(3.298/min, +9.9%)**. The long tail included cached eight- and ten-hour audio
selections. Its full-run result must not be replaced by the faster ten-minute
window when comparing whole-run throughput. All owned children exited and the
queue handback completed without killing those conversions.

Run `2026-09-12T06-11-36-278Z` loaded the fixes and started acquisition at
06:12:40 UTC with the same 3-process/64-URL profile. The required backend
filename alignment was applied only after the CLI had drained and owned both
queues and backend YouTube activity was verified zero. Nest reloaded; the CLI
retained ownership and continued acquiring. Cookie-dependent jobs now remain
explicit errors without wasting repeated network admissions. Sustained results
for this revised run remain to be measured.

At 06:16:33 UTC, with no active children and the 64-URL allowance fully used,
the operator manually raised only the allowance to **80 URLs per ten minutes**.
Download concurrency stayed at three; automatic increases remained disabled.
Use the separate phase in `benchmark` for this experiment, not its mixed-profile
whole-run average.

That isolated 80-URL phase completed its first ten minutes with **80 newly
verified MP3s: 8.0/min, 2.67 times the 3/min reference (+166.7%)**, no rate-limit
trip and no long-form outputs. An independent post-publication ffprobe audit
passed all 92 files sampled from the run. The complete third run later drained
cleanly at 155 new MP3s / 15.005 minutes; its higher whole-run average includes
startup/window-boundary bursts and is not the sustained claim.

The fourth run was launched at 06:27:41 UTC with the same 3-download/1-search,
80-URL profile and `--search-buffer 4096`, to measure concurrent search and
download despite the cached-URL backlog. Handoff waits include any already-active
web jobs waiting for admission credits; those waits are not bypassed. A longer
combined-pipeline measurement remains pending.

The fourth run's complete first ten minutes matched the download-only result:
**80 new MP3s (8.0/min) plus 213 completed searches**, with no rate-limit trip.
It finished its graceful drain at 139 MP3s and 256 search results in 13.232
minutes. All MP3s in the measured interval were verified to have creation times
within the run, not pre-existing files.

The live audit found three legitimate dot-prefixed artist filenames omitted
by the original remaining-count scanner. Files such as `.Clouds - …` and
playlists such as `...baby one more time Radio` are now included; only actual
`.spooty-download-batch-` staging directories are excluded. Known destination
paths provide a second reuse check. Publication also explicitly distinguishes
a new file from an existing destination appearing concurrently, so the latter
cannot inflate new-MP3 throughput.

Run `2026-09-12T06-45-57-172Z` loaded these fixes and started at 06:47:39 UTC,
testing **96 admissions per ten minutes** with the same 3-download/1-search
pools and search prefetch. Its **first complete ten-minute window produced
92 new MP3s and 200 completed searches: 9.2 MP3s/min, 3.07 times baseline
(+206.7%)**, with no rate-limit trip. All 92 final files independently passed
post-publication MP3 codec/duration checks and creation-time checks. Its
9.6/min admission allowance remains a ceiling, not a measured output rate.
**That higher profile subsequently failed:** at **07:04:34.242 UTC**, after
**16.912 minutes and 152 MP3s (8.988/min before the trip)**, YouTube emitted a
bot/rate-limit signal. The guard killed all owned yt-dlp groups and restored
the 1-download/1-search, 8-admissions/ten-minute safety floor. No clean
thirty-minute benchmark was obtained. The earlier clean ten-minute result is
valid as a short measurement, not proof of a sustainable 3x rate. Nor do the
earlier ten-minute 80-admission trials establish long-term sustainability.

The same CLI remains alive and owns both paused web queues. With the existing
recovery file empty, it is waiting until **08:04:34 UTC / 15:04:34 ICT** before
anonymous work may resume under the existing policy; no automatic pace raise
is enabled. Five track-specific authentication errors remain parked. No
credentials were read or repaired and no additional YouTube probes were sent
during the hold. All **152** published files passed an independent post-stop
codec, duration and creation-time audit. One is a 72.8-minute continuous mix,
retained as requested by its saved metadata rather than discarded as an error.

At the hold checkpoint: **14,217 unique songs remain**, **45.4157 GB** of
unique-inode MP3 data, and **zero measured MP3s/min in the recovery profile**.
There is no measured completion ETA while held. If recovery succeeds and the
0.8/min cap translates fully to saved MP3s, the conditional continuous ETA is
**24 September 23:15:49 ICT**, or **28 September 01:18:38 ICT** with the 25%
work-time buffer. These estimates are not evidence of resumed output.

An all-five-trial audit at **07:15:39.555 UTC** found **554 distinct new MP3
keys and 554 distinct file inodes**, all nonempty and created during their
respective runs. There were 732 completed searches and one rate-limit trip.
From the first acquisition start at **05:41:56.220 UTC**, elapsed wall time
was **93.722 minutes**, including intervening queue handoffs and the current
hold: **5.911 new MP3s/min, 1.97x baseline**. This is the observed mixed-profile
experiment aggregate as of that timestamp, not the current rate (zero) or a
claim that the failed 96-admission setting is sustainable. The aggregate
necessarily declines while the recovery hold continues.

The fifth trial's **complete first hour**, **06:47:39.542–07:47:39.542 UTC**,
contained **152 new MP3s and 336 searches**, with one rate-limit trip. Including
the recovery downtime, that is **2.533 MP3s/min, 15.6% below the 3/min baseline**.
This long-window result supersedes any implication that the aggressive
96-admission profile has achieved a sustained throughput improvement. The
worker remains alive at the safety floor; the recovery profile itself has
produced no new MP3s during the hold.

At **08:04:34 UTC**, the existing worker resumed at the safety floor without
any manual pace increase. One search completed, but **zero MP3s** were saved.
At **08:04:55.415 UTC**, another download bot/rate-limit signal killed both
owned processes after about 21 seconds; neither process hit its timeout.
The configured recovery file was again verified to be zero bytes using file
metadata only. The run remains alive and owns both paused web queues, with
next recovery eligibility at **09:04:55 UTC / 16:04:55 ICT**. This is a verified
upstream/recovery-access blocker even at the safety floor, not evidence that
raising concurrency will help. No credentials were harvested or repaired.

At that second hold: **14,217 unique songs remain**, **45.4157 GB** of MP3
data, and **0 current-profile MP3s/min**. No measured ETA exists. Conditional
on successful recovery at the 0.8/min admission cap, completion is
**25 September 00:16 ICT**, or **28 September 02:19 ICT** with the 25% work-time
buffer. The fifth run has 152 MP3s, 337 completed searches and two blocks.

The 841-playlist web library loaded successfully, and the new
`Black Sabbath - Planet Caravan.mp3` played through the existing local library
endpoint. Browser evidence showed its 269.24-second duration, playback time
advancing to 30.30 seconds with no audio error, and successful pause at 34.92
seconds. The temporary verification tab was closed. No Spotify resync was
requested for this acquisition-only workflow.

```sh
node --test scripts/acquire/acquire.test.mjs
```
