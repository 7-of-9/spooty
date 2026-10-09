# Portable DJ handoff

Export exactly the tracks in a verified `/api/library` playlist snapshot. The
exporter reuses the shared `LocalMediaIndex` and duration guard, probes the actual
MP3s, and reads only the corresponding fingerprinted analysis cache. It never
changes source audio, tags, playback state or acquisition queues.

Optional public metadata enrichment uses the existing Spotify session and paced
HTTP gate. Before running it, perform the project CDP configuration preflight and
check the approved singleton's health. It does not authorize a reconnect.

```sh
node scripts/dj-share/enrich-metadata.mjs verified-playlist.json data/dj-source-metadata.json
python3 scripts/dj-share/export.py \
  --snapshot verified-playlist.json \
  --folder /path/to/playlist-audio \
  --enriched data/dj-source-metadata.json \
  --out data/dj-share-50
```

Use Node 20.19.4; `--node` and `--ffprobe` accept explicit executable paths.
The source playlist folder and output must share a filesystem because MP3s are
hardlinked, preserving bytes and avoiding a second copy. The stored ZIP takes
approximately the total source audio size. No files outside the selected playlist
are included. Existing mismatching audio exports fail closed instead of being
overwritten.

`manifest.json` is the webpage contract: playlist metadata, `summary`, `tracks`,
`downloads` and `archive`. Each track has flat catalog/analysis fields and an
`audio` object with relative path, basename, byte size and SHA-256. Energy uses a
0–100 model estimate. `catalog.json` is the same catalog without the ZIP's own
hash; it is included inside the ZIP alongside UTF-8 CSV, M3U8, checksums and notes.
Every ZIP member is read back for CRC validation and compared to its source SHA-256.

Only allowlisted public fields are exported. Spotify IDs and ISRCs describe the
intended catalog recording; the supplied MP3 is identified separately by SHA-256.
Duration matching is useful evidence but is not acoustic recording verification.

As regeneration finishes, update the separate mix handoff without rebuilding the
track ZIP:

```sh
python3 scripts/dj-share/export-mixes.py \
  --regeneration data/automix/builds/regen-20261006/regeneration.json \
  --out data/dj-share-50
```

`mixes.json` lists all five requested versions, with ready/rendering state and the
running order. Finished mixes are hardlinked only after their final hash and size
match the regeneration proof. Each has a corrected CUE, order/transition CSVs and
allowlisted JSON details. Medley warning data comes from the selected candidate;
the whole-mix alignment result is published separately and is never hidden by
successful file checks. Prior mixes are never substituted for pending new versions.
The medley's transition CSV includes the selected candidate's check status,
warnings, failures, explanatory notes and blend score so DJs can filter joins
that need manual attention without parsing the JSON report.

## Public handoff

The current handoff is [50 DJ Room](https://fifty-dj-room.dm-ae80.chatgpt.site).
It is a separate, deliberately small site with public track downloads, source ZIP,
mix playback, chapter seeking, and order/transition downloads. It does not expose
the local application or its administrative controls. Audio objects live in the
Site's R2 bucket; the Worker supports byte ranges so multi-hour mixes can seek
without downloading the whole file first.

The independent `dj-share-site/` checkout is owned by the Sites publishing
workflow. Its exact committed source is also mirrored to the
[`dj-share-site` branch on GitHub](https://github.com/7-of-9/spooty/tree/dj-share-site).
The parent repository intentionally ignores that checkout instead of creating an
accidental submodule. Keep the Site project ID in `.openai/hosting.json`; reuse
the existing Site for updates. Use its normal source/build/save/deploy workflow
for code changes. Catalog and media updates do not require a code deployment.

`upload.py` accepts its origin, upload secret and tasks through hidden stdin.
For a large batch, use a `tasksFile` rather than putting the task array in a TTY
line. That file contains no secret, only objects such as:

```json
[{"path":"data/dj-share-50/audio/example.mp3","key":"audio/example.mp3"}]
```

The hidden input configuration has `origin`, `token`, `tasksFile` and optional
`concurrency` (default 3). Supply the Site's `UPLOAD_TOKEN` from a private secret
source; never write it to a task file, shell command, log or Git. The uploader
uses 16 MiB multipart chunks and checkpoints completed parts under the ignored
`data/dj-share-upload-state/` directory. Retrying a batch skips matching remote
objects and resumes incomplete multipart uploads. Keep each object owned by one
uploader process at a time.

Publish track files under `audio/`, mix assets under `mixes/`, and the ZIP/CSV/
M3U/checksums under `exports/`. Prefix the root manifest's `downloads` and archive
paths with `exports/` before uploading it as `catalog/manifest.json`. Publish
`mixes.json` as `catalog/mixes.json`. Upload catalogs last: hide the archive and
mark each mix `uploading` until its audio and companion files have been verified.
The page reads those two catalogs on reload. Preserve any failed musical-quality
checks in the public mix notes; successful file transfer is a separate result.

Verify the actual public response bodies after upload:

```sh
python3 scripts/dj-share/verify-public.py \
  --origin https://fifty-dj-room.dm-ae80.chatgpt.site \
  --package data/dj-share-50 --tracks --archive \
  --mix s6-v2 --mix s7-v2 --mix s8-v3 --mix s9-v4 --mix medley-v7 \
  --out data/dj-share-upload-state/public-readback.json
```

Select only files already uploaded. This read-only verifier uses no credentials,
streams and hashes the complete downloads, validates filenames and response
headers, and compares beginning/middle/end range requests against the local
files. Evidence is saved after every result, including failures. Use separate
output paths when verifying successive batches to retain each earlier result.
Use `--track SPOTIFY_ID` for a selective source retry. Short response bodies are
retried within the configured bound, with observed/expected byte counts retained;
a complete download must still match its expected hash. `--ranges-only` performs
HEAD and three range checks and explicitly does not claim a full remote hash
readback. It is useful for a second URL exposing already verified identical audio.

## Fixed-order local handovers

The Life timeline collection is now **private**. Its earlier 55-track public
version has been withdrawn; the replacement 16-track handover must not be
uploaded. Use the local player below, including when restarting after a reboot:

```sh
python3 scripts/dj-share/serve-private.py \
  --build data/automix/builds/life-timeline-v2-20261009 \
  --tracklist data/automix/handover/life-timeline-v2/tracklist.json \
  --out data/dj-private/life-timeline-v2 \
  --port 4301
```

Open `http://127.0.0.1:4301/` on the same Mac for all four versions, chapter
seeking, source playback and downloads. The server binds only to loopback and
validates rendered and source hashes before serving. Do not stop a different
player or the acquisition app if that port is already occupied. See
[private-player.README.md](private-player.README.md) for the serving boundary
and tests. Audio, handover notes and prepared private metadata stay under ignored
`data/`; only generic player and render code is tracked.

The historical exporter described below remains available for authorized local
packages. **These examples do not authorize republication of this collection.**
The handover can contain original MP3s without Spotify identifiers.
Its exporter requires every selected file and its current fingerprinted analysis,
retains the supplied position order and assigns each source `local:<SHA-256>`.
Existing Spotify IDs and cached ISRCs are included when known. The public export
contains music metadata only: private source paths, era notes and handover
provenance are not copied. Source files are hardlinked without retagging.

```sh
python3 scripts/dj-share/export-timeline.py \
  --tracklist data/automix/handover/life-timeline-v1/tracklist.json \
  --folder data/automix/handover/life-timeline-v1/tracks \
  --out data/dj-share-life-timeline
python3 scripts/dj-share/export-timeline.py \
  --build data/automix/builds/life-timeline-v1-20261009/regeneration.json \
  --out data/dj-share-life-timeline
```

The first command probes all selected MP3 streams, checks source stability,
exports CSV/M3U8/checksums, and reads back every ZIP member for CRC and SHA-256.
The second exports only completed renders whose hashes, sizes, chapter counts
and complete fixed order agree with the build proof. Mix JSON and order CSV also
include the chosen original-audio intervals when the renderer provides them.
Mix details also contain all source section boundaries and their analysis method.
Generic novelty sections describe changes in sound, without claiming verse or
chorus labels. Final encoded-audio evidence includes chapter titles/times, stereo
overlap peaks, continuity warnings and independent beat detection for beatmatched
overlaps. These checks do not certify listening quality or whole-mix beat alignment.

Keep any retained historical package separate from `data/dj-share-50/`. The
old `audio/life-timeline/`, `mixes/timeline-*`, `exports/life-timeline/` and
`catalog/life-timeline-*` public paths are withdrawn. Do not upload the v2
collection or its handover, era notes, analysis snapshots or mixes to the public
site. The separately authorized playlist “50” public page is unaffected.
