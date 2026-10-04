# automix (spike)

Command-line auto-mixer for a folder of MP3s. Separate from the Spooty web app for now.
It reads your MP3s but never modifies them. Everything it writes goes under `data/automix/`.

```sh
cd automix
uv run automix analyze ~/Desktop/mp3_downloads/50   # beats/downbeats, key, loudness, energy (cached)
uv run automix plan    ~/Desktop/mp3_downloads/50   # print the running order + transition styles
uv run automix serve   ~/Desktop/mp3_downloads/50   # audition page on http://127.0.0.1:4300/
uv run automix render  ~/Desktop/mp3_downloads/50   # full mix -> data/automix/sessions/<folder>/mixes/
```

Requires Python 3.12 via `uv`, `/opt/homebrew/bin/ffmpeg` and `brew install rubberband`.

## How it works

1. **Analyse** (`analyze.py`)
   - Beats and downbeats: [Beat This!](https://github.com/CPJKU/beat_this) (on the Apple GPU when available).
   - Key: Essentia, picking the most confident of three key-detection profiles (`edma`/`bgate`/`krumhansl`).
   - Loudness: EBU R128 (LUFS).
   - Energy features: danceability, onset strength, brightness, bass ratio and dynamic range.
   - Tempo is re-estimated from 16-beat spans, because Beat This! works on a 20 ms frame grid and its raw BPMs are quantised.
2. **Plan** (`plan.py`)
   - A weighted energy score splits the tracks into tiers: high, then mid, then chill.
   - Within each tier, a greedy ordering balances Camelot key distance, tempo gap and a gently falling energy.
   - Every file in the folder is included unless you leave it out on the page.
   - Each join gets a style:
     - `bassswap` / `blend`: beatmatched. Needs a regular beat grid and a tempo gap within the max stretch (half/double time allowed).
     - `fade` / `echo` / `cut`: no time-stretching.
   - The mix-out point snaps to a phrase boundary; the mix-in starts at the incoming track's first loud bar.
3. **Render** (`render.py`)
   - Beatmatched overlaps fit a constant-tempo beat grid to each side of the join (the Mixxx/rekordbox beatgrid assumption) and pin both to one output grid whose tempo glides from A to B via Rubber Band's `--timemap` (R2 engine: R3 drifts up to 80 ms on varying-ratio maps). Tracks whose beats will not fit a steady grid at the join fall back to echo/fade instead of a wobbly beatmatch.
   - The bass swap uses a zero-phase low/high split.
   - Tracks are normalised to the target LUFS, and a look-ahead limiter catches peaks.
   - The full mix streams straight into ffmpeg and comes out as MP3 with chapters, plus a `.cue` and a `.json` of the settings used.

Settings, per-transition overrides and manual order persist in
`data/automix/sessions/<folder>-<hash>/session.json`.

## Highlight medleys

The medley engine composes transitions between song highlights, using cached
structure and separate drums, bass, vocals and other stems where available:

```sh
uv run automix medley prep ~/Desktop/mp3_downloads/50
uv run automix medley build ~/Desktop/mp3_downloads/50 --out ../data/automix/builds/my-medley
```

V6 compares rendered candidates with different recipes and lengths. Its blend
score measures level dips, bass dropouts, abrupt level changes and overlapping
harmonic conflict. Beat-length energy windows distinguish normal spaces between
kicks from dropouts. Existing beat and playback checks still apply. Ratings,
repeated loops and pitch changes affect selection separately; a shorter
transition wins when scores are within three points, before variety is considered.

The build writes an MP3, a cue sheet and a JSON report containing each candidate's
measurements and the chosen result. Scores help compare alternatives; they do not
prove that a transition sounds good. Failed checks remain visible in the report
and audition page. Previous mixes and ratings are retained.

## Supporting analysis scripts

`scripts/clap_score.py` and `scripts/essentia_models.py` preserve the optional
model analysis tools previously kept under the ignored data folder. Run them
with the existing CLAP or Essentia TensorFlow Python environment, respectively:

```sh
../data/automix/venv-clap/bin/python scripts/clap_score.py --in-dir ~/Desktop/mp3_downloads/50
../data/automix/venv-essentia-models/bin/python scripts/essentia_models.py --dir ~/Desktop/mp3_downloads/50
uv run python scripts/audit_mix.py path/to/medley.json path/to/medley.mp3 path/to/audit.json
```

Model weights, caches and outputs stay in `data/automix/` (override with
`SPOOTY_AUTOMIX_DATA`). These optional model environments and weights are not
part of the main `uv` environment. The audit script measures encoded transition
continuity; it does not replace the medley verification report or listening.
