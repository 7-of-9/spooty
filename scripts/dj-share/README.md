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
