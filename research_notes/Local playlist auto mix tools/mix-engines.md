# Mix engines, auto-mix implementations, and preview-first bounce

Scope: tools and algorithms that actually **mix** tracks (time-stretch, beatmatch, crossfade, EQ, phrase alignment, bounce), not analysis-only. Local MP3 folder on macOS, 2026. Preview/audition first; optional later bounce to one continuous MP3. Honest about the quality gap between a volume crossfade and a DJ beatmatched mix.

---

## Time-stretch / pitch-shift for beatmatching (Rubber Band, SoundTouch, Signalsmith Stretch, elastique, ffmpeg atempo, WebAudio playbackRate)

### Takeaway

Professional beatmatching needs **independent tempo and pitch** (change BPM without chipmunking). Elastique (zplane, commercial) is the industry DAW/DJ gold standard; Rubber Band R3 is the best GPL/commercial dual-license option already used by Mixxx; Signalsmith Stretch is the best MIT-licensed embed for a closed app; SoundTouch/ffmpeg `atempo` are fast but audibly worse; HTML `playbackRate` + `preservesPitch` is good enough to **preview** a tempo match, not to bounce a mix.

### Cited Findings

- Rubber Band is a C++ library for independent tempo and pitch change, with a faster engine and a finer-quality engine introduced in v3.0; v4.0.0 was released 25 October 2024, with a command-line utility for macOS. Dual license: GPL v2+ for open source, paid commercial license (no royalties, no expiry) for proprietary apps. App Store distribution of the GPL edition is not allowed. — [Breakfast Quay Rubber Band](https://breakfastquay.com/rubberband/); [Why Rubber Band](https://breakfastquay.com/rubberband/why.html); [Licensing](https://breakfastquay.com/rubberband/license.html)
- Rubber Band’s real-time mode is lock-free streaming with freely adjustable time and pitch; offline mode is sample-exact with multi-processor support. The finer engine is described as “near-hi-fi quality” even on complete mixes; the authors state no stretcher is entirely transparent. — [Why Rubber Band](https://breakfastquay.com/rubberband/why.html)
- Mixxx wraps Rubber Band for keylock/time-stretch (`EngineBufferScaleRubberBand`) and SoundTouch as the always-available faster alternative (`EngineBufferScaleST`, WSOLA). Keylock engines: `SoundTouch`, `RubberBandFaster` (R2), `RubberBandFiner` (R3). Rubber Band runs with `OptionProcessRealTime`; R3 uses `OptionEngineFiner`. Scratching does **not** use Rubber Band — Mixxx uses a linear interpolator because stretchers cannot follow rapidly changing tempo. — [Mixxx discourse, Oct 2025](https://mixxx.discourse.group/t/which-source-files-implement-the-algorithm-mixxx-uses-for-time-stretching/32784); [enginebufferscalerubberband.cpp](https://github.com/mixxxdj/mixxx/blob/main/src/engine/bufferscalers/enginebufferscalerubberband.cpp); [Developer Guide Engine Player (search excerpt)](https://github.com/mixxxdj/mixxx/wiki/Developer-Guide-Engine-Player); [GSOC 2025 resampling report](https://mixxx.org/news/2025-08-04-gsoc-2025-report-armaan-chowfin/)
- SoundTouch (Olli Parviainen) is LGPL v2.1 with a paid non-LGPL commercial option. It changes Tempo (time-stretch, pitch preserved), Pitch (key, tempo preserved), or Playback Rate (both, vinyl-style). Algorithm is WSOLA/SOLA; real-time latency max ~100 ms. Widely described as faster and lower quality than Rubber Band. — [SoundTouch home](https://www.surina.net/soundtouch/); [Qiita comparison (JP, 2018)](https://qiita.com/hotwatermorning/items/9444015fd05aa39ebb9b)
- Signalsmith Stretch is a C++11 MIT-licensed polyphonic pitch/time library (ADC22 “Four Ways To Write A Pitch-Shifter”). Time-stretch “sounds best” between **0.75× and 1.5×**; pitch-shift can span multiple octaves. Header-only include of `signalsmith-stretch.h`. Official Web Audio WASM/AudioWorklet build in `web/` and on npm (`signalsmith-stretch`). Python binding (`python-stretch`) is the default pitch/time method in Audiomentations. Rust wrapper exists. — [signalsmith-stretch README](https://github.com/Signalsmith-Audio/signalsmith-stretch)
- A 2026 comparison article states: most stretch libraries (Rubber Band, SoundTouch) time-stretch then resample to shift pitch; Signalsmith applies frequency mapping and time mapping **together**. License table: Elastique commercial; Rubber Band GPL/commercial; Signalsmith MIT; SoundTouch LGPL. Community consensus (that article, not a controlled listening test) puts Signalsmith “alongside Rubber Band’s newer R3 engine.” A KVR user preferred Signalsmith over Rubber Band for offline drum-sample pitching. — [PracticeSession Signalsmith deep-dive](https://www.practicesession.app/blog/signalsmith-stretch-deep-dive/); [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?t=623537)
- Tenacity (Audacity fork) planned algorithm preference: Rubber Band default, Signalsmith for extreme cases, SoundTouch as low-quality/legacy fallback. — [Tenacity issue #377](https://codeberg.org/tenacityteam/tenacity/issues/377)
- zplane **elastique** is the commercial spectral stretcher used by Ableton, Cubase, FL Studio, Reaper, Pro Tools, and DJ.Studio (paid Elastique Pro extension, €99/$99, in-app only). zplane’s own docs: “one of the most used time stretching and pitch shifting algorithm in the market” and “able to run in realtime which makes it the perfect solution for DJing.” Licenses: commercial / server / in-house / academic; evaluation period 3 weeks; royalties typical. Partners list includes Ableton, algoriddim (djay), Native Instruments, Beatport. zplane also sells **AUFTAKT** (tempo/beat tracking) and **BARBEATQ** (cue-point detection) as separate SDKs. — [zplane licensing](https://licensing.zplane.de/); [elastique Efficient SDK PDF](https://licensing.zplane.de/uploads/SDK/ELASTIQUE-EFF/V3/manual/elastique_efficient_v3_sdk_documentation.pdf); [DJ.Studio Elastique Pro extension](https://help.dj.studio/en/articles/12108047-elastique-pro-extension-in-dj-studio); [Wide Blue Sound DAW stretch survey 2025](https://www.widebluesound.com/blog/top-daws-and-their-time%e2%80%91stretch-algorithms-2025/)
- Tracktion Engine can compile against SoundTouch, Rubber Band, Elastique, and Signalsmith Stretch, defaulting to whichever is enabled (Elastique Pro if present). — [tracktion_TimeStretch.h](https://github.com/Tracktion/tracktion_engine/blob/develop/modules/tracktion_engine/timestretch/tracktion_TimeStretch.h)
- ffmpeg `atempo` adjusts tempo in range **[0.5, 100.0]**; values >2 “skip some samples rather than blend them in”; daisy-chain for large ratios. This is WSOLA-class, not a DJ stretcher. ffmpeg `rubberband` filter wraps librubberband (`tempo`, `pitch`, transients crisp/mixed/smooth, formant shifted/preserved) but **only if ffmpeg was configured `--enable-librubberband`**. — [FFmpeg Filters: atempo](https://ffmpeg.org/ffmpeg-filters.html#atempo); [FFmpeg Filters: rubberband](https://ffmpeg.org/ffmpeg-filters.html#rubberband); [ayosec ffmpeg 7.1 rubberband](https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Audio/rubberband.html)
- HTMLMediaElement `playbackRate` changes speed. MDN (2025): “The pitch of the audio track does not change when playBackRate is altered” for `<audio>`/`<video>`. `preservesPitch` defaults to `true` (widely available since December 2023). Recommended practical range 0.5–4; outside that many browsers mute audio. **AudioBufferSourceNode.playbackRate is different** — it is a resampling rate and **does** change pitch (chipmunk/vinyl). Wikipedia: “Pitch-corrected audio timestretch is found in every modern web browser as part of the HTML standard for media playback.” — [MDN playbackRate explained](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/WebAudio_playbackRate_explained); [MDN preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch); [Wikipedia: Audio time stretching](https://en.wikipedia.org/wiki/Audio_time_stretching_and_pitch_scaling)
- Bungee’s public stretch comparison includes Rubber Band 4.0.0 R3, Signalsmith, SoundTouch 2.3.1, elastique 3.4.5 SDK Pro, Serato Studio 2.3.1, Superpowered Web Audio SDK 2.7.2, and “this browser’s built-in audio stretch via audio tag’s playbackRate.” Quantitative tables show rubberband and soundtouch introducing more residual noise on synthetic tones than elastique/bungeepro; the page is a vendor comparison (Parabola Research / Bungee) and should be treated as interested. — [Bungee comparison](https://bungee.parabolaresearch.com/compare-audio-stretch-tempo-pitch-change)
- PitchTech listening-test page (2024) lists Elastique Efficient/PRO, Rubberband, SoundTouch high-quality, iZotope Radius, etc., with wall-clock times to stretch 60 s of 44.1 kHz stereo at 110% length: Elastique Efficient 0.69 s, SoundTouch HQ 0.92 s / fast <0.25 s, Elastique PRO 1.0 s, Rubberband 2.51 s. Quality is presented as audio clips, not MOS scores. — [PitchTech tstest](https://www.pitchtech.ch/tstest/index.html)

### Inferences

- For a **preview** of beatmatching in a browser, `HTMLAudioElement.playbackRate` with `preservesPitch = true` (or Signalsmith’s WASM worklet) is the practical lever: cheap, real-time, good enough to hear whether 124→128 BPM is acceptable. Do not bounce a mix that way.
- For a **bounce** that should sound like Mixxx/Rekordbox keylock, use Rubber Band R3 (CLI `rubberband` binary ships for macOS) or ffmpeg `rubberband=` **if** the local ffmpeg build includes librubberband. Fallback: SoundTouch / `atempo` only for ≤~8% tempo change.
- If Spooty stays closed-source, **Signalsmith Stretch (MIT)** is the embed that does not force GPL. Rubber Band GPL would infect a distributed binary; a commercial Rubber Band license or calling the GPL `rubberband` CLI as a separate process is the usual workaround.
- Elastique is not embeddable without a zplane deal. DJ.Studio already paid that tax as a $99 in-app add-on; that is a product, not a library you can script against a local folder.

### Gaps

- No independent 2025–2026 MOS listening test of Rubber Band R3 vs Signalsmith vs elastique Pro vs HTML `preservesPitch` at DJ-typical ratios (0.94–1.06, i.e. ±6%). Vendor pages and forum anecdotes only.
- Whether **Homebrew ffmpeg on this Mac** is built with `--enable-librubberband` was not verified in this pass. Treat `rubberband=` as optional until `ffmpeg -filters | grep rubberband` is run locally.
- Superpowered, Bungee, and iZotope Radius were not evaluated beyond comparison tables.

---

## Mixxx Auto DJ: transitions, fade modes, skip silence, requeue

### Takeaway

Mixxx Auto DJ is a **two-deck crossfader automaton**, not a beatmatching engine. It lines up intro/outro **sections** (or a fixed seconds window / silence trim) and moves the crossfader. Official docs state it ignores volume, frequency content, **and rhythms**. It is the most complete open-source “press play and walk away” mixer, and Mixxx can **record the main output** to bounce a mix — but the mix quality is “good enough to give a human DJ a break,” not a club-grade beatmatch.

### Cited Findings

- Auto DJ “automatically loads tracks in the decks and mixes them.” “Auto DJ does not take into account the volume of each track, nor the frequency content, nor the rhythms, so it’s not intended to be a replacement for a human DJ. However, it is good enough to give a human DJ a break without a major disruption to the mix.” It **takes control of the crossfader**. Requires at least one deck assigned left and one right; centered decks are ignored. On disable, the crossfader stays where it was. — [Mixxx User Manual 2.5, §12.8 Auto DJ](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- Re-queue: “You can add a track to the end of the Auto DJ playlist once it is played instead of removing it. Set Preferences ▸ Auto DJ ▸ Re-queue tracks after playback ▸ On.” Random refill from crates or the whole library is a separate preference (“Enable random track addition to queue”). — [same manual](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- Fade modes (source + UI strings match the manual):
  - **Full Intro + Outro** (default): use intro/outro **sections**. Crossfade time = min(outro length, intro length). If outro shorter than intro, align **starts**; if outro longer, align **ends** so both full intro and full outro play.
  - **Fade At Outro Start**: always align starts; if outro longer than intro, **cut off the end of the outro** (keeps energy; can sound abrupt if intro is short).
  - **Full Track**: ignore cues; crossfade over N seconds from the spinbox. Negative N inserts silence between tracks.
  - **Skip Silence**: same as Full Track but strip leading/trailing silence defined as signal crossing **−60 dBFS**.
  - **Skip Silence Start Full Volume**: same as Skip Silence but start the incoming track at full volume with a centered crossfader (added later; see source). — [Mixxx 2.3 news](https://mixxx.org/news/2020-07-09-intro-outro-sections/); [manual Auto DJ Mix Modes](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [dlgautodj.cpp fade-mode help](https://github.com/mixxxdj/mixxx/blob/main/src/library/autodj/dlgautodj.cpp)
- Intro/outro are **sections** (two points each), not hotcues. Analyzer sets intro start = first sample above −60 dBFS, outro end = last sample below −60 dBFS. Intro **end** and outro **start** are user (or later-analyzer) marks. Auto DJ uses those lengths as the crossfade window in the two intro/outro modes. If marks are missing, it falls back to the selected crossfade time. — [Mixxx 2.3 news](https://mixxx.org/news/2020-07-09-intro-outro-sections/); [manual §12.7](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- Default transition preference is **10.0 seconds** (`kTransitionPreferenceDefault`). “Fade now” uses `fabs(transitionTime)` and does not insert silence even if the spinbox is negative. — [autodjprocessor.cpp](https://github.com/mixxxdj/mixxx/blob/main/src/library/autodj/autodjprocessor.cpp)
- Negative transition time in Full Track / Skip Silence **adds a gap** between tracks (radio/social-dance style). Transition 0 = no overlap. Users report that transition time is computed at load, so changing the spinbox after a track is already waiting does not always apply to that waiting track. — [Mixxx forum: full track with silence](https://mixxx.discourse.group/t/auto-dj-how-to-get-full-track-with-silence/30376); [forum: fade in without crossfade](https://mixxx.discourse.group/t/autodj-fade-in-next-track-without-crossfading/31213)
- Quantize (the “magnet” buttons) is a user-reported trick to make Auto DJ land more cleanly; it is **not** documented as part of Auto DJ itself. Sync Lock + Quantize **is** Mixxx’s beatmatching system for humans, separate from Auto DJ. Sync Lock will also match double-tempo pairs (e.g. 140 DnB vs 70 dubstep). Variable-BPM “Sync Lock with Dynamic Tempo” (2.4+) can follow a leader’s outro tempo into the next track; keylock is recommended because followers pitch-shift to match. — [manual §12.2–12.4](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [forum: Auto DJ transitions](https://mixxx.discourse.group/t/auto-dj-transitions/30042)
- Recording: Mixxx records the **main output** (or an external mixer input) to disk (default lossless WAV under `Mixxx/Recordings`). This is the supported “bounce the Auto DJ set” path. Drag the recording back onto a deck to play it. — [manual §12.6 Recording Your Mix](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- `--start-autodj` CLI flag (merged 2024, documented in 2.5) enables Auto DJ when Mixxx finishes loading. It still launches the **full GUI app**; it is not a headless renderer. Files passed on the command line load into successive decks. macOS binary: `/Applications/Mixxx.app/Contents/MacOS/mixxx`. — [manual §16.3](https://manual.mixxx.org/2.5/en/chapters/appendix/commandline_dev_tools.html); [PR #13017](https://github.com/mixxxdj/mixxx/pull/13017)
- Proposed “Radio Laneway” / social-dance mode (issue #13716, 2024) would add FadeIn/FadeOut cues from −27 dBV / −12 dBV thresholds; not the default as of the 2.5 manual. — [GitHub issue #13716](https://github.com/mixxxdj/mixxx/issues/13716)

### Inferences

- Mixxx Auto DJ is the closest FOSS “press play on a local folder” mixer that a human can **hear** (two real decks, headphones cue, waveforms) before committing to a recording. It will **not** time-stretch incoming tracks to the outgoing BPM unless the user (or Sync Lock) already did that. Auto DJ + Sync Lock + Quantize + Rubber Band keylock is the undocumented-but-plausible “almost beatmatched Auto DJ” combination; the manual does not claim Auto DJ engages Sync.
- For Spooty: driving Mixxx via `--start-autodj` and recording is a valid bounce path, but it is a GUI process, steals the sound device, and is a poor fit for a web preview of a single transition.
- Intro/outro **sections** are the right cue model to copy (start+end, not one marker). Silence detection at −60 dBFS is Mixxx’s operational definition of “skip silence.”

### Gaps

- Whether Auto DJ currently engages deck SYNC/keylock automatically is **not stated** in the 2.5 Auto DJ chapter. The explicit “does not take rhythms into account” sentence is the controlling claim until source-traced otherwise.
- No official headless “render this Auto DJ playlist to WAV” API. Recording is interactive.
- Exact Auto DJ processor math for every mode is in `autodjprocessor.cpp`; this pass used the manual + fragments, not a full source audit.

---

## VirtualDJ Automix, Serato DJ, Rekordbox related tracks / automatic mixing

### Takeaway

Among commercial DJ apps, **VirtualDJ Automix** is the documented “smart mix + optional beatmatch-on-fade” engine; **Rekordbox** can auto-mix a playlist you already ordered using phrase/beat/key/BPM analysis; **Serato DJ Pro has no auto-blend at all** (Autoplay only). Related-tracks features (Rekordbox Matching, VirtualDJ Linked Tracks) store human-chosen pairs — they do not generate a mix file.

### Cited Findings

- VirtualDJ Automix types (official manual):
  - **Smart**: “optimal mix point based on the outro of the current track and intro of the upcoming track — mix time varies from ~4 to ~8 secs”
  - **Fade (remove Intro/Outro)**: strip dead-air intro/outro, crossfade of Automix Length
  - **Fade (remove silence)**: keep whole track except silence, then length-based crossfade
  - **Fade (remove nothing)**: whole file, length-based crossfade
  - **Fade out, Cut in (remove silence)**: radio-style; incoming at full volume (not in dual-deck automix)
  - **None (back-to-back)**: hard cuts including air gaps
  - Default is **single-deck** Automix so the other deck stays free for live work; `automixDualDeck=Yes` uses both decks and the crossfader.
  - `autoMixBeatMatchOnFade`: “When automix mode is set to fade and songs tempo is close to each other, they will be beatmatched”
  - `automixTempoMode`: on mix, go back to 0% pitch, keep pitch, or keep BPM (within ±10% pitch)
  - `fadeLength`: seconds; **negative length adds delay between songs**
  - Automix Editor lets you define **per-pair** mix-in/mix-out POIs; Mix now / Play next / Repeat song exist. White markers on the automix waveform show mix-in/out. — [VirtualDJ Automix manual](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html); [options list](https://virtualdj.com/manuals/virtualdj/appendix/optionslist.html)
- Serato official support: “The short answer is no. There is no function in Serato DJ that will auto-blend two tracks together for you.” Autoplay “will continuously play tracks one after another, however the tracks will not crossfader or mix into each other.” Autoplay on hardware-connected Serato; offline player also auto-advances. SYNC keeps beatgrids in time for a **human**. — [Serato Support: Can Serato DJ auto-mix my songs?](https://support.serato.com/hc/en-us/articles/202304934-Can-Serato-DJ-auto-mix-my-songs)
- Rekordbox Automatic mixing (as summarized by DJ.Studio’s comparison, citing Pioneer’s feature): rekordbox dj “can automatically mix tracks from an Automix playlist using phrase, beat, key and BPM data.” It does **not** re-order the playlist by Camelot. Pioneer’s German product page (now 404 at the fetched URL; quoted in search snippets): “Lege Tracks in eine Automix-Playlist, und rekordbox dj kreiert nahtlose Mixes anhand von Phrasen, Takt, Tonart und BPM.” A 2021 how-to video describes a white mix-in bar and the crossfader moving, and explicitly: “it’s not doing it in time obviously it’s not adjusting the tempo accordingly” in that demonstration — this contradicts Pioneer’s “Takt/BPM” marketing and should be treated as **version/settings-dependent**, not as a spec. — [DJ.Studio Harmonize vs rekordbox/Serato](https://dj.studio/automix); [Pioneer page 404 on fetch](https://www.pioneerdj.com/de-de/product/features/software/rekordbox-automatic-mixing/)
- Rekordbox **Related Tracks / Matching** is a **manual** stored relationship between two tracks (exportable to USB for CDJ/XDJ), distinct from automatic “related” criteria (key/BPM). VirtualDJ 2023 **Linked Tracks** is the same idea (direct links + backward links + history). These features help a human pick the next track; they do not bounce a mix. — [DeeJay Plaza: Matching tracks in Rekordbox](https://www.deejayplaza.com/en/articles/rekordbox-track-match)
- DJ.Studio Harmonize **does** re-order by Camelot + BPM, applies transition presets and beatmatching, then offers a DAW-style timeline to **audition every transition** before export to rekordbox/Serato or a finished mix. Trial: 7 days Pro+Stems, **export disabled**. Elastique Pro is a paid stretch upgrade vs Rubber Band. — [DJ.Studio Harmonize](https://dj.studio/automix); [Elastique Pro extension](https://help.dj.studio/en/articles/12108047-elastique-pro-extension-in-dj-studio)

### Inferences

- If the goal is “hear transitions, then bounce,” DJ.Studio is the commercial product that matches the workflow (Harmonize → Studio timeline audition → export). It is not embeddable and the trial cannot export.
- VirtualDJ Smart Automix is the closest “press play” commercial analogue to Mixxx Auto DJ, with the important extra of **optional beatmatch when BPMs are close** (`autoMixBeatMatchOnFade`) and a per-pair Automix Editor.
- Serato is a dead end for auto-mix. Rekordbox automix is real but playlist-order is still yours; phrase analysis is the interesting bit (intro/verse/chorus/outro), not an engine you can script.
- Do not confuse “related tracks” with mixing.

### Gaps

- Pioneer’s current English Automix spec (exact tempo-match range, whether it time-stretches, EQ during transition) was not retrieved from a live Pioneer/AlphaTheta page (German URL 404). DJ.Studio’s comparison is marketing but internally consistent with Serato’s own “no” and with older Pioneer copy.
- VirtualDJ “Smart” mix-point algorithm is not published beyond “outro of current + intro of next, 4–8 s.”
- No confirmation of a VirtualDJ or Rekordbox **headless** CLI that writes a mixed MP3 from a folder.

---

## Open-source mixers: xwax, Mixxx engine, controller mapping, headless Mixxx

### Takeaway

Mixxx is the only full-featured open-source DJ application (GPL-2.0, C++/Qt, macOS/Windows/Linux). Its mixing engine (`EngineMixer` / `EngineDeck`) is real-time, modular, and **not packaged as a headless library**. xwax is a Linux-only digital vinyl system (timecode vinyl → decks), not a mix renderer. There is no supported “headless Mixxx”; `--start-autodj` still opens the GUI.

### Cited Findings

- Mixxx: GPL-2.0-or-later, four decks, keylock, sync lock, hotcues, quantization, MIDI/HID controllers, timecode vinyl **built on xwax**. Controller mappings use **JavaScript** (unique among DJ apps). Stable 2.5.6 as of 27 March 2026 (Wikipedia). — [Mixxx GitHub](https://github.com/mixxxdj/mixxx); [Mixxx Wikipedia](https://en.wikipedia.org/wiki/Mixxx); [Mixxx features](https://mixxx.org/features/)
- Engine: `EngineMixer` is called by `SoundManager` for the next audio buffer. Almost all DSP implements `EngineObject` so the chain is modular. Decks and samplers are both `EngineDeck`. Rate/pitch: `EngineBuffer` holds two scalers — linear for vinyl/scratch, SoundTouch or Rubber Band for keylock. — [Developer Guide Engine (wiki)](https://github.com/mixxxdj/mixxx/wiki/Developer-Guide-Engine); [Developer Guide Engine Player](https://github.com/mixxxdj/mixxx/wiki/Developer-Guide-Engine-Player)
- Magnetic Magazine (Dec 2025) interview with the Mixxx team: “the only open-source DJ software on the market”; originated 2002 as Tue Haste Andersen’s PhD. — [Magnetic Magazine](https://magneticmag.com/2025/12/a-look-into-the-only-open-source-dj-software-on-the-market-a-conversation-with-the-mixxx-team/)
- xwax: open-source Linux DVS. Needs turntables + timecode vinyls (Serato/Traktor/MixVibes). Decodes via external processes (mpg123, ffmpeg, flac, …), holds uncompressed audio in RAM, POSIX realtime, <1 ms audio. **Not for macOS.** No automix, no bounce-to-MP3. Mixxx’s timecode subsystem is built on xwax. — [xwax overview](https://xwax.org/overview.html); [xwax getting started](https://xwax.org/guide.html)
- Mixxx CLI is documented as “only useful for development or debugging” except `--start-autodj` and loading files onto decks. `--safe-mode` disables OpenGL widgets and “Doesn’t open controllers by default.” No `--no-gui`, no `--render-mix`. — [CLI manual](https://manual.mixxx.org/2.5/en/chapters/appendix/commandline_dev_tools.html)
- Digital DJ Tips (2025): Mixxx is “the leading (and only, really) open-source DJ platform.” — [How To DJ Open Source With Mixxx](https://www.digitaldjtips.com/how-to-dj-open-source-for-free-no-subscriptions-no-tie-ins/)

### Inferences

- **Do not plan to embed Mixxx’s engine** in a Node/Nest backend. It is a Qt application. Practical integration is: (a) user runs Mixxx Auto DJ + Record; (b) copy Mixxx’s **ideas** (intro/outro sections, −60 dBFS silence, fade modes) and call Rubber Band/Signalsmith yourself; (c) drive Mixxx via MIDI/JS mapping if you must automate the GUI — fragile.
- xwax is irrelevant to a local-MP3 auto-mix on macOS.
- Mixxx controller JS mappings are a way to script **live** decks, not to render a file.

### Gaps

- No public Mixxx “libmixxxengine” or Jack-only daemon. Community forks claiming headless operation were not found in this pass.
- Engine wiki pages returned empty bodies from GitHub’s HTML; details above come from search snippets of those wiki pages plus source paths.

---

## Projects that generate a DJ mix file (autodj, pydub, matchering, AI mixers)

### Takeaway

There is a graveyard of “make one MP3 mix from a folder” scripts. Most are **volume crossfades** (pydub, ffmpeg `acrossfade`) or **dead cloud APIs** (Echo Nest mix-machine). A few academic/EDM-specific systems do real beatmatch + cue selection. Matchering, Moises, lalal.ai, and AudioShake are **mastering or stem-split** tools, not mixers. The only actively documented, local-folder, beatmatch-capable OSS-ish CLIs are small projects (e.g. `manalejandro/automixer` wrapping ffmpeg rubberband) and research code (MZehren/Automix, Veire’s DnB system). Quality of hobby CLIs is not independently verified.

### Cited Findings

- **pydub**: `AudioSegment.append(other, crossfade=ms)` linearly fades the overlapping tails (`fade(to_gain=-120)` × incoming `fade(from_gain=-120)`). Default `append()` crossfade is **100 ms**; the `+` operator uses `crossfade=0` so `sum()` does not change duration. README shows a playlist loop with 10 s crossfades. `effects.speedup()` throws away chunks — not a pitch-preserving stretch. This is naive overlap, no BPM, no beats, no EQ. — [pydub README](https://github.com/jiaaro/pydub/); [audio_segment.py append()](https://github.com/jiaaro/pydub/blob/1927a31171088e8591a81adeb67f4293f66cd3c3/pydub/audio_segment.py); [SO: + vs append](https://stackoverflow.com/questions/50938152/pydub-append-clarification-of-under-the-hood-behaviour)
- **cameronbracken/mix-machine**: Python + **Echo Nest remix API**. Upload tracks, optional tempo-order, beatmatch or fade when tempos differ, emit one MP3 (historically 120 kbps). Depends on `ECHO_NEST_API_KEY` and `pip install remix`. Echo Nest was acquired by Spotify; the remix API is long dead for new use. Author disclaimer: “if two songs don’t match up well, the transition will be weird.” — [mix-machine README](https://github.com/cameronbracken/mix-machine)
- **manalejandro/automixer** (Node ≥18, MIT): CLI `automixer mix a.mp3 b.mp3 -o mix.mp3`. Detects BPM (`music-tempo` on a 30 s window skipping intro), target BPM = median, tempo-adjusts each track (ffmpeg `rubberband` if `preservePitch`, else `atempo`), equal-power crossfade default **8 s**, `maxBPMChange` default **8%**. Explicitly local-folder. Quality depends entirely on BPM detection + ffmpeg stretcher. — [automixer README](https://github.com/manalejandro/automixer)
- **Raptor007/AutoDJ**: C++/SDL, ffmpeg/libav decode, beat-matched crossfade, “works well with most EDM.” 14 GitHub stars; hobby desktop app, not a library. — [Raptor007/AutoDJ](https://github.com/Raptor007/AutoDJ)
- **MZehren/Automix** (MIT): research code for automatic DJ-mixing; companion to the cue-point papers. Uses madmom / Vogl drum transcription. — [MZehren/Automix](https://github.com/MZehren/Automix)
- **Veire & Frostteeling 2018** (EURASIP JASMP): “first fully automatic and comprehensive DJ system” for **Drum and Bass**. Beat/downbeat/structure → cue points → cross-fade profile → playlist that trades innovation vs continuity. 91% of 160+220 DnB songs got fully correct tempo/beat/downbeat/structure annotations. Genre-specific; not a general mixer. — [Springer abstract](https://link.springer.com/article/10.1186/s13636-018-0134-8)
- **sidguru2/Automated-DJ-Mixing-System**: Android + JNI. Two songs, time-stretch B locally to A’s tempo, constant-power (sin/cos) crossfade over N beats (default 16), tempo ramp A→B. Academic prototype. — [README](https://github.com/sidguru2/Automated-DJ-Mixing-System/blob/main/README.md)
- **StanAngular/autodj-mixer**: Python pipeline with All-in-One structure analysis, madmom, bar-by-bar warp, LR4 crossover, Camelot order, **`--preview-only`** then mix. Extended transitions 20–60 s. Claims professional DSP; single-maintainer, not widely cited. — [autodj-mixer README](https://github.com/StanAngular/autodj-mixer/blob/main/README.md)
- **Uday-461/ai-dj-v4**: learns per-stem fader/EQ curves from the DJ Mix Dataset (Kim et al., DAFx 2022: 5,040 mixes). Research, not a folder-in MP3-out product. — [ai-dj-v4](https://github.com/Uday-461/ai-dj-v4)
- **ElMoorish/AI-DJ-Software**: Electron + ONNX, offline, Camelot + BPM + energy tree search, **FFmpeg render** with “EQ sweeps, echo-outs, and backspins.” Marketing-heavy README; not independently evaluated. — [AI-DJ-Software](https://github.com/ElMoorish/AI-DJ-Software.git)
- **cybertheory/aidj**: GPT-4 + PyDub “smart mixing”; cloud discovery, not a local-folder engine. — [aidj](https://github.com/cybertheory/aidj)
- **matchering**: open-source **mastering**. Takes TARGET + REFERENCE, matches RMS, frequency response, peak, stereo width. Explicitly not a DJ mixer. Useful **after** a bounce to glue loudness, not to create transitions. — [sergree/matchering](https://github.com/sergree/matchering)
- **Moises**: cloud stem separator + per-track pitch/tempo + export “audio mix” (the **same song** with stems/mute/pitch applied), not a multi-track DJ mix. Processing is cloud (“about 30 seconds for a 3-minute track”). — [Moises help: export](https://help.moises.ai/hc/zh-cn/articles/360013691720); [moisesai.org](https://moisesai.org/)
- **lalal.ai / AudioShake**: stem/split APIs. No documented “folder of MP3s → continuous DJ mix” product was found in this pass.

### Inferences

- For Spooty, **pydub `append(crossfade=8000)` or ffmpeg `acrossfade`** will produce a continuous MP3 that is **not** a DJ mix. Fine as a “radio crossfade” preview of *order*, useless as an audition of *mix quality*.
- The only scriptable local beatmatch+bounce path with an actual README and ffmpeg backend is **automixer** (Node) or rolling the same idea: detect BPM → rubberband tempo → equal-power overlap. Treat 8% max BPM change as the hobby-project comfort zone (VirtualDJ uses ±10% pitch for keep-BPM).
- Academic systems that “sound like a DJ” are **genre-locked** (DnB, EDM 4/4). They will fail on a mixed Spotify library.
- Matchering/Moises/lalal.ai should be excluded from the mixer shortlist. Stem splitters can feed a *future* EQ-kill mixer; they are not mixers.

### Gaps

- Echo Nest remix / capsule.py historical behavior was not re-tested (API gone).
- No listening evaluation of automixer or autodj-mixer output.
- lalal.ai DJ / AudioShake DJ-mix products: no primary docs found that they mix a local folder into one file.

---

## Harmonic mixing (Camelot wheel, energy flow) and playlist-order libraries

### Takeaway

Camelot is a 12-hour wheel × A (minor) / B (major). Compatible moves are well-standardized and trivial to code. Several small libraries implement the rules; **none of them mix audio**. DJ.Studio Harmonize is the product that searches the permutation space of a playlist for BPM+key score. Energy-flow “arcs” in hobby AI-DJ READMEs are not backed by a citable algorithm in this pass.

### Cited Findings

- Standard compatible moves from a key `nX`: same cell (perfect), `n±1` same letter (fifth / energy up-down), same number opposite letter (relative major/minor), often also `n+2` as an energy boost. Example: 8A (Am) mixes with 7A, 9A, 8B, and often 10A. — [Jukeblocks Camelot guide](https://jukeblocks.io/camelot-wheel/); [TuneTapper chart](https://tunetapper.com/tools/camelot)
- **regorxxx/Camelot-Wheel-Notation** (JS): translations among Camelot, standard, Open Key; named moves (`perfectMatch`, `energyBoost`, `energyDrop`, `energySwitch`, `moodBoost` ±3, `energyRaise` +7, `domKey`/`subDomKey`); `createHarmonicMixingPattern(playlistLength)` to sample a movement distribution. — [README](https://github.com/regorxxx/Camelot-Wheel-Notation/blob/main/README.md)
- **DJStompZone/PyCamelot**: `get_camelot_key('C') → '8B'`; `get_compatible_keys('8B') → ['8B','9B','7B','8A']`. MIT. — [PyCamelot](https://github.com/DJStompZone/PyCamelot)
- **0xf4b1/traktor-harmony**: reorders a Traktor NML playlist by Camelot + BPM difference score; can generate an M3U of given length from a collection. Requires Traktor-analyzed key+BPM. — [traktor-harmony](https://github.com/0xf4b1/traktor-harmony)
- **ValeriKozarev/harmonic**: CLI over Spotify/ReccoBeats + circular Camelot distance. Cloud metadata, not local files. — [harmonic](https://github.com/ValeriKozarev/harmonic)
- DJ.Studio Harmonize: scores “millions of possible playlist combinations” on **BPM and key only** (explicitly not subjective energy). Mood mixing = classic Camelot progressions; Fuzzy = looser related numbers. BPM/Key slider. Locked first/last tracks. Solver inserts a bridge track when a pair is marked X. — [dj.studio/automix](https://dj.studio/automix)
- Mixxx displays detected key and offers keylock; harmonic mixing help points at Mixshare archive. It does **not** auto-order Auto DJ by Camelot. — [Mixxx manual §12.5](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)

### Inferences

- Sequencing is a **separate, cheap step** from mixing. Given per-track key + BPM (from tags, Mixxx analysis, or Essentia), a TSP/greedy walk on Camelot×BPM distance is a weekend of JS. Spooty already has track metadata; this can run before any audio engine.
- Do not expect Camelot order to fix mixed-genre playlists. A 8A ballad into 8A gabber is “perfectly harmonic” and still a bad mix.
- Energy-flow as a first-class optimizer is product marketing (DJ.Studio says they **don’t** use energy for Harmonize). Treat “energy arcs” in GitHub READMEs as unimplemented claims unless the code is audited.

### Gaps

- No widely used Python package that takes a list of `{path, key, bpm}` and returns an optimal order with a published algorithm and tests beyond the small repos above.
- Mixed In Key’s exact Camelot “energy +2 / +7” rules vs community tables differ slightly on whether +2 is “compatible” or “use with care”; sources disagree on listing 3A as a mix for 1A.

---

## Cue points / intro-outro detection for mix in/out

### Takeaway

Silence-based intro start / outro end (Mixxx −60 dBFS) is robust and cheap. Musical mix-in/out (phrase, drop, “switch point”) is an unsolved-but-researched EDM problem: Zehren et al. report ~90–96% of generated switch points usable **in EDM**. Rekordbox CUE Analysis, Mixed In Key, and KimiCue are the commercial auto-cuers. Copy Mixxx’s four-point intro/outro model; do not pretend bar-32 heuristics work on radio edits or live albums.

### Cited Findings

- Mixxx analyzer: intro start = first > −60 dBFS; outro end = last < −60 dBFS; intro end / outro start left for the user (or later tools). Auto DJ then uses section **durations**. — [Mixxx 2.3 news](https://mixxx.org/news/2020-07-09-intro-outro-sections/)
- Zehren, Alunno, Bientinesi 2020 (arXiv:2007.08411): EDM “switch points” (where B becomes prevalent). Rules from DJ interviews: (1) high novelty in rhythm/loudness/timbre/harmony; (2) on a downbeat at the start of a period (4-bar grid); (3) following section must be salient. Features: Vogl drums (kick/snare/hat), librosa HPSS, CQT, PCP; madmom strong-beat grid; Foote-style SSM novelty. ~**96%** of generated points rated good for a DJ mix. Code: github.com/MZehren/Automix; dataset M-DJCUE. Follow-up CMJ 2022: two approaches, ~**90%** usable on unseen tracks. Inter-mixability (does A mix *with* B) left as future work. — [arXiv:2007.08411](https://arxiv.org/abs/2007.08411); [CMJ 46(3)](https://direct.mit.edu/comj/article/46/3/67/117159/Automatic-Detection-of-Cue-Points-for-the)
- Argüello et al. 2024 (arXiv:2407.06823): cue-point estimation as object detection on a transformer, 21k expert cues / ~5k tracks (35× prior dataset), “high adherence to phrasing.” Code/checkpoints public. — [arXiv:2407.06823](https://arxiv.org/abs/2407.06823)
- Veire DnB system: phrase-aligned structural boundaries from novelty peaks snapped to downbeats; sections labelled high/low energy; cue types include **double drop** (16 bars before a low→high). — [Springer 2018 abstract](https://link.springer.com/article/10.1186/s13636-018-0134-8)
- Commercial auto-cues (2026 roundup): Rekordbox 7 CUE Analysis (phrase: intro/verse/chorus/outro, optional train-on-your-cues); Mixed In Key; KimiCue ($29, drop-centric 8 pads); Lexicon; CueGen / Bide AutoCuer scripts. Bar-counting scripts “land wherever bar 32 happens to be, not where your track’s drop actually is.” — [KimiCue comparison](https://kimicue.com/blog/automatic-hot-cue-placement)
- autodj-mixer maps **segment pairs** to crossfade length and EQ: outro/inst → intro/inst = 16 bars + smooth EQ + −3.5 dB notch; verse/chorus → verse/chorus = 4 bars, stepped, −2 dB. This is a reasonable **heuristic table**, not a validated DJ model. — [autodj-mixer README](https://github.com/StanAngular/autodj-mixer/blob/main/README.md)
- zplane **BARBEATQ** is a commercial cue-point detection SDK (no public algorithm). — [zplane home](https://licensing.zplane.de/)

### Inferences

- For a local library of mixed Spotify rips: implement Mixxx-style **silence intro/outro** immediately (ffmpeg `silencedetect` / `silenceremove`, or a −60 dBFS scan). That already makes Skip Silence / radio crossfades not terrible.
- Phrase/drop detection is worth it **only** for electronic 4/4. On singer-songwriter, live, and radio-edit pop, “bar 32” and novelty-SSM cues will land in vocals.
- Preview UI should expose mix-in/mix-out as **draggable** points (VirtualDJ POI editor, Mixxx overview waveform). Auto cues are a starting guess.

### Gaps

- No off-the-shelf npm/Python function that, given an MP3, returns Mixxx-compatible introStart/introEnd/outroStart/outroEnd with published accuracy on mixed-genre collections.
- Zehren results are EDM-specific; transferring to a Spooty library is untested.

---

## Preview architecture: two-deck Web Audio vs server-side ffmpeg vs HTML audio

### Takeaway

**Hear the transition before bouncing.** The right preview is two independent players, a scheduled overlap, and equal-power gains — not a 40-minute ffmpeg job. Use HTMLMediaElement (`playbackRate` + `preservesPitch`) or Web Audio BufferSources + GainNodes. Schedule with `AudioContext.currentTime` / `linearRampToValueAtTime`, never `setTimeout`. Bounce later with ffmpeg/Rubber Band using the **same** mix-in/out times the user just approved.

### Cited Findings

- HTML5 Rocks / Web Audio intro (Google): DJ crossfade graph = two sources → two GainNodes → destination. `setTimeout` is not precise; use `AudioParam` ramps. Playlist helper: fade out current and fade in next `FADE_TIME` before `duration`. `linearRampToValueAtTime` / `exponentialRampToValueAtTime` / `setValueCurveAtTime`. — [HTML5 Rocks Web Audio intro](https://wwwhtml5rockscom.readthedocs.io/en/latest/content/tutorials/webaudio/intro/en/)
- webaudioapi.com sample: “Equal-power crossfading to mix between two tracks.” — [Crossfade sample](https://webaudioapi.com/samples/crossfade/)
- `notthetup/crossfade`: Web Audio crossfader, `fade` AudioParam in [−1, 1], **equal power curve**. — [crossfade README](https://github.com/notthetup/crossfade)
- **danbovey/wam** (webaudiomixer): automatic mixing in the browser. Beat detection (Joe Sullivan / Web Audio), WAAClock scheduling (Chris Wilson “A Tale of Two Clocks”), `playbackRate` + `detune` to tempo-match, `maxBpmDiff` default 8, `mixLength` default 20 s. Notes that BufferSource rate-change is not a real stretcher and planned a PhaseVocoderJS polyfill. — [wam README](https://github.com/danbovey/wam)
- MDN advanced sequencing: lookahead scheduler (`scheduleAheadTime` + `setTimeout` loop) that queues `start(time)` on the audio clock — the standard pattern so events do not slip. `AudioContext.currentTime` is the source of truth. — [MDN Advanced techniques](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)
- HTMLMediaElement `preservesPitch` (default true) vs AudioBufferSourceNode `playbackRate` (resampling, pitch-linked) is the architectural fork: **media element = cheap preview stretch**; **buffer source = vinyl/scratch or you bring your own WASM stretcher**. Signalsmith ships WASM AudioWorklet for the latter. — [MDN preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch); [Signalsmith web/](https://github.com/Signalsmith-Audio/signalsmith-stretch)
- ffmpeg `acrossfade` always overlaps the **end of stream 1 with the start of stream 2**; there is **no offset**. To mix out at 3:10 rather than “last 8 seconds of the file,” you must `atrim` first. `acrossfade=n=3` concatenates many files with the same fade. Curves from `afade` (tri, qsin, hsin, exp, …). Overlap can be disabled (`o=0`) for fade-out then fade-in with a gap. — [FFmpeg acrossfade](https://ffmpeg.org/ffmpeg-filters.html#acrossfade); [ayosec acrossfade 8.0](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Audio/acrossfade.html)
- Mixing N clips in one `filter_complex` is N−1 chained acrossfades; people “give up” here. Fine for a bounce of an already-auditioned pair; painful as an interactive preview. — [FFmpeg Micro: xfade/acrossfade](https://www.ffmpeg-micro.com/blog/crossfade-between-clips-with-ffmpeg-xfade-no-editor)

### Inferences

- **Preview (Spooty UI):** two `<audio>` elements (or two BufferSources if you decode ahead) into Web Audio gains, equal-power crossfade, optional `playbackRate` on the incoming deck to hear a BPM match. Seek both to mix-out / mix-in, play 15–30 s covering the join, let the user nudge cues. Do **not** decode a whole playlist into AudioBuffers (memory).
- **Bounce:** take the approved `(fileA, outPoint, fileB, inPoint, fadeSec, tempoRatio)` and run ffmpeg (atrim + rubberband/atempo + acrossfade or amix of two afades). One transition at a time, stitch. A single giant filter_complex for 80 tracks is the wrong architecture.
- Mixxx recording is a third preview/bounce: hear it live in Mixxx, record main. Heavyweight, best quality among FOSS, not embeddable in Angular.

### Gaps

- Browser decode of local MP3s via `file://` vs a Spooty `/api/library` media route (range requests, CORS) was not designed here; playback of existing library URLs is assumed.
- Whether Safari’s `preservesPitch` quality is acceptable at ±8% BPM was not tested.

---

## ffmpeg as renderer: acrossfade, afade, rubberband, atempo, loudnorm — good enough vs DJ-quality

### Takeaway

ffmpeg can bounce a **radio-style** continuous MP3 (trim silence, equal-power-ish crossfade, loudness match) today. It can **approximate** beatmatching if you pre-compute tempo ratios and call `rubberband` (optional build) or `atempo` (always there, worse). It cannot do phrase-aligned EQ kills, filter sweeps, or downbeat locking by itself. That is the quality gap.

### Cited Findings

- `acrossfade`: overlap end of A with start of B for duration `d`; `curve1`/`curve2` from `afade` (default `tri` = linear). Linear-vs-linear **dips** in the middle; docs/cookbooks recommend `qsin` on both for music beds. `n` inputs chain like concat. — [FFmpeg acrossfade](https://ffmpeg.org/ffmpeg-filters.html#acrossfade); [FFmpegLab amix/acrossfade](https://ffmpeglab.com/articles/ffmpeg-audio-mixing-amix-guide.html)
- `afade`: in/out, `duration`/`nb_samples`, many curves including `hsin` (equal-power-ish half-sine), `qsin`, `exp`. Building a DJ fade “by hand” = `atrim` each side, `afade`, `amix`. — [FFmpeg afade](https://ffmpeg.org/ffmpeg-filters.html#afade)
- `atempo`: [0.5, 100]; >2× skips samples; daisy-chain recommended. Pitch is preserved in the WSOLA sense, quality not DJ-keylock. — [FFmpeg atempo](https://ffmpeg.org/ffmpeg-filters.html#atempo)
- `rubberband` filter: `tempo`, `pitch` scale factors; needs `--enable-librubberband`. Commands can change tempo/pitch at runtime. — [FFmpeg rubberband](https://ffmpeg.org/ffmpeg-filters.html#rubberband)
- `loudnorm`: EBU R128, default I=−24 LUFS, TP=−2 dBTP, LRA=7. Two-pass linear mode needs measured_* from pass 1. Useful to glue a bounced mix; flattening LRA across a DJ set can **kill** intended energy contrast. — [FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
- `silencedetect` / `silenceremove`: operational equivalent of Mixxx Skip Silence if threshold is set near −60 dB.
- `acrossover`: splits into frequency bands (2nd–10th order). This is the primitive for a **bass kill** during a transition if you implement it; ffmpeg will not decide *when* to sweep.
- Example cookbook pair fade: `acrossfade=d=4:c1=tri:c2=tri`. — [FFmpegLab](https://ffmpeglab.com/articles/ffmpeg-audio-mixing-amix-guide.html)

### Inferences

- **Good enough (radio/podcast playlist):** `silenceremove` → `acrossfade=d=6:c1=hsin:c2=hsin` → optional `loudnorm=I=-14`. Honest label: “crossfade mix,” not “DJ mix.”
- **DJ-adjacent bounce:** for each pair, if `|bpmA−bpmB|/bpmA < ~0.08`, stretch B with rubberband `tempo=bpmA/bpmB`, `atrim` to phrase cues, `amix` with `hsin` fades, optional `acrossover` to duck B’s bass for the first half of the fade. Still no downbeat grid unless you pass exact sample offsets from an analyzer.
- **Not good enough:** mixed BPM >8–10%, variable-BPM live tracks, vocal-on-vocal, key clashes, “drop on drop.” Those need a real two-deck engine (Mixxx/VirtualDJ) or a human.
- Equal-power (`hsin`/`qsin`) vs linear (`tri`) is audible in the dip; use equal-power for music. Mixxx/VirtualDJ crossfaders are equal-power by default in DJ practice; ffmpeg `tri` is not.

### Gaps

- Homebrew ffmpeg rubberband availability on this machine not verified.
- No canonical ffmpeg graph in the wild that does EQ-kill + beat-align + loudnorm for N tracks; hobby repos invent their own.

---

## Known failure modes: mixed genres, live/variable BPM, radio vs extended, and the quality gap

### Takeaway

Auto-mix that sounds “DJ” is a **4/4 electronic, constant-BPM, intro/outro-structured** problem. A Spooty library is the opposite: radio edits, live cuts, 70–180 BPM, vocals, key clashes. Simple crossfade always “works” and often sounds like a bad radio station. Beatmatched auto-mix **fails loudly** when the assumptions break. Preview-first is how you catch that before spending render time.

### Cited Findings

- Mixxx: Auto DJ ignores volume, spectrum, **and rhythms**; variable-BPM Sync Lock can follow a wrong outro tempo; “a leader plays always the original recorded tempo changes. A follower changes its tempo matching the leader which may result in a notable pitch change. Engaging keylock helps mitigate this pitch issue.” — [Mixxx manual §12.4, §12.8](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- Mixxx Sync Lock **does** handle double-time (140 vs 70). Hobby automixers that pick a global median BPM will instead stretch a 70 BPM track toward 128 and destroy it. automixer default `maxBPMChange=8%` is a safety rail; VirtualDJ keep-BPM allows ±10% pitch. — [Mixxx Sync Lock](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [automixer](https://github.com/manalejandro/automixer); [VirtualDJ automixTempoMode](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html)
- Veire 2018 and Zehren 2020 both **restrict to one EDM idiom** (DnB / EDM 4/4 modular phrases). Veire: 91% annotation accuracy **on DnB**. Zehren: rules assume 4/4 and 4-bar periodicity; “exceptions exist… should not affect general characterizations” **of EDM**. — [Springer 2018](https://link.springer.com/article/10.1186/s13636-018-0134-8); [arXiv:2007.08411](https://arxiv.org/abs/2007.08411)
- mix-machine disclaimer: “if two songs don’t match up well, the transition will be weird, no matter what.” — [mix-machine README](https://github.com/cameronbracken/mix-machine)
- Mixxx Fade At Outro Start “may sound abrupt if the intro is short”; Full Intro + Outro is default because it “is the most likely to sound good with the widest variety of tracks.” Radio-style (fade out, cut in / negative gap) exists because social dance and pop **need** the cold ending. — [Mixxx Auto DJ modes](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [VirtualDJ Fade out, Cut in](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html)
- Wikipedia DJ section: DJs time-stretch to beatmatch **and** pitch-shift for harmonic mixing. Those are two different operations; doing only one still fails. — [Wikipedia time stretching](https://en.wikipedia.org/wiki/Audio_time_stretching_and_pitch_scaling)
- pydub/ffmpeg crossfades overlap **whatever is at the end of the file** with **whatever is at the start**. Radio edits often start on vocals and end on vocals → double-vocal mush. Extended/club mixes start/end on drums → accidental “DJ mix.” Same algorithm, opposite results. — [pydub append](https://github.com/jiaaro/pydub/blob/1927a31171088e8591a81adeb67f4293f66cd3c3/pydub/audio_segment.py); [ffmpeg acrossfade](https://ffmpeg.org/ffmpeg-filters.html#acrossfade)
- HTML `playbackRate` outside ~0.5–4 mutes audio in most browsers; DJ pitch ranges are smaller, but a 80→160 “double” preview via rate=2 is the edge. BufferSource negative rate (spinback) is WebKit-only. — [MDN playbackRate](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/WebAudio_playbackRate_explained); [Andy Gallagher negative playbackRate](https://www.andy-gallagher.com/blog/web-audio-madness-negative-playback-rate/)
- Serato: no auto-blend. Users who expect “Automix” from Serato get sequential playback. — [Serato Support](https://support.serato.com/hc/en-us/articles/202304934-Can-Serato-DJ-auto-mix-my-songs)

### Inferences

Failure modes to surface in a UI (not hide):

| Failure | What happens | Mitigation |
|---|---|---|
| Mixed genre / energy crash | Camelot-perfect, musically stupid | Human order; don’t auto-sequence a whole library |
| Live / rubato / variable BPM | Beat grid drifts; stretch warbles | Skip Silence / radio fade; disable beatmatch |
| Radio edit → radio edit | Vocal overlap | Mixxx-style intro/outro **ends** or fade-out/cut-in |
| Extended mix → radio edit | Works by accident if drums meet drums | Still preview |
| BPM double/half | 87 vs 174 | Detect doubling like Mixxx Sync; don’t median-stretch |
| Key clash | Beats match, chords fight | Camelot filter or keylock ±semitone (audible) |
| Stretch > ~8–10% | Rubber Band artifacts, “chipmunk” if using rate | Refuse beatmatch; crossfade only |
| Silence-trim too aggressive | Eats quiet intros/outros (ambient, classical) | −60 dBFS is wrong for those genres |
| Global loudnorm | Flat, lifeless set | Per-track gain match, not R128 smash |
| ffmpeg acrossfade on full files | Ignores cue points | Always `atrim` to auditioned in/out |

Quality ladder (honest):

1. **Concat / `+` operator** — gaps and clicks.
2. **Volume crossfade** (pydub, ffmpeg `acrossfade`, Mixxx Full Track) — continuous, not in time, not in key.
3. **Skip silence + intro/outro align** (Mixxx Auto DJ default, VirtualDJ Smart without beatmatch) — the best *generic-library* automix. Still not beatmatched.
4. **Beatmatch when BPM within ~8% + equal-power overlap** (VirtualDJ `autoMixBeatMatchOnFade`, automixer, Web Audio playbackRate preview) — “DJ-ish” on electronic tracks.
5. **Phrase-aligned, EQ-killed, downbeat-locked, harmonic-ordered** (human Mixxx/VDJ, DJ.Studio timeline, Veire-class research) — actual DJ mix. Not a one-click ffmpeg filter.

For Spooty’s local MP3s, ship (2) or (3) as bounce, and (4) as an **optional preview** the user must hear. Do not advertise (5) unless a real two-deck engine (Mixxx) or DJ.Studio is in the loop.

### Gaps

- No published accuracy numbers for Mixxx Auto DJ “sounds good” rate on mixed-genre collections (the manual’s “good enough for a break” is the official quality claim).
- Radio-edit vs extended-mix detection (duration vs structure) was not found as a ready library.
- Live-track / DJ-mix-as-source (already mixed bootlegs in a playlist) will defeat both silence detection and phrase analysis; not studied here.
