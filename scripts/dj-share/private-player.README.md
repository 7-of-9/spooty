# Private listening page

`serve-private.py` makes a local page for finished fixed-order timeline renders.
Choose their report basenames with `--labels`; the current selection is
`total-180s`, `total-240s` and `full`. The first two run for **three and four minutes
in total**, covering all selected songs. Their short source excerpts are not
per-song duration targets. The full version keeps every track in full.
The helper does not upload any data or alter
acquisition queues. Keep build files, handovers and output under ignored `data/`.

```sh
python3 scripts/dj-share/serve-private.py \
  --build data/automix/builds/SELECTED-BUILD \
  --tracklist data/automix/handover/SELECTED-HANDOVER/tracklist.json \
  --out data/dj-private/SELECTED-COLLECTION \
  --labels total-180s total-240s full \
  --port 4301
```

Open `http://127.0.0.1:4301/` on the same Mac. The page provides playback and MP3
downloads, chapter seeking, selected source sections, CUE files, order CSVs,
transition notes and JSON reports. The original selected source tracks are also
available. Warnings remain visible; file integrity is separate from musical
quality. The numbered chronology comes from the handover, never an energy sort.

All selected rendered files must already have final reports. Startup verifies each
MP3 against its recorded SHA-256 and byte size, and verifies source hashes,
chapter count and exact track order. Changed files fail closed. The server only
serves a fixed allowlist, binds to `127.0.0.1`, rejects cross-origin/rebinding
requests, and sends private/no-store headers. Its command line has no option to
bind to a public address. It is intended for personal use on a trusted Mac,
not as authentication against other users or processes on that same machine.

Titles and duration semantics come from the real render plan. A `durationMode`
of `total` requires a positive `totalTargetSeconds` and a verified MP3 duration
within one second of that target. The older `60s 90s 180s full` default remains
available for historical excerpt-per-song builds; those files are left intact.

`--prepare-only` validates the collection and creates its local metadata without
opening a server. Stop only the process you started when replacing a collection;
do not stop other local players or the acquisition app. A supervising process
can launch the same command again after a reboot; generated media stays on disk.

Boundary and byte-range tests:

```sh
python3 scripts/dj-share/private-player.test.py
node --test scripts/dj-share/private-player.test.mjs
```
