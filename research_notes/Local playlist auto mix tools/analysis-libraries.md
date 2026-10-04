# Analysis libraries for DJ-style auto-mix of local MP3s

Scope: local-file, batch (~70-track folder) analysis on macOS (ffmpeg already available) for a personal/local Node/Python/C++ web app. Features of interest: BPM/tempo, beatgrid timestamps, downbeats, musical key / Camelot, energy, phrase/structure, optional stems. Distinguishes research prototypes vs production-usable tools. Licenses matter because a local web app is not necessarily open-sourced.

---

## Essentia (MTG): RhythmExtractor, KeyExtractor, BeatTracker, MusicExtractor — license, Python/C++, Node bindings?

### Takeaway
Essentia is the most complete single open-source MIR stack (C++ core, Python bindings, CLI extractors, JS/WASM via essentia.js) and already emits mix-usable beat times plus three key-profile estimates in JSON, but it is **Affero GPLv3** (proprietary license sold by UPF) and Python wheels are Linux-oriented; macOS install is Homebrew/source, not a one-liner `pip`.

### Cited Findings
- Essentia is an open-source C++ library for audio analysis / MIR, “also wrapped in Python,” with “predefined executable extractors” that return yaml/json, plus a Vamp plugin. Released under **Affero GPLv3**. — [MTG/essentia README](https://github.com/MTG/essentia); [Essentia overview](https://essentia.upf.edu/documentation.html)
- Official licensing page: open licence is Affero GPLv3 “for non-commercial applications”; a commercial/proprietary licence is available from Music Technology Group (UPF). Pre-trained ML models are **CC BY-NC-ND 4.0** for non-commercial use (proprietary on request). Third-party deps include GPL FFTW (replaceable by Kiss FFT or Apple Accelerate), LGPL FFmpeg/TagLib, BSD libsamplerate. — [Licensing Essentia](https://essentia.upf.edu/licensing_information.html)
- Overview lists **Python bindings (Linux and OSX)** and **command-line extractors (Linux, OSX, and Windows)**. Rhythm: beat detection, BPM, onset, beat loudness. Tonal: HPCP/chroma, chords, key/scale, tuning. Other: danceability, dynamic complexity, audio segmentation, TensorFlow wrapper. — [Essentia overview](https://essentia.upf.edu/documentation.html)
- Algorithm catalogue: `BeatTrackerDegara` (complex spectral difference), `BeatTrackerMultiFeature` (combines 5 trackers by mutual agreement), `RhythmExtractor2013` (BPM + beat positions using Degara or MultiFeature), `KeyExtractor` (key and scale), `TonalExtractor` (key, scale, chords), `RhythmDescriptors`, and a catch-all `Extractor`. — [algorithms_overview.rst](https://github.com/MTG/essentia/blob/master/doc/sphinxdoc/algorithms_overview.rst)
- `essentia_streaming_extractor_music` is the batch CLI used by AcousticBrainz. Rhythm outputs include **`beats_position`**: time positions **in seconds** of Degara 2012 beats; `beats_count`; `bpm`; BPM histogram peaks; `beats_loudness` / band ratios; `onset_rate`; `danceability`. Tonal: `key_temperley`, `key_krumhansl`, `key_edma` (key, scale, strength via three HPCP profiles); chords histogram/change rate. Low-level energy proxies: `loudness_ebu128`, `average_loudness`, `dynamic_complexity`, spectral energy bands. Default rhythm method `degara`, tempo range 40–208 BPM. Output JSON or YAML; `outputFrames: 1` stores per-frame values. Audio is resampled to 44.1 kHz, summed to mono, ReplayGain-normalized. — [Music extractor](https://essentia.upf.edu/streaming_extractor_music.html)
- Python usage example: `MonoLoader` + `BeatTrackerMultiFeature()` returns beat times and confidence. — [ACM SIGMM Records](https://records.sigmm.org/2014/03/20/essentia-an-open-source-library-for-audio-analysis/)
- Install: `pip install essentia` / `essentia-tensorflow` documented for **Linux `x86_64`/`i686`**. Docker images at `mtgupf/essentia`. Prebuilt static extractor binaries exist so you need not install the full library. — [MTG/essentia README](https://github.com/MTG/essentia)
- macOS: “easiest way” is the [Homebrew formula](https://github.com/MTG/homebrew-essentia). Source build needs eigen, FFTW, ffmpeg@2.8, libsamplerate, libtag, chromaprint, tensorflow via brew, then `python3 waf configure --build-static --with-python --with-examples`. — [Installing Essentia](https://essentia.upf.edu/installing.html)
- JavaScript/Node path is a **separate** project, essentia.js (WASM), same AGPL licensing page. — [essentia.js GitHub](https://github.com/MTG/essentia.js); [licensing](https://essentia.upf.edu/licensing_information.html)
- There is **no official native Node C++ addon** in the main Essentia repo; Node is via essentia.js WASM.

### Inferences
- For a ~70-track folder, the production path is the **CLI music extractor** (or Python `MusicExtractor` / `RhythmExtractor2013` + `KeyExtractor`) writing JSON sidecars: beat times in seconds are already mix-grid material; keys come as three profile votes (Temperley / Krumhansl / EDMA).
- AGPL is the main product constraint: a networked local web UI that *distributes* Essentia-derived binaries can trigger AGPL source-offer obligations. Personal non-distributed use is the intended AGPL “test before commercial licence” path. essentia-tensorflow models add **CC BY-NC-ND**.
- macOS install is harder than librosa (`pip`) but easier than compiling madmom Cython on bleeding-edge Python, if the Homebrew formula works on current macOS.
- Danceability / dynamic complexity / EBU R128 / beat loudness are the closest first-party “energy” features; there is no Camelot wheel in Essentia itself (map key+scale after the fact).

### Gaps
- No sourced 2024–2026 MIREX/ISMIR beat-F-measure for RhythmExtractor2013 vs madmom DBN / Beat This on a shared dataset in these pages.
- Homebrew formula currency on Apple Silicon / current macOS not verified from the install page (page still mentions `/usr/local` PATH and `ffmpeg@2.8`).
- Downbeat / bar-position output is **not** listed in the music extractor rhythm block (beats only). Whether a separate Essentia downbeat algorithm exists and ships in the extractor was not confirmed here.
- Node: no first-party napi/node-gyp binding; only WASM.

---

## librosa: beat_track, tempo, chroma, key estimation quality (known limitations)

### Takeaway
librosa is the easiest Python batch library (ISC licence, `pip install librosa`) and gives mix-usable beat *times* after `frames_to_time`, but its Ellis 2007 DP tracker is a 2007-era baseline with classic **octave (×2/×½) tempo error**, weak variable-tempo behavior unless you opt into dynamic tempo / PLP, and **no first-party key detector**.

### Cited Findings
- librosa is a Python MIR library, install `pip install librosa` or `conda install -c conda-forge librosa`. Licence: **ISC**. ~8.6k GitHub stars. — [librosa/librosa](https://github.com/librosa/librosa); [ISC license copyright 2013–2026](https://github.com/librosa/librosa/commit/3e4ff7bf5898ac5b326e7dee56463b4b325b91cb)
- Beat module: `beat_track` is a **dynamic-programming beat tracker**; `plp` is Predominant Local Pulse; `tempo` estimates BPM. — [Beat and tempo docs (0.9.1)](https://librosa.org/doc-playground/latest/beat.html)
- `beat_track` follows Ellis 2007: (1) onset strength, (2) tempo from onset correlation, (3) pick peaks consistent with that tempo. Returns `tempo` (global BPM) and `beats` (default: **frame indices**, convert with `librosa.frames_to_time`). If no onsets, estimates 0 BPM. Optional `bpm=` override, `start_bpm`, `tightness`, `trim`. — [librosa/beat.py](https://github.com/librosa/librosa/blob/5ca70f5d57fc597660452f011ffff55f9c36ed4b/librosa/beat.py); [SciPy paper](https://www.researchgate.net/publication/328777063_librosa_Audio_and_Music_Signal_Analysis_in_Python)
- Default tracker estimates a **single global tempo** (small local fluctuation allowed). “Not well suited for songs that have radical shifts in tempo.” Dynamic path: `librosa.feature.tempo(..., aggregate=None)` then beat tracking with that series; `std_bpm` default 1, example uses 4. Sliding window `ac_size` default 8 s. Docs themselves call the dynamic tempo plot “not perfect: jagged and nonuniform steps.” — [Beat tracking with time-varying tempo](https://librosa.org/doc/main/auto_tutorials/03-advanced/plot_dynamic_beat.html)
- `plp` “may be preferred over the dynamic programming method of `beat_track` when the tempo is expected to vary significantly” and can run without the entire signal. — [librosa/beat.py](https://github.com/librosa/librosa/blob/5ca70f5d57fc597660452f011ffff55f9c36ed4b/librosa/beat.py)
- Tempo **octave error** is the standard failure: a Stack Overflow case reports true 146 BPM estimated as 73.5. Answer (Hendrik Schreiber) names Acc1 vs Acc2 metrics from Gouyon et al. “Experimental Comparison of Audio Tempo Induction Algorithms,” and notes CNN methods (Schreiber; Böck multi-task tempo+beat) outperform autocorrelation; “a CNN could also be implemented in librosa, [but] it currently is missing the programmatic infrastructure… Essentia [is] a step ahead.” — [SO 61621282](https://stackoverflow.com/questions/61621282/how-can-we-improve-tempo-detection-accuracy-in-librosa)
- Chroma: `chroma_cqt` / `chroma_stft` produce 12×T pitch-class energy; tutorial recommends HPSS so percussion does not pollute chroma, then `librosa.util.sync` to beat frames. — [librosa tutorial](https://librosa.org/doc-playground/main/tutorial.html)
- librosa **notation helpers** (`key_to_notes`, `key_to_degrees`) parse a key *string you already have* (`C:maj`). They do **not** estimate key from audio. — [librosa.core.notation](https://librosa.org/doc/latest/_modules/librosa/core/notation.html); [key_to_degrees](https://librosa.org/doc-playground/main/generated/librosa.key_to_degrees.html)
- Third-party key estimators on top of librosa chroma + Krumhansl–Schmuckler profiles exist (e.g. pyKeyFinder), including Camelot mapping — these are **not** librosa APIs. — [hPerezz/pyKeyFinder](https://github.com/hPerezz/pyKeyFinder)
- Paper notes beat-tracker performance “can vary substantially with small changes in certain key parameters.” — [librosa SciPy paper](https://www.researchgate.net/publication/328777063_librosa_Audio_and_Music_Signal_Analysis_in_Python)
- `librosa.util.find_files(directory, ext=...)` is a built-in folder crawler for batch jobs. — [librosa.util.files](https://librosa.org/doc/latest/_modules/librosa/util/files.html)

### Inferences
- Fine as a **decode + feature** layer (load MP3 via audioread/soundfile, chroma, RMS energy, beat times) and as a glue library. Not the beat/key engine you would ship for DJ grids.
- Always convert frames→seconds and store both BPM and the beat array; never trust BPM alone (octave error). Acc2 (octave-tolerant) will look much better than Acc1.
- For constant-tempo dance music, Ellis DP is often “good enough” after a ×2 correction heuristic; for live/variable pop it is the wrong tool versus madmom DBN / Beat This / allin1.

### Gaps
- No official librosa key-estimation algorithm or accuracy number.
- Latest `beat_track` signature/units on librosa 1.0.0 not fetched (1.0 docs URL 404’d); GitHub source + 0.9/main tutorials used instead.
- No sourced head-to-head of librosa vs Mixxx Queen Mary on dance-music beatgrid drift.

---

## madmom, aubio, BeatNet, allin1, madmom DBN beat tracking (and Beat This)

### Takeaway
For **offline mix grids**, 2024 **Beat This!** (MIT, beats+downbeats in seconds, optional madmom DBN) is the current open accuracy leader; **madmom DBN** is the classic production decoder but its **models are CC BY-NC-SA** and 0.16.1 breaks on Python ≥3.10; **allin1** is the one library that also emits intro/verse/chorus timestamps (MIT, but pulls Demucs + madmom); **BeatNet** adds causal/online mode; **aubio** is the lightweight GPL-3 C library with a beat-timestamp CLI, weaker accuracy.

### Cited Findings

**madmom**
- Python MIR library (JKU Linz / OFAI). **Dual licence: source BSD; model/data files CC BY-NC-SA 4.0** — commercial use of models requires contacting Gerhard Widmer. — [CPJKU/madmom](https://github.com/CPJKU/madmom)
- DBNBeatTracker implements Böck/Krebs/Widmer ISMIR 2014 multi-model paper but “does not use the multi-model… i.e. this version corresponds to the pure DBN version.” State space from Krebs ISMIR 2015. CLI: `single` and **`batch`** modes; writes beat times. — [bin/DBNBeatTracker](https://github.com/CPJKU/madmom/blob/main/bin/DBNBeatTracker); [usage.rst](https://github.com/CPJKU/madmom/blob/master/docs/usage.rst)
- `DBNBeatTrackingProcessor` returns beat positions **in seconds** (example: `array([0.1, 0.45, 0.8, ...])`). Tempo range default min_bpm=55, max_bpm=215. — [madmom.features.beats](https://madmom.readthedocs.io/en/latest/modules/features/beats.html)
- `DBNDownBeatTrackingProcessor(beats_per_bar=[3,4], fps=100)` returns beat time + **position inside the bar starting at 1**. — [madmom.features.downbeats](https://madmom.readthedocs.io/en/latest/modules/features/downbeats.html)
- 2016 library paper: madmom entries ranked **1st** on several MIREX tasks (CNNOnset 2016, BeatTracker MCK 2015, DBNBeatTracker SMC 2015, DBNDownBeatTracker 2016). — [madmom ACM MM 2016 PDF](https://www.researchgate.net/publication/308841812_madmom_A_New_Python_Audio_and_Music_Signal_Processing_Library)
- Install: `pip install madmom` (needs numpy/scipy/cython/mido). ffmpeg required for non-44.1 kHz 16-bit WAV. — [madmom README](https://github.com/CPJKU/madmom)
- **Python ≥3.10 / NumPy ≥1.24 breakage** is widely documented: `MutableSequence` import from `collections`, `np.float` removed. BeatNet README: use Python 3.9 **or** patch madmom. allin1 install instructs `pip install git+https://github.com/CPJKU/madmom` (Git main, not PyPI 0.16.1). — [BeatNet README](https://github.com/mjhydri/BeatNet/blob/main/README.md); [allin1 README](https://raw.githubusercontent.com/mir-aidj/all-in-one/main/README.md); [mgazier/madmom_python311](https://github.com/mgazier/madmom_python311)

**aubio**
- C library (Python + NumPy module) for onset, pitch, **tempo/beat**. CLI `aubiotrack` “outputs the time stamp of detected beats.” Licence: **GPL-3.0-or-later**. — [aubio README](https://github.com/aubio/aubio/blob/master/README.md)
- `aubio_tempo_get_bpm()`; `new_aubio_tempo(method, buf_size, hop_size, samplerate)` — method currently unused, pass `"default"`. Default example hop 512 / buf 1024. — [tempo.h](https://aubio.org/doc/latest/tempo_8h.html); [aubiotrack.c](https://github.com/aubio/aubio/blob/master/examples/aubiotrack.c)
- Optional ffmpeg/CoreAudio decoders. — [python/README](https://github.com/aubio/aubio/blob/master/python/README.md)
- **node-aubio**: FFI bindings, also GPL-3, requires system aubio dylib; last-look API is low-level. — [aubio/node-aubio](https://github.com/aubio/node-aubio)
- BeatNet paper Table 2 (online): Aubio beat F-measure **57.09 GTZAN / 56.73 Ballroom / 59.83 Rock Corpus** vs BeatNet **75.44 / 77.41 / 73.13**. — [arXiv 2108.03576](https://ar5iv.labs.arxiv.org/html/2108.03576)

**BeatNet**
- “SOTA AI-based Python library for joint music beat, downbeat, tempo, and meter tracking” (ISMIR 2021). Modes: stream (mic), realtime, online (causal, faster-than-realtime), offline. Inference: **PF** (particle filter, causal) or **DBN** (madmom, offline). Output: `numpy_array(num_beats, 2)` — beat time + downbeat column. Audio resampled to **22050 Hz**. `pip install BeatNet`. Licence badge **CC BY 4.0**. — [BeatNet README](https://github.com/mjhydri/BeatNet/blob/main/README.md)
- Offline still uses **BeatNet’s CRNN**, not madmom’s RNN, “better performance and significantly faster.” Depends on librosa + madmom. — same README
- Paper Table 2 offline GTZAN: BeatNet+DBN **80.64 beat F / 54.07 downbeat F** vs Böck/madmom **79.09 / 51.36**. Online BeatNet beats 75.44 vs Aubio 57.09. — [arXiv 2108.03576](https://ar5iv.labs.arxiv.org/html/2108.03576)
- BeatNet+ (separate repo): 4-layer LSTM, Demucs in training; claims GTZAN **80.62 / 56.51** vs BeatNet 75.44 / 46.69. — [BeatNet-Plus README](https://raw.githubusercontent.com/mjhydri/BeatNet-Plus/main/README.md)

**allin1 (All-In-One Music Structure Analyzer)**
- Predicts **tempo, beats, downbeats, functional segment boundaries, labels** (intro, verse, chorus, bridge, outro, …). PyPI `allin1`, Python ≥3.8. CLI: `allin1 file1.wav file2.mp3` → `./struct/*.json`. — [allin1 README](https://raw.githubusercontent.com/mir-aidj/all-in-one/main/README.md); [PyPI allin1](https://pypi.org/project/allin1/)
- JSON schema (mix-usable timestamps): `bpm`; `beats: [0.33, 0.75, ...]`; `downbeats`; `beat_positions: [1,2,3,4,1,...]`; `segments: [{start, end, label}, ...]`. Labels: start, end, intro, outro, break, bridge, inst, solo, verse, chorus. — same README
- Internally **Demucs-demixes** then analyzes; `--keep-byproducts` keeps stems under `./demix`. Install: PyTorch, NATTEN (macOS auto-installs), `pip install git+https://github.com/CPJKU/madmom`, `pip install allin1`, ffmpeg for MP3. Default model `harmonix-all` (8-fold ensemble on Harmonix Set). — same README
- Speed claim: RTX 4090 + i9-10940X, `harmonix-all`, **10 songs (33 min) in 73 seconds**. — same README
- **MP3 decoder offset warning**: different MP3 decoders can shift audio **20–40 ms**; beat-tracking tolerance is conventionally **70 ms**. Author recommends ffmpeg→WAV first. Demucs itself uses ffmpeg for MP3. — same README
- Licence: **MIT** (copyright 2023 Taejun Kim). Paper: Kim & Nam, WASPAA 2023, ~300K params, SOTA on Harmonix for beat/downbeat/segment/label jointly. — [GitHub LICENSE tree](https://github.com/mir-aidj/all-in-one/tree/ac942b8663b69f972407c79c28ff09986fad63c3); [arXiv 2307.16425](https://arxiv.org/pdf/2307.16425)
- Apple Silicon port: `all-in-one-mps` (MIT, retains upstream). — [ssmall256/all-in-one-mps](https://github.com/ssmall256/all-in-one-mps)

**Beat This! (CPJKU, ISMIR 2024) — current open beat-tracker to prefer over madmom-alone**
- Foscarin/Schlüter/Widmer: transformer beat+downbeat tracker that **beats prior SOTA F1 without DBN**. Code MIT; `pip install beat-this`. CLI `beat_this audio.file -o out.beats` (directories supported). Python: `File2Beats(...)(path)` → **`beats, downbeats` lists**. Optional `--dbn` (madmom defaults). Models `final0` ~**78 MB**, `small*` ~**8.1 MB**. GPU default, `--gpu=-1` CPU, `--float16` on recent GPUs. — [CPJKU/beat_this](https://github.com/CPJKU/beat_this)
- Paper goal: generality (solo instruments, meter changes, classical tempo variation) by **removing DBN meter/tempo constraints**. — [arXiv 2407.21658](https://arxiv.org/html/2407.21658v1)
- Community Giant Steps BPM check (not paper): 664 tracks, Acc1 89.31% / Acc2 95.03%; ensemble Acc1 90.92% / Acc2 96.37%. Octave heuristic 78–185 BPM. — [beat_this issue 13](https://github.com/CPJKU/beat_this/issues/13)
- C++ port (ONNX Runtime, optional madmom-compatible DBN): [mosynthkey/beat_this_cpp](https://github.com/mosynthkey/beat_this_cpp). Rust port with M4 timings ~realtime. — [danigb/beat-this-rs](https://github.com/danigb/beat-this-rs.git)
- v1.1.0 (Apr 2025): PyPI, non-CUDA accelerators, raw activation dump. — [beat_this releases](https://github.com/CPJKU/beat_this/releases)

### Inferences
- **Batch 70-track mix grid (offline):** `beat_this` (beats+downbeats) **or** `allin1` (beats+downbeats+phrases). allin1 is slower/heavier (Demucs) but unique for mix in/out points.
- **madmom** is still the decoder many papers wrap; treat PyPI 0.16.1 as **unusable on modern Python** unless you install from Git and/or pin Python 3.9. CC BY-NC-SA models are a licence landmine for anything that is not strictly personal/non-commercial.
- aubio is the right choice only if you need a small C/GPL realtime tapper, not DJ-grid quality.
- BeatNet offline ≈ madmom accuracy with a faster frontend; its unique value is **causal/online**. CC BY 4.0 is more app-friendly than madmom models.

### Gaps
- No official Beat This vs allin1 vs madmom vs Mixxx Queen Mary table on the same DJ/dance corpus.
- allin1 last PyPI date in search snippet is 2023-10-10; 2025–2026 maintenance of the original repo vs the MPS fork was not fully dated.
- BeatNet CC BY 4.0 vs weight files: whether pretrained `.pt` files carry extra restrictions was not checked beyond the README badge.
- Exact aubio 0.4.9 last-release date / macOS bottle status not fetched.

---

## Key detection: KeyFinder / libKeyFinder, edmkey, Essentia KeyExtractor, Mixxx analyzer, Camelot mapping

### Takeaway
For dance/electronic folders, **libkeyfinder (GPL-3, now Mixxx-maintained)** is the open tool with the best DJ-community reputation and a 2026 200-track test putting it **ahead of Rekordbox 7** (76% vs 69% exact); Essentia `KeyExtractor` / `key_edma` is the research-grade HPCP alternative; Camelot is a **trivial post-map** of 24 major/minor keys, not a detector. Mixxx’s default is still faster Queen Mary (qm-dsp), not KeyFinder.

### Cited Findings
- **libkeyfinder**: C++11 library, **GPL-3.0-or-later**, written by Ibrahim Shaath (2011 MSc). Mixxx team took maintenance in 2020; shipped in **Mixxx 2.3**. Standalone GUI unmaintained. `brew install libkeyfinder` (stable 2.2.8, FFTW dep, Apple Silicon bottles). API: fill `KeyFinder::AudioData`, `k.keyOfAudio(a)` → `key_t`; also progressive chromagram. — [mixxxdj/libkeyfinder](https://github.com/mixxxdj/libkeyfinder); [docs](https://mixxxdj.github.io/libkeyfinder); [Homebrew](https://formulae.brew.sh/formula/libkeyfinder)
- Mixxx 2.3 announcement: KeyFinder “performs considerably better than the key analyzer from the QM-DSP library” but is “a lot slower” because QM divides sample rate by 8 and analyzes every 8th window (**~64× speedup**). Queen Mary remains **default**; user must enable KeyFinder in settings. Enabled on Windows/macOS/Fedora/Arch in that announcement. — [mixxx.org 2021-04-08](https://mixxx.org/news/2021-04-08-new-in-2-3-keyfinder/)
- Mixxx analyser wiki (edited 22 Feb 2026): `AnalyzerQueenMaryKey` returns a **key-change timeline**; `AnalyzerKeyFinder` “generally considered more accurate… for modern music. Returns a **single dominant key**.” Default plugin list puts Queen Mary first. — [Developer Guide Analysers](https://github.com/mixxxdj/mixxx/wiki/Developer-Guide-Analysers); [analyzerkey.cpp](https://github.com/mixxxdj/mixxx/blob/main/src/analyzer/analyzerkey.cpp)
- Mixxx key preferences: Fast Analysis = first **minute** only; notation display is user-selectable (includes Camelot-style options in the “Key Notation” setting). — [Mixxx 2.3 key detection manual](https://manual.mixxx.org/2.3/en/chapters/preferences/key_detection)
- **2026 Dubspot 200-track test** (by-ear reference, exact match = full credit): Mixed In Key 11 **178/200 = 89%**; **KeyFinder 152/200 = 76%** (83% with half-credit); **Rekordbox 7.2.13 138/200 = 69%**; Beatport metadata 121/200 = 60%. KeyFinder “90% on dance/electronic… 70% jazz, 60% ambient”; weakness “relative-major/minor ambiguity.” They ran KeyFinder via Mixxx/libKeyFinder; standalone app 3.0.10 “no longer actively developed.” — [Dubspot 2026](https://blog.dubspot.com/dubspot-lab-report-mixed-in-key-vs-beatport)
- Reddit r/DJs (Sep 2026): long-time Keyfinder users report **~8–9/10**; misses on vocal-heavy/atonal; Camelot 12B-type errors are the painful ones. — [r/DJs thread](https://www.reddit.com/r/DJs/comments/1woan3a/best_key_detection_software_nowadays/)
- **Essentia** `KeyExtractor` / music extractor `key_temperley`, `key_krumhansl`, `key_edma` (EDMA = EDM-oriented profile). — [Music extractor](https://essentia.upf.edu/streaming_extractor_music.html); [essentia.js KeyExtractor](https://mtg.github.io/essentia.js/docs/api/Essentia.html)
- **edmkey** (often styled “edmt” in DJ-tool lists): Faraldo, Jordà, Herrera, AES 2017 “A Multi-Profile Method for Key Estimation in EDM.” Python + **Essentia** (vendored frozen copy). Research replication scripts, **15 GitHub stars** — not a maintained product library. — [anxefaraldo/edmkey](https://github.com/anxefaraldo/edmkey)
- **Camelot wheel** is a labelling of the 24 keys (minor=`nA`, major=`nB`, e.g. A minor = 8A, C major = 8B). Libraries that emit it (mixxx-analyzer, pyKeyFinder, Mixxx UI) **map after** key detection. mixxx-analyzer (Queen Mary port, not KeyFinder): prints `Key` + `camelot`. — [Radexito/mixxx-analyzer](https://github.com/Radexito/mixxx-analyzer); [PyCamelot mapping helper](https://github.com/DJStompZone/PyCamelot)
- OpenKeyScan (2026 commercial-free marketing site) claims a CNN key detector and ranks itself above Mixed In Key; **not independently verified** in this research. — [openkeyscan.com 2026](https://www.openkeyscan.com/best-key-detection-software-2026)

### Inferences
- For a Spooty-like local app on dance-leaning MP3s: **libkeyfinder via C++/CLI or Mixxx-analyzer-style wrap**, plus a 24-entry Camelot table, is the production open stack. Expect residual relative-major/minor swaps.
- If already running Essentia for beats, `key_edma` is the in-family EDM profile (this is what edmkey built on) — one process, AGPL.
- Do not treat Mixxx “default analysis” as KeyFinder quality; you must select the plugin.
- Paid Mixed In Key still leads published tests; Rekordbox is **not** the open-source accuracy ceiling.

### Gaps
- No peer-reviewed MIREX-style number for libkeyfinder vs Essentia KeyExtractor vs Mixed In Key on a public dataset (Dubspot is a 200-track editorial test).
- Mixxx current default (2.5/2.6) KeyFinder-vs-QM not re-confirmed beyond 2.3 announcement + 2026 wiki still listing QM as first/default.
- “edmt” as a pip package name: only edmkey/AES2017 found; no living `edmt` PyPI key library identified.

---

## Structure / phrase: allin1, MSAF, Foote, chorus detection — mix in/out points

### Takeaway
**allin1 is the only production-shaped open tool that outputs timestamped intro/verse/chorus/outro segments plus a beatgrid in one JSON**; MSAF is a 2016 research framework (MIT) that implements Foote and other classic segmenters but is not DJ-ready; chorus-only research repos exist but are prototypes.

### Cited Findings
- allin1 segments are `{start, end, label}` in seconds — directly usable as mix-in (end of intro / start of verse) and mix-out (last chorus / outro) candidates. Functional labels: start, end, intro, outro, break, bridge, inst, solo, verse, chorus. — [allin1 README](https://raw.githubusercontent.com/mir-aidj/all-in-one/main/README.md)
- Paper: joint beat/downbeat/segment/label on **demixed** spectrograms with neighborhood attention; SOTA on Harmonix Set for all four tasks; ~300K parameters. — [arXiv 2307.16425](https://arxiv.org/pdf/2307.16425)
- AutoMashup (2025) uses **Demucs + allin1** (tempo, beats, downbeats, key, segments) to align mashups — an existence proof of this pipeline for automated mixing. — [arXiv 2508.06516](https://arxiv.org/pdf/2508.06516)
- **MSAF** (Nieto & Bello, ISMIR 2015/2016): Python framework for music structure analysis; features chromagram/MFCC/tonnetz/CQT; algorithms include several literature methods; datasets Beatles-TUT, SALAMI, Isophonics. Licence **MIT**. Docs: https://msaf.readthedocs.io. Install `pip install .` from repo (one mirror still says `pip install msaf`). — [urinieto/msaf](https://github.com/urinieto/msaf); [ISMIR 2015 PDF](https://ccrma.stanford.edu/~urinieto/MARL/publications/NietoBello-ISMIR2015.pdf)
- Foote-style novelty (self-similarity kernel) is one of the standard MSAF boundary algorithms (framework paper describes plugging in published segmenters). — [MSAF ISMIR 2015](https://ccrma.stanford.edu/~urinieto/MARL/publications/NietoBello-ISMIR2015.pdf)
- Chorus-from-structure research (beantowel): evaluates **pop-music-highlighter + 5 MSAF algorithms**; outputs MIREX structural segmentation format. Not a packaged DJ tool. — [beantowel/chorus-from-music-structure](https://github.com/beantowel/chorus-from-music-structure)
- Mixxx phrase detection is a **wishlist/GSoC architecture**, not a shipping analyser equivalent to Rekordbox phrases. Mixxx wiki: academic beat trackers tolerate ±4% windows, which is **too loose for DJ sync**; they want downbeats/phrases to build the longest possible fixed grid within 25 ms phase. — [Downbeats And Phrase Detection wiki](https://github.com/mixxxdj/mixxx/wiki/Downbeats-And-Phrase-Detection)
- DeeJay Plaza software comparison table lists **Phrase detect: Rekordbox yes; Mixxx/Serato/Traktor/VirtualDJ no** (as of that 2024/updated article). — [Best DJ software 2026](https://www.deejayplaza.com/en/articles/best-dj-software-apps)
- Mixxx `AnalyzerSilence` (ported in mixxx-analyzer) gives **intro/outro as first/last frame above −60 dB**, not musical phrases. — [mixxx-analyzer](https://github.com/Radexito/mixxx-analyzer)

### Inferences
- For auto-mix in/out: **allin1 segment labels** are the open-source Rekordbox-phrase analogue. Combine with downbeats so cuts land on bar 1.
- Silence-based intro/outro (Mixxx) is a cheap complement (DJ-style trim) but will fail on tracks that start on a full mix or have long ambient outros with energy.
- MSAF/Foote: useful if you want algorithm ablation or SALAMI-style unlabeled boundaries; you still have to map “segment A/B” to mix function yourself. Treat as research.

### Gaps
- allin1 accuracy on *DJ stems / YouTube rips / heavily compressed MP3s* (Harmonix is studio-ish) not sourced.
- Foote original paper performance numbers not re-fetched; MSAF last-release/Python 3.12 status not verified (repo still MIT, install-from-source).
- Rekordbox phrase algorithm is closed; no public spec to clone.

---

## Stem separation: Demucs, Open-Unmix, Spleeter (2026) — needed for auto-mix?

### Takeaway
**Spleeter is legacy** (Deezer, MIT, last GitHub tag v2.3.0 in 2021; PyPI saw a 2.4.x later but maintenance is inactive). **Demucs v4 HT** is the default open separator (MIT; Meta repo **archived 1 Jan 2025**, live fork `adefossez/demucs`, v4.1.0 on 11 Jul 2026). Open-Unmix is a weaker MIT/CC-BY-NC-SA reference. Stems are **not required** for BPM/key/beatgrid; they **are** required if you want vocal-aware mix points or allin1’s own frontend (it demixes internally).

### Cited Findings
- **Demucs** (Hybrid Transformer v4): drums/bass/vocals/other; MUSDB-HQ SDR **9.00 dB**, sparse+fine-tune **9.20 dB**. `htdemucs` default; `htdemucs_ft` 4× slower; experimental `htdemucs_6s` guitar+piano (piano “not working great”). CLI batch: `demucs FILE [FILE ...]`. `--two-stems=vocals` karaoke mode. CPU ~**1.5× realtime**. Licence **MIT**. — [facebookresearch/demucs](https://github.com/facebookresearch/demucs) (archived); [adefossez/demucs](https://github.com/adefossez/demucs)
- Meta repo banner: archived **Jan 1, 2025**. Author: use [github.com/adefossez/demucs](https://github.com/adefossez/demucs). Fork note 11/07/2026: **v4.1.0** modernized packaging, models on Hugging Face, Python ≥3.10, `uvx demucs`. Intel Macs: PyTorch ≤2.2 / Python ≤3.12. — [adefossez/demucs](https://github.com/adefossez/demucs)
- Demucs paper table: Spleeter overall SDR **5.9 dB** (25k songs); Open-Unmix **5.3**; Hybrid Demucs v3 **7.7**; HT Demucs ft v4 **9.0**. — same README comparison table
- **Open-Unmix**: PyTorch reference separator, four stems, `pip install openunmix`, `umx file.wav`. **Does not list MP3** (“wav, flac, ogg - but not mp3”). Default `umxl` weights **CC BY-NC-SA 4.0 (non-commercial)**; `umxhq`/`umx` trained on public MUSDB. Code MIT. UMXL vocals SDR 7.21 vs UMX 6.32. Last notable repo news: 16/04/2024 torch 2.0. — [sigsep/open-unmix-pytorch](https://github.com/sigsep/open-unmix-pytorch)
- **Spleeter**: Deezer, TensorFlow, pretrained 2/4/5-stem, MIT, `pip install spleeter`. README warns Apple **M1 TensorFlow issues**. GitHub Releases latest tag **v2.3.0** (TF 2.5 / Python 3.9). — [deezer/spleeter README](https://github.com/deezer/spleeter/blob/master/README.md); [releases](https://github.com/deezer/spleeter/releases)
- Snyk: PyPI **2.4.2** dated **3 Apr 2025** (Python 3.11, drop 3.7); maintenance classified **Inactive**; 245 open issues. — [Snyk spleeter](https://security.snyk.io/package/pip/spleeter); [CHANGELOG](https://github.com/deezer/spleeter/blob/master/CHANGELOG.md)
- 2026 vendor blogs (StemSplit/DEV/Melodex) uniformly say “use Demucs, skip Spleeter”; quote SDR vocals ~9.4 vs ~6.5 and TF1/TF2 pain. These are **commercial blog posts**, not independent papers — use Demucs’s own table as the primary SDR source. — [stemsplit.hashnode 2026](https://stemsplit.hashnode.dev/audio-stem-separation-in-python-demucs-spleeter-api-compared-2026-guide); [DEV 2026](https://dev.to/stevecase430/spleeter-is-dead-heres-why-everyones-switching-to-demucs-in-2026-j6e)
- allin1 **always demixes** as a feature frontend (bass/drums/other/vocals embeddings). Stems are a byproduct, not optional unless you use a fork with `--skip-separation`. — [allin1 README](https://raw.githubusercontent.com/mir-aidj/all-in-one/main/README.md); [autodj-mixer skip-separation note](https://github.com/StanAngular/autodj-mixer)

### Inferences
- **Need stems?** Only if (a) you want to duck/kill vocals during blends, (b) you want allin1-quality structure, or (c) you train/adapt beat models on drum stems. Pure harmonic mixing (BPM + key + beatgrid + energy) does **not** need Demucs.
- For 70 tracks on a Mac without NVIDIA: Demucs CPU is the expensive step (order of track-duration × 1.5). Do it once, cache stems, or skip and run Beat This + libkeyfinder on the mix.
- Licence: Demucs MIT is app-friendly; Open-Unmix **umxl** is not (NC); Spleeter MIT but operationally stale.

### Gaps
- Apple Silicon MPS performance for Demucs v4.1.0 not sourced from the official README (only Intel-Mac Python pin).
- BS-RoFormer / MelBand Roformer (2025–2026 UVR community SOTA) were mentioned only in vendor blogs — not evaluated from primary papers here.
- Whether allin1 can skip Demucs in the official package (vs third-party `--skip-separation`) not in the official README.

---

## Node-native options: node-beat-detector, meyda, web-audio-beat-detector, WASM ports

### Takeaway
Node-only beat/key stacks are **toy-grade vs Python MIR**: meyda is real-time *timbre* (RMS, centroid), not a beatgrid; web-audio-beat-detector is a Joe-Sullivan energy-flux BPM (good on EDM, BPM+offset only); `@audio/beat` is a newer DSP port with actual beat times; essentia.js is the only JS path that approaches research algorithms. There is no maintained package literally named `node-beat-detector` that matches madmom quality.

### Cited Findings
- **meyda**: JS audio feature extraction, Web Audio + offline arrays. MIT, ~1.7k stars. Features like RMS, spectral centroid, rolloff — **not** beat tracking or key. Compared as the lightweight baseline in the Essentia.js TISMIR paper. — [meyda/meyda](https://github.com/meyda/meyda); [meyda.js.org](https://meyda.github.io/)
- **web-audio-beat-detector** (chrisguttandin): npm 8.2.39 (Aug 2026), MIT, ~652 stars, ~2k weekly downloads. Joe Sullivan Web Audio technique. `analyze(AudioBuffer) → Promise<number>` (tempo); `guess() → { bpm, offset, tempo }` with **first-beat offset in seconds**. “Not as complex… surprisingly good results especially for electronic music.” Optional offset/duration. — [npm](https://www.npmjs.com/package/web-audio-beat-detector); [GitHub](https://github.com/chrisguttandin/web-audio-beat-detector)
- Related clones: `bpm-detective` (MIT, **90–180 BPM assumption**, dance-ish). `BeatDetect.js` (~5 kB, 4/4 EDM, returns bpm/offset/firstBar) — **browser Web Audio, “not supported in nodejs.”** — [tornqvist/bpm-detective](https://github.com/tornqvist/bpm-detective); [ArthurBeaulieu/BeatDetect.js](https://github.com/ArthurBeaulieu/BeatDetect.js)
- **`@audio/beat`**: onset + comb-filter tempo + DP `beatTrack`; `detect(samples,{fs})` → `{ bpm, beats: Float64Array seconds, onsets }`. Explicit mix-grid timestamps in JS. — [audiojs/beat-detection](https://github.com/audiojs/beat-detection)
- **realtime-bpm-analyzer**: TypeScript, Web Audio, files/streams/mic, MIT, “zero dependencies.” BPM events, not a full grid. — [dlepaux/realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer)
- **node-aubio**: GPL-3 FFI to system aubio; install friction. — [aubio/node-aubio](https://github.com/aubio/node-aubio)
- Essentia.js TISMIR 2021: existing JS libraries (Meyda ~20 algos, JS-Xtract ~70) implement “only a very limited set of MIR audio feature extraction algorithms”; essentia.js exposes **>200** C++ algorithms via WASM. Benchmarked vs native Essentia and Meyda on browsers + **Node.js**. — [TISMIR paper](https://www.researchgate.net/publication/356451173_Audio_and_Music_Analysis_on_the_Web_using_Essentiajs)
- Beat This C++/Rust ports exist if a Node app wants to **spawn a native binary** rather than pure JS. — [beat_this_cpp](https://github.com/mosynthkey/beat_this_cpp)

### Inferences
- Practical Node architecture: **child_process** to Python/C++ analysers (beat_this, allin1, essentia extractor, libkeyfinder), not a pure-npm beatgrid.
- If staying in-process JS: essentia.js `RhythmExtractor2013` / `KeyExtractor` (AGPL, ~2–3 MB WASM) or `@audio/beat` for a permissive-licence grid. web-audio-beat-detector is BPM+offset only — enough to *start* a constant grid, not to correct drift.
- meyda is the right tool for **live energy meters** (RMS) in the web UI, not analysis sidecars.

### Gaps
- No npm package whose canonical name is `node-beat-detector` was found; likely an informal name for web-audio-beat-detector / BeatDetect.js / music-beat-detector.
- `@audio/beat` accuracy vs madmom/Beat This not published.
- Node `AudioContext` / `audio-decode` MP3 decoding vs ffmpeg sample-accurate alignment not measured.

---

## essentia.js: browser vs Node, algorithms, size, real-time vs offline

### Takeaway
essentia.js is the official WASM port: **Node and browser**, offline and AudioWorklet realtime, AGPL, ~**1.9–2.5 MB** WASM plus ~40 kB min JS; it ships most **standard-mode** C++ algorithms including `KeyExtractor` and rhythm extractors, but **excludes MusicExtractor, file I/O loaders, FFTW, TensorFlowPredict, Yaml I/O** — you decode audio in JS first.

### Cited Findings
- “Run an extensive collection of music/audio processing and analysis algorithms/models on your web browser or **Node.js** runtime. It supports both **real-time and offline**.” Add-ons: extractors, TensorFlow.js models, Plotly viz. Licence: same Essentia AGPL page. API “currently under rapid development… backwards compatibility is not yet guaranteed.” — [MTG/essentia.js](https://github.com/MTG/essentia.js)
- Builds: `essentia.js-core` (IIFE/UMD/ES), WASM `essentia-wasm.web.wasm` (async) vs `essentia-wasm.es.js` / `.umd.js` (sync, **AudioWorklet**). “WASM back-end allows all essentia **standard mode** C++ algorithms **except** [excluded_algos.md].” — [essentia.js docs](https://mtg.github.io/essentia.js/docs/)
- **Excluded** (not in WASM): `MonoLoader`/`AudioLoader`/`EasyLoader`/`AudioWriter`, `MusicExtractor`/`Extractor`/`FreesoundExtractor`, `YamlInput`/`YamlOutput`, `MetadataReader`, `FFTW`/`FFT`/`IFFT` family, `TensorflowPredict*`, `GaiaTransform`/`MusicExtractorSVM`, `Onsets`, `FadeDetection`, `LoudnessEBUR128`, `Chromaprinter`, `PCA`, `PoolAggregator`, `SilenceRate`, `ConstantQ`, etc. — [excluded_algos.md](https://raw.githubusercontent.com/MTG/essentia.js/master/src/python/excluded_algos.md)
- **Included (docs):** `KeyExtractor(audio → {key, scale, strength})` with the same parameters as C++ (frameSize 4096, hop 2048, profileType, …). Also `Key(pcp)`. — [Essentia.js API KeyExtractor](https://mtg.github.io/essentia.js/docs/api/Essentia.html)
- Size: TISMIR paper “builds … as small as **2.5 MB**, and about **3 MB** with add-on modules.” jsDelivr 0.1.3: `essentia-wasm.web.wasm` **1.9 MB**, `essentia-wasm.es.js` **2.44 MB**, `essentia.js-core.min.js` **~42 kB**. — [TISMIR XML](http://transactions.ismir.net/articles/111/files/submission/proof/111-1-2905-1-10-20211122.xml); [jsDelivr dist](https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/); [unpkg 0.1.1](https://app.unpkg.com/essentia.js@0.1.1/files/dist)
- Node: `npm install essentia.js`; `const essentia = new esPkg.Essentia(esPkg.EssentiaWASM); essentia.algorithmNames`. Algorithms are single-shot methods (no separate configure/compute). Sync WASM “shouldn't [be] import[ed] on the main thread” in browsers — use AudioWorklet/Workers; async `essentia-wasm.web.js` on UI thread. — [Getting started](https://mtg.github.io/essentia.js/docs/api/tutorial-1.%20Getting%20started.html)
- Realtime tutorial: AudioWorkletProcessor instantiates Essentia WASM and processes 128-sample blocks. — [Real-time analysis tutorial](https://github.com/MTG/essentia.js/blob/master/docs/tutorials/2.%20Real-time%20analysis.md)
- Custom builds: `included_algos.md` + `code_generator.py` to shrink WASM. Docker `mtgupf/essentia-emscripten`. — [Building from source](https://mtg.github.io/essentia.js/docs/api/tutorial-4.%20Building%20from%20source.html)
- Node blog example: `audio-decode` to PCM, then `KeyExtractor`. — [Audio Features Extraction With JavaScript](https://cs310.hashnode.dev/audio-features-extraction-with-javascript-and-essentia)
- Latest npm in unpkg listing: **0.1.3** (“5 years ago” on one unpkg index — treat as **slow-moving**, not abandoned; GitHub still has CI). Releases mention a “basic Node.js example.” — [essentia.js releases](https://github.com/MTG/essentia.js/releases)

### Inferences
- essentia.js can do **offline KeyExtractor + rhythm algorithms in Node** if you decode MP3 yourself (ffmpeg → WAV/float32). You **cannot** call `MusicExtractor` in JS — that JSON dump stays a native CLI concern.
- 2 MB WASM is acceptable for a local Electron/Nest helper; less ideal on every browser page load.
- Realtime AudioWorklet is for live meters, not 70-file library analysis (offline batch on decoded buffers is the right mode).
- AGPL applies to the JS port too.

### Gaps
- Exact list of *rhythm* algorithms present in the default WASM (RhythmExtractor2013 vs BeatTrackerDegara) was not dumped from `algorithmNames` in this research (KeyExtractor is documented; MusicExtractor is excluded).
- 0.1.3 vs GitHub master feature delta, and Apple Silicon Node WASM performance, not benchmarked here.

---

## Typical pipeline: ffmpeg decode → analyze → JSON sidecar next to MP3

### Takeaway
This is already how AcousticBrainz/Essentia extractors, allin1, mixxx-analyzer, and Beat This CLIs work; for DJ mixing, **standardize on WAV/float decode first** (MP3 decoder offset 20–40 ms vs 70 ms beat tolerance), then write a sidecar with BPM, beat times, downbeats, key+Camelot, energy, and segments.

### Cited Findings
- Essentia music extractor: CLI `streaming_extractor_music input output [profile]`, JSON/YAML, batch on large collections, optional `startTime`/`endTime`, frame dump. — [Music extractor](https://essentia.upf.edu/streaming_extractor_music.html)
- allin1: `allin1 *.mp3` → `./struct/<name>.json` with bpm/beats/downbeats/beat_positions/segments; Python `analyze(..., out_dir=...)`. Explicit ffmpeg WAV recommendation. — [allin1 README](https://raw.githubusercontent.com/mir-aidj/all-in-one/main/README.md)
- Beat This: `beat_this dir/ -o outdir --skip-existing --touch-first` for parallel GPU workers; `save_beat_tsv(beats, downbeats, path)` Sonic Visualiser `.beats` format. — [beat_this README](https://github.com/CPJKU/beat_this)
- madmom: `DBNBeatTracker batch [-o OUTPUT_DIR] [-s OUTPUT_SUFFIX] FILES`. — [madmom usage](https://github.com/CPJKU/madmom/blob/master/docs/usage.rst)
- mixxx-analyzer: `mixxx-analyzer ~/Music/*.mp3` prints BPM, key, Camelot, LUFS, ReplayGain, intro/outro; Python `analyze_many`. Decode via FFmpeg libav. — [Radexito/mixxx-analyzer](https://github.com/Radexito/mixxx-analyzer)
- Demucs: `demucs PATH [PATH ...]` writes `separated/MODEL/TRACK/{drums,bass,other,vocals}.wav`. — [adefossez/demucs](https://github.com/adefossez/demucs)
- librosa: `find_files` + `load` (audioread/soundfile; ffmpeg helps MP3) + `beat_track` + `frames_to_time`. — [librosa util.files](https://librosa.org/doc/latest/_modules/librosa/util/files.html)
- Mixxx Fast Analysis: first **minute** only for BPM/key — fine for most 4/4 dance, wrong for long mixes / mid-track tempo maps. 0.02 BPM error “will cause beatgrid alignment issues on long tracks.” — [Mixxx 2.2 preferences](https://manual.mixxx.org/2.2/en/chapters/preferences)

### Inferences
- Suggested sidecar (conceptual, not an implemented spec):
  - `bpm`, `bpm_confidence` / octave flag
  - `beats[]`, `downbeats[]` (seconds, ffmpeg-decoded clock)
  - `key`, `scale`, `camelot`, `key_strength`
  - `energy`: LUFS and/or RMS / danceability
  - `segments[]` if allin1 run
  - `analyzer`, `model`, `file_mtime`, `audio_sha`
- Decode once with **ffmpeg to WAV/s16 or f32 44.1 kHz mono-or-stereo**, hash that PCM, run all analysers on the same buffer so grids share a clock.
- For ~70 tracks: Beat This + libkeyfinder + ebur128 is seconds-to-minutes on Apple Silicon; allin1+Demucs is the slow path (cache aggressively).

### Gaps
- No de-facto sidecar standard (MusicBrainz Picard, Rekordbox XML, Mixxx SQLite, Serato tags all differ). ID3 TBPM/TKEY vs sidecar-next-to-file is a product choice, not sourced as a consensus.
- Sample-accurate ffmpeg vs Chromium `decodeAudioData` offset on the same MP3 not measured.

---

## Rekordbox / Mixxx analysis quality vs these libraries

### Takeaway
Rekordbox is the **commercial UX/quality bar** (phrase detection + generally trusted grids, but 2026 key test **lost to KeyFinder**). Mixxx is the **open reference implementation** of Queen Mary beats + optional KeyFinder + silence intro/outro — good enough for 4/4 dance if you correct the first beat, weaker on phrases and on grid accuracy according to DJ reviews. Open research trackers (Beat This, allin1, madmom DBN) **exceed Mixxx’s QM beat tracker on academic F-measures**; they do not automatically produce a DJ-style constant beatgrid (you must fit BPM + offset and handle octave/phase).

### Cited Findings
- Mixxx “ultra-precise BPM and beat detector”; Fast Analysis = first minute; constant grid vs raw variable beat map; **offset errors** (correct BPM, wrong first beat) are the common failure; **0.02 BPM** drift ruins long tracks. — [Mixxx preferences](https://manual.mixxx.org/2.2/en/chapters/preferences)
- Mixxx beat architecture: Queen Mary Vamp plugin → **beat map** (variable); SoundTouch → **constant BPM only**. `mixxx::Beats` stores constant grid (BPM + anchor) or map. — [Developer Guide Analysers](https://github.com/mixxxdj/mixxx/wiki/Developer-Guide-Analysers); [Beat and Bar Edit Workflow](https://github.com/mixxxdj/mixxx/wiki/Beat-and-Bar-Edit-Workflow)
- Mixxx wiki on academic vs DJ evaluation: MIR beat F-measure uses **±4%** windows; DJ sync needs much tighter phase (they discuss **25 ms**). — [Downbeats And Phrase Detection](https://github.com/mixxxdj/mixxx/wiki/Downbeats-And-Phrase-Detection)
- mixxx-analyzer reuses **AnalyzerQueenMaryBeats** (qm-dsp TempoTrackV2) and **AnalyzerQueenMaryKey**, plus libebur128 LUFS / ReplayGain 2.0 (−18 LUFS) and AnalyzerSilence intro/outro. — [mixxx-analyzer](https://github.com/Radexito/mixxx-analyzer)
- DJ review compilation: Mixxx “inaccuracy of the beatgrid… off slightly for every single track”; some “completely off-grid.” Phrase detect column: Rekordbox yes, Mixxx no. Analysis-time table (1000 songs): Mixxx 2m 0s vs others. Rekordbox analyzes “Key, BPM, beatgrid, **phrases**.” — [DeeJay Plaza](https://www.deejayplaza.com/en/articles/best-dj-software-apps)
- Key: KeyFinder 76% vs Rekordbox 7 **69%** vs Mixed In Key 89% (Dubspot 2026, 200 tracks). Dance-only KeyFinder ~90%. — [Dubspot](https://blog.dubspot.com/dubspot-lab-report-mixed-in-key-vs-beatport)
- Mixxx 2.3: QM key “key randomizer” in user comments; KeyFinder integration called a “massive improvement.” — [r/DJs Mixxx 2.3](https://www.reddit.com/r/DJs/comments/mn4zl9/new_in_mixxx_23_keyfinder_support/)
- Academic beat SOTA (Beat This ISMIR 2024) reports beating Hung et al. / prior DBN systems on GTZAN F1 **without** DBN — a different metric than “DJ grid lock.” — [arXiv 2407.21658](https://arxiv.org/html/2407.21658v1)
- madmom historically MIREX-winning; librosa Ellis 2007 is the baseline everyone beats. — [madmom paper](https://www.researchgate.net/publication/308841812_madmom_A_New_Python_Audio_and_Music_Signal_Processing_Library)

### Inferences
- **Do not expect open libraries to “be Rekordbox.”** Rekordbox’s unpublished phrase + grid polish is the gap. allin1 is the closest open phrase system; Beat This/madmom are closer for beat/downbeat F1; libkeyfinder can beat Rekordbox on key.
- For auto-mix, prefer **timestamp lists** (beats, downbeats, segments) over a single BPM float. Fit a constant grid for 4/4 electronic; keep the map for everything else.
- Mixxx source is the right place to copy **ReplayGain/LUFS + silence intro/outro + Camelot display**, not the right place to copy beat SOTA.

### Gaps
- No published beat-F or grid-drift study of Rekordbox vs Beat This vs Mixxx QM on the same files (only key Dubspot test + anecdotal grid complaints).
- Pioneer/AlphaTheta analyser internals are closed.
- Energy 1–10 (Mixed In Key / Rekordbox) has **no open counterpart** with a documented scale; Essentia danceability/dynamic_complexity and LUFS are related but not calibrated to those UIs.

---

## Cross-cutting comparison (for the report writer)

| Tool | Lang | Licence | Mix timestamps | Batch | macOS install | Production vs research |
| --- | --- | --- | --- | --- | --- | --- |
| Essentia MusicExtractor / RhythmExtractor2013 / KeyExtractor | C++ / Python | **AGPL-3** (+ proprietary) | beats_position (s), BPM, 3 keys; no downbeats in extractor docs | Yes (CLI) | Homebrew / source (pip wheels Linux) | Production-capable; licence friction |
| essentia.js | JS/WASM | AGPL-3 | KeyExtractor; rhythm algos if in WASM; no MusicExtractor | DIY | `npm i essentia.js` (~2 MB WASM) | Usable; slow-moving 0.1.x |
| librosa | Python | ISC | beat frames→seconds; no key; octave BPM | Yes | `pip` easy | Glue/features; weak tracker |
| madmom DBN | Python | BSD code / **CC BY-NC-SA models** | beats & downbeats (s, bar pos) | Yes (`batch`) | pip; **broken on Py≥3.10** unless Git+patches | Classic SOTA; ops/licence pain |
| Beat This! | Python (C++/Rust ports) | MIT | beats + downbeats (s) | Yes | pip + PyTorch | **Best open beat tracker (2024)** |
| BeatNet | Python | CC BY 4.0 (badge) | (time, beat/downbeat) | Per-file API | pip; needs madmom | Strong; unique online mode |
| allin1 | Python | MIT | beats, downbeats, bar pos, **segments** | Yes (CLI list) | pip + PyTorch + Demucs + madmom Git | **Best open phrase+grid combo** |
| aubio | C / Python / node FFI | GPL-3 | beat timestamps, BPM | CLI | brew/source | Lightweight; weaker F-measure |
| libkeyfinder | C++ | GPL-3 | single key (map Camelot yourself) | DIY | `brew install libkeyfinder` | Best open DJ key |
| Mixxx QM + silence | C++ (qm-dsp) | Mixxx GPL | beat map/grid, key, intro/outro LUFS | Mixxx or mixxx-analyzer | Build Mixxx / pip mixxx-analyzer | DJ-production; not SOTA beats/phrases |
| Demucs v4 | Python | MIT | stems (not times) | Yes | pip/uv; CPU slow | Default open stems |
| Open-Unmix | Python | MIT / **umxl NC** | stems | umx CLI | pip; **no mp3** | Weaker; umxl licence trap |
| Spleeter | Python/TF | MIT | stems | Yes | stale TF; M1 issues | Legacy |
| meyda / web-audio-beat-detector | JS | MIT | BPM±offset; RMS energy | Browser/Node buffers | npm | Not mix-grade grids |

**Personal/local web app licence shortlist (not legal advice):** ISC/MIT/BSD/CC-BY (librosa, Beat This, allin1, Demucs, meyda) are the easy set. GPL-3 (libkeyfinder, aubio, Mixxx) is copyleft if you **distribute** linked binaries. AGPL (Essentia) is stricter for **network** apps. madmom **models** and Open-Unmix **umxl** are non-commercial.

**Practical 70-track folder on this Mac (ffmpeg present):**
1. ffmpeg normalize to WAV (avoid MP3 clock skew).
2. `beat_this` (or allin1 if you want phrases).
3. libkeyfinder or Essentia `key_edma` → Camelot table.
4. ebur128/LUFS + RMS for energy.
5. JSON sidecar; optional Demucs only if vocal-aware blends are in scope.
6. Node app shells out; do not rely on npm beat detectors for the grid.
