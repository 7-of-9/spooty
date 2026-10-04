# Local playlist auto-mix tools (Rekordbox analysis reuse, Auto DJ, harmonic mix, bounce)

Scope: consumer and pro DJ apps that can take a **local folder of MP3s on macOS**, analyze BPM/beats/key, and either auto-DJ, assist harmonic mixing, or export mixable metadata. User already uses Pioneer/AlphaTheta **rekordbox** and likes its analysis. Library size is ~60–70 personal MP3s. Streaming-only DJ features (Spotify DJ, SoundCloud DJ, etc.) are noted only where they **do not** apply because this workflow needs local files.

Research date: 26 September 2026. Prefer official manuals, format specs, and vendor support pages over marketing copy. Third-party accuracy tests and reverse-engineered format docs are labeled as such.

---

## What does Rekordbox actually analyze (BPM, beatgrid, key, phrase, waveforms)? Can analysis be exported (XML, ANLZ, rekordbox.xml) and reused by other tools?

### Takeaway
Rekordbox analysis is a multi-layer product: the app writes BPM, beatgrid, key, phrase, vocal position, and several generations of waveforms into a proprietary collection plus per-track **ANLZ** files (`.DAT` / `.EXT` / `.2EX`). A documented **XML snapshot** (`rekordbox.xml`) can carry BPM, key (tonality), beatgrid `TEMPO` points, and cue/loop `POSITION_MARK`s for other software, but it does **not** contain waveforms or phrase analysis. Phrase, color/3-band waveforms, and hot-cue colors live in the binary ANLZ/USB export, which Mixxx and several converters can read after USB export, not from XML.

### Cited Findings
- Official rekordbox 7.2.16 English manual: analysis produces waveform, beats, tempo (BPM), key, phrase, and (in current settings) vocal data. Track Analysis Setting checkboxes are **BPM / Grid**, **KEY**, **Phrase**, and **Vocal**. Analysis modes are **Normal**, **Dynamic**, and **Auto** (Auto only when “Use high precision BeatGrid analysis” is on). Auto Analysis can start when a file is added to Collection. Cues can be set automatically at the first beat (1.1 Bars). High-precision BeatGrid is slower but more accurate. — [rekordbox 7.2.16 manual PDF](https://cdn.rekordbox.com/files/20260706162433/rekordbox7.2.16_manual_EN.pdf)
- Older official 5.5.0 manual already listed the same core outputs: “waveform, beats, tempo (BPM), key, phrase, and other useful information.” Analysis modes were Normal vs Dynamic; Track Analysis Setting was BPM/Grid, KEY, and/or Phrase. — [rekordbox 5.5.0 manual PDF](https://cdn.rekordbox.com/files/20200214194946/rekordbox5.5.0_manual_EN.pdf)
- Pioneer/AlphaTheta publishes an official XML format for playlist sharing. Required first line is `<?xml version="1.0" encoding="UTF-8" ?>`. Import path on the developer page is rekordbox **File → Preferences → Bridge → Imported Library**. Supported elements include `TRACK` attributes `AverageBpm`, `Tonality` (musical key), `Location` (file URI, `file://localhost/...`), nested `TEMPO` (beatgrid: start time `Inizio` in seconds, `Bpm`, meter `Metro`, beat-in-bar `Battito`), and `POSITION_MARK` (cue/fade/load/loop). More than two `TEMPO` and `POSITION_MARK` nodes can exist per track. XML version is **1.0.0**. Audio is **not** embedded. — [rekordbox for Developers](https://rekordbox.com/en/support/developer/); [official XML format list PDF](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf); [pyrekordbox XML format docs](https://pyrekordbox.readthedocs.io/en/latest/formats/xml.html)
- Third-party converters and Mixgraph describe a **File → Export Collection in XML format** snapshot that lists every track’s path, tags, tempo, key, cues, and playlists. It is a point-in-time export, not a live link; tracks added after export are absent. — [Mixgraph: What is a Rekordbox XML export?](https://www.mixgraph.io/glossary/xml-export); [MIXO: Rekordbox XML to Mixxx](https://www.mixo.dj/guides/rekordbox-xml-to-mixxx)
- Binary analysis files are named like `ANLZ0000` with extensions **`.DAT`**, **`.EXT`**, **`.2EX`**. pyrekordbox (citing Deep Symmetry crate-digger): they hold waveforms, beat grids (time of each beat), VBR seek indices, memory cues and loop points, and are also written onto USB for Pioneer players. — [pyrekordbox Analysis Files](https://pyrekordbox.readthedocs.io/en/latest/tutorial/anlz.html)
- Deep Symmetry / crate-digger reverse-engineering (primary technical source for ANLZ internals):
  - File magic `PMAI`; tagged sections.
  - **`PQTZ` beat grid**: each beat has bar position 1–4, tempo as BPM×100 (0.01 BPM precision), time in milliseconds.
  - **`PCOB` / `PCO2`**: memory cues and hot cues (extended tag adds colors, comments, more hot cues).
  - Waveforms: `PWAV` monochrome preview (400 bytes) in `.DAT`; `PWV3` scroll detail and `PWV4`/`PWV5` color waveforms in `.EXT`; `PWV6`/`PWV7` 3-band waveforms in `.2EX` (CDJ-3000 generation).
  - **`PSSI` song structure (phrase)** in `.EXT`: intro/verse/chorus/bridge/outro (mood-dependent labels: high/mid/low), lighting bank, fill-in beats. rekordbox 6+ USB-exported phrase data is **XOR-obfuscated**. Originally Performance Mode only; from rekordbox 6 also exported for CDJ-3000 lighting. — [DJ Link Ecosystem Analysis — Analysis Files](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html) (page last noted 2026-08-03); [crate-digger kaitai spec](https://github.com/Deep-Symmetry/crate-digger/blob/master/src/main/kaitai/rekordbox_anlz.ksy)
- USB export layout (third-party documentation of Pioneer device library): `/PIONEER/rekordbox/export.pdb` holds track list with tempo, key, artwork, playlists; `/PIONEER/USBANLZ/` holds per-track ANLZ (beatgrid, waveform, cues; phrase on newer exports). Players browse the database, not the raw folder of MP3s. Streaming tracks cannot be USB-exported. — [Mixgraph USB checker](https://www.mixgraph.io/tools/rekordbox-usb-checker); [Save My Gig: streaming tracks do not export to USB](https://www.savemygig.com/fix/streaming-tracks-usb-export)
- Mixxx 2.5 can **read Rekordbox USB/SD device libraries** (export mode, FAT or HFS): folders, playlists, beatgrids, hot cues, memory cues, loops, and cue colors. It does **not** support databases moved via rekordbox Preferences → Advanced → Database management. Mixxx maps Rekordbox hotcues 1:1, first chronological memory cue → Mixxx main cue, first loop → Mixxx loop, remaining loops/memory cues → extra hotcues. — [Mixxx 2.5 library manual — Using the Rekordbox library](https://manual.mixxx.org/latest/en/chapters/library.html)
- Mixxx source tree includes generated `rekordbox_anlz.h` from the same Kaitai spec (waveforms, beat grids, VBR indices, cues). — [Debian Mixxx 2.5.0 `rekordbox_anlz.h`](https://sources.debian.org/src/mixxx/2.5.0%2Bdfsg-3/lib/rekordbox-metadata/rekordbox_anlz.h)
- Engine DJ Desktop officially imports rekordbox, Apple Music/iTunes, Serato, and Traktor libraries (music, playlists, hot cues, loops) for Engine OS hardware. — [Engine DJ Desktop](https://enginedj.com/software/enginedj-desktop)
- Mixed In Key 11 writes key/BPM/energy/cue points into ID3 tags and can push cue points into rekordbox via the XML workflow (analyze BPM/grid in rekordbox first, export XML, point Mixed In Key at that XML, then reload in rekordbox). — [Mixed In Key 11 product page](https://mixedinkey.com/learn-more/); [MIK 11 + rekordbox 7 tutorial](https://www.youtube.com/watch?v=SBpS_DLvri0)
- XML does **not** list phrase, waveform bytes, or vocal-position analysis. Those are ANLZ/USB-only in the format docs above.

### Inferences
- For a 60–70 track personal MP3 folder, rekordbox Collection analysis is the richest single local analysis the user already has. To **reuse** it:
  - **Portable metadata** (BPM, key, beatgrid points, cues): XML collection export / Bridge import. Good enough for harmonic sorting and cue sharing with Mixed In Key, MIXO, DJ.Studio, Lexicon, etc.
  - **Full Pioneer player data** (waveforms, phrase, 3-band): USB/device export (`export.pdb` + ANLZ). Mixxx can consume this path; most other apps cannot natively parse ANLZ.
- Phrase analysis is useful for lighting and structure visualization, not as a documented interchange format. The XOR mask on exported PSSI is an explicit barrier to casual reuse.
- Do not expect another DJ app to “just open” rekordbox’s SQLite/EDB collection. Interop is XML snapshot, USB export, or a converter (MIXO, Lexicon, Engine import, Mixxx USB reader).

### Gaps
- Pioneer does not publish the ANLZ binary spec; all ANLZ field names above are reverse-engineered (crate-digger / pyrekordbox). Treat as high-confidence reverse engineering, not an official contract.
- Exact current menu path for **exporting** XML in rekordbox 7.2.x was confirmed by MIXO/YouTube as **File → Export Collection in XML format**, while the official developer page documents **import** via Preferences → Bridge. The 7.2.16 English manual text extract did not hit the string “Export Collection in XML”; the Pioneer XML PDF and developer page are the official format source.
- Whether rekordbox 7 writes key into MP3 ID3 `TKEY`/`initialkey` by default (vs only the collection DB) was not confirmed from the 7.2.16 manual extract.

---

## Does Rekordbox have Auto DJ, Related Tracks, or mix export? Current Rekordbox version as of 2026.

### Takeaway
Current shipping desktop version as of 24 September 2026 is **rekordbox 7.2.19**. Performance mode has a real **Automix** window that loads a playlist onto decks 1/2 and auto-plays it (repeat/random/load-method settings). It also has **RELATED TRACKS** (BPM, key, matching, genre, ratings, My Tag) and **MIX POINT LINK** (auto-start the next deck at chosen mix in/out cues). Mix *recording* exists as a recording panel; bouncing a finished mixed MP3 is “record the live/automix output,” not a timeline render. Paid plans advertise “Record and share DJ mixes” and “Export edited tracks.” USB export is analysis+playlist for CDJs, not a mixed audio file.

### Cited Findings
- **Current version:** rekordbox.com Information: **ver. 7.2.19 released 24 September 2026** — SoundSwitch lighting support, bug fixes. 7.2.18 (18 Aug 2026) added Spotify login on compatible CDJ/XDJ and Spotify tracks in EXPORT mode, with the note that Spotify tracks **cannot** be copied to USB/SD. 7.2.16 (9 July 2026) added CDJ-1500X/XDJ-AN, CoBeat, Request Catalog, Phase HID, and further Spotify Automix/Collection functions (per secondary reporting). Official macOS **Tahoe 26** compatibility notice exists. — [rekordbox Information](https://rekordbox.com/en/support/information/); [FADER / 7.2.19](https://www.thefader.com/2026/09/24/rekordbox-pro-dj-link-bridge-lighting-software)
- **Automix (PERFORMANCE mode):** 7.2.16 manual TOC: “Automix window (PERFORMANCE mode) (page 171).” Procedure: click to open Automix window → drag a playlist from the tree → tracks appear in Automix → settings for Repeat, Random, and deck-load method → click to start. “The track of the Automix playlist is loaded onto the deck 1 or deck 2 automatically, and Automix starts.” Stop: click again; current track plays to the end; unloading the loaded track also stops Automix. Ableton Link cannot be enabled during Automix. — [rekordbox 7.2.16 manual PDF](https://cdn.rekordbox.com/files/20260706162433/rekordbox7.2.16_manual_EN.pdf); same Automix flow in [rekordbox 6.7.0 manual](https://cdn.rekordbox.com/files/20230316171900/rekordbox6.7.0_manual_EN.pdf)
- Secondary: rekordbox 7.2.16 added Spotify support to Automix plus Your Library / Made to DJ; 7.2.18 made Spotify tracks available in EXPORT mode but still not USB-exportable. — [DJGear2K: Can You DJ With Spotify 2026](https://djgear2k.com/can-you-dj-with-spotify/)
- **RELATED TRACKS:** 7.2.16 manual (page 32): list of tracks related to the loaded track. Relation can be set with **BPM, Key, Matching, Tracks in the same genre, Ratings, My Tag**, etc. Search target is a folder or playlist. Rank orders by conditions. In 2-player layouts you can register two loaded tracks as related ([Matching]). Custom condition lists can be created, edited, deleted, and grouped in folders. A RELATED TRACKS subpanel can sit beside the track list. — [rekordbox 7.2.16 manual PDF](https://cdn.rekordbox.com/files/20260706162433/rekordbox7.2.16_manual_EN.pdf)
- **MIX POINT LINK:** Official FAQ: set MIX IN and MIX OUT from hot cues/memory cues, then MIX POINT LINK auto-starts the MIX IN deck when the MIX OUT deck reaches the linked point. Enable in Preferences → Controller → MIX POINT LINK. SYNC recommended. Subscription plan required (“it is necessary to subscribe to a supported Plan”). — [rekordbox MIX POINT LINK FAQ](https://rekordbox.com/en/support/faq/mixpoint-link-6/); 7.2.16 manual PERFORMANCE mode MIX POINT LINK chapter
- **Plans (USD, rekordbox.com):** Free $0; Core $12/mo or $120/year; Creative $18/mo or $180/year; Professional $36/mo or $360/year (yearly discounts listed). Feature bullets include “Efficient track compatibility checking,” “AI detection of vocal position,” “Automatic configuration of personalized Cue points,” “Mix point link and playback reservation,” “New mixes that use STEMS,” “Export edited tracks,” “Record and share DJ mixes.” Device install limits: Core 3 computers, Creative 4, Professional 8. Hardware Unlock can unlock PERFORMANCE features on Free with eligible gear. Cloud Option is extra. — [rekordbox Plans](https://rekordbox.com/en/plan/)
- **Recording panel** is documented in EXPORT mode (7.2.16 manual around page 80) with the caveat that “Depending on your subscription plan and DJ equipment connected to your computer, some functions may not be available.”
- **Playlist file export** (not mixed audio): right-click playlist → Export a playlist to a file `*.txt` or `*.m3u8`. Import M3U/M3U8/PLS. — [rekordbox 7.2.16 manual](https://cdn.rekordbox.com/files/20260706162433/rekordbox7.2.16_manual_EN.pdf)
- **USB export** writes Pioneer device library (pdb + ANLZ + copies of audio files you own). Streaming tracks cannot go on the stick. — [Save My Gig](https://www.savemygig.com/fix/streaming-tracks-usb-export)
- DJ.Studio can export a *prepared* mix back into rekordbox as a playlist with hot cues at transition start/mid/end (and optional track edits). That is the reverse direction: mix planned elsewhere, then play live in rekordbox. — [DJ.Studio: Export Mix To Rekordbox](https://help.dj.studio/en/articles/8842722-export-mix-to-rekordbox)

### Inferences
- Rekordbox Automix is a **live auto-DJ of an existing playlist on two decks**, not a “drop a folder, bounce a mixed MP3” renderer. To get a mixed file you record the master while Automix (or you) plays.
- RELATED TRACKS is the harmonic/BPM assistant for picking the next song; it does not sequence a whole folder by itself.
- MIX POINT LINK is closer to “programmed live transitions” than hands-off Auto DJ; it is plan-gated.
- For this user’s 60–70 local MP3s, rekordbox already covers: analyze folder → playlist → Automix live, plus Related Tracks for key/BPM. It does **not** replace DJ.Studio/Mixxx if the goal is a bounced MP3 without sitting through the set.

### Gaps
- The 7.2.16 Automix section does **not** document whether Automix beatmatches, uses phrase analysis, or applies EQ/filter transitions. Those details were not in the extracted pages; do not assume rekordbox Automix is as smart as VirtualDJ Smart Automix or djay Automix AI.
- Exact which subscription tier is required for MIX POINT LINK, recording, and Automix was not fully readable from the garbled HTML comparison table on rekordbox.com/plan. FAQ says MIX POINT LINK needs a supported plan. Hardware Unlock may change Free-plan PERFORMANCE availability.
- No official “export mix as MP3” (offline bounce) was found in the 7.2.16 manual extract.

---

## Mixed In Key / Captain Plugins / Mixed In Key Studio Edition: what they do vs Rekordbox

### Takeaway
**Mixed In Key 11** is a standalone **library analyzer and tagger**, not a DJ mixer and not an auto-DJ. It detects key (Camelot), BPM, energy 1–10, and up to 8 cue points, writes ID3 tags, and syncs cues into rekordbox/Serato/Traktor. **Studio Edition** is a VST/AU **real-time key detector inside a DAW**. **Captain Plugins** are MIDI composition plugins (chords/melody/bass), not DJ tools. Independent tests in 2024–2026 find Mixed In Key more accurate on key than rekordbox/Serato, but the three engines **disagree on a large fraction of tracks**—so you should pick one key source and disable the others to avoid fighting tags.

### Cited Findings
- Official Mixed In Key 11: “world’s first and most accurate key finding software.” Analyzes key, energy levels, cue points, tempo; Camelot wheel; ID3 tag editing; writes results for Traktor, Serato, Pioneer CDJs, Virtual DJ, Ableton, etc. **Up to 8 automatic cue points** per track, exportable to Traktor, Serato, and rekordbox. Formats: MP3, WAV, AIFF, Apple Lossless, OGG, FLAC. Standard vs **Pro** (one-time purchase, “this is not a subscription”). Pro adds mashup idea engine, mashup deck players, mixout idea engine. A “Improve tracks” playlist points at **Platinum Notes** enhancement. Official claim: v11 algorithm “at least 10% more accurate than any software that has ever existed.” — [mixedinkey.com/learn-more](https://mixedinkey.com/learn-more/)
- How-to (official): set tag preferences → add tracks → analyze → review Key, BPM, Energy, Cue Points; then follow the per-app integration tutorial. Rekordbox cue export is a dedicated XML workflow. — [How to use Mixed In Key](https://mixedinkey.com/workflows/how-to-use-mixed-in-key/)
- rekordbox integration (vendor tutorial): in rekordbox analyze **only BPM/Grid** (not key), export collection XML, point Mixed In Key at that XML, enable rekordbox in MIK DJ software tab, analyze in MIK (cues export while processing), then reload XML playlist into rekordbox collection. Overwrite existing cues option needed if rekordbox already placed a memory cue. Camelot notation; optional custom initial key tag. — [MIK 11 + rekordbox 7 tutorial](https://www.youtube.com/watch?v=SBpS_DLvri0); older MIK 10 + rekordbox video [DlF9gQlB7cM](https://www.youtube.com/watch?v=DlF9gQlB7cM)
- Crossfader test (~200 diverse tracks): all three of MIK 11, rekordbox, and Serato agreed on only **39%**; Serato differed from MIK on **45%**; rekordbox differed on **38%**. Authors say MIK matched sheet music more often. Advice: disable key analysis in DJ software after MIK tagging. — [Crossfader: Mixed In Key 11](https://wearecrossfader.co.uk/blog/mixed-in-key-11/)
- Same 39/45/38 figures restated with algorithm commentary. — [freqblog: Mixed In Key vs Rekordbox vs Serato](https://freqblog.com/blog/mixed-in-key-vs-rekordbox-serato-key-detection/)
- Dubspot 2026 200-track test (third-party, not Pioneer): Mixed In Key 11 178/200 fully correct (**89%**); KeyFinder 76%; **Rekordbox 7 69%**; Beatport key data 60%. Rekordbox 7 described as better than older rekordbox, weaker on vocal-heavy tracks (pulls toward relative major). — [Dubspot Lab Report](https://blog.dubspot.com/dubspot-lab-report-mixed-in-key-vs-beatport)
- License/install: Crossfader FAQ — install on up to **3 computers of the same OS** (Mac or Windows). — [Crossfader MIK 11 article](https://wearecrossfader.co.uk/blog/mixed-in-key-11/)
- Bonedo review of MIK 11 Pro: writes Key and Energy into Comment field; sets musically useful cues; **requires internet access** (listed as a con). Energy roughly 1–9 in that review’s wording vs 1–10 on the vendor site. — [Bonedo: Mixed In Key 11 Pro Test](https://www.bonedo.de/artikel/mixed-in-key-11-pro-test/)
- **Studio Edition:** VST/AU plugin; Mac and Windows; M1 native; analyzes incoming audio in real time (channel or master bus); root key, notes present, key changes; aimed at mashups/samples/acapellas **inside a DAW**. Official FAQ: **Internet access required** to use the plugin. Supported DAWs listed (Ableton, Logic, FL, Cubase, Pro Tools, etc.). 30-day money-back. — [mixedinkey.com/studio-edition](https://mixedinkey.com/studio-edition/)
- **Captain Plugins vs MIK vs Studio Edition vs Odesi** (official FAQ on Studio Edition page): Mixed In Key = DJ library key/energy; Odesi = sketch ideas; Captain Plugins = modular VSTs (Captain Chords, Melody, Deep/bass) inside a DAW; Studio Edition = real-time key of samples. Same company. Captain Plugins do **not** analyze a DJ folder or auto-mix. — [Studio Edition FAQ](https://mixedinkey.com/studio-edition/)
- Mixed In Key does **not** play a two-deck mix, does **not** bounce a mixed MP3, and does **not** write Pioneer ANLZ waveform/phrase files. It feeds metadata into DJ software that already mixes.

### Inferences
- If the user likes rekordbox analysis **except key**, Mixed In Key is the specialist overlay: keep rekordbox grids, replace key (and optionally energy + phrase-like cues) via XML/tags. Disable rekordbox KEY analysis after that.
- For a 60–70 track folder, MIK batch analysis is cheap in time. It does not replace rekordbox Automix or Mixxx Auto DJ.
- Studio Edition and Captain Plugins only matter if the user wants to mash up or compose in Logic/Ableton, not if the goal is “auto-mix this playlist folder.”
- Key disagreement across engines is a documented fact, not a bug in one app. Harmonic mixing will be internally consistent only if one detector wins.

### Gaps
- Live shop prices were not retrieved: mixedinkey.com/shop blocked the researcher’s payment-provider country. Third-party pages historically quote ~US$58; do not treat that as current. Confirm on the shop from the user’s Mac.
- Platinum Notes (mastering/enhancement) was only mentioned as a sibling product on the MIK 11 UI; its current feature set and price were not fetched.
- No official Pioneer statement comparing rekordbox key accuracy to Mixed In Key.

---

## Serato DJ, VirtualDJ, Engine DJ, Algoriddim djay Pro, Traktor: Auto DJ, key detection, local-file support, mix recording

### Takeaway
All five play **local MP3s on macOS**. All detect key/BPM in-app. **VirtualDJ** and **djay Pro** have serious Automix. **Traktor Pro 4** has **Cruise Mode** (automatic mixing) plus a Mix Recorder. **Serato DJ Pro explicitly has no auto-blend**—only Autoplay (gapless sequential play). **Engine DJ Desktop is library prep only**; mixing/auto-mix if any is on Engine OS hardware, not the Mac app. Mix recording is widespread for **local** files and is almost universally **disabled for streaming tracks**.

### Cited Findings

**Serato DJ Pro**
- Analyze Files: waveform overviews, corruption check, optional Key/BPM and beatgrids. Serato DJ **4.0** added Analyze on Import (default on). Drag folders/crates onto Analyze. Key column; display as Camelot, classical, Open Key, or original tag (Setup → Library + Display). — [Serato: Analyzing Files](https://support.serato.com/hc/en-us/articles/14361068095759-Analyzing-Files); [Serato key analysis tutorial](https://www.youtube.com/watch?v=kidFB0xJSnw)
- Metadata: Serato writes performance data **into the music files** (including WAV via proprietary method): BPM, key, waveform, cues, loops, autogain. — [Digital DJ Tips: Where your info lives](https://www.digitaldjtips.com/dj-software-secrets/)
- Local files: drag folders into All / crates; Serato references files in place, does not copy them. — [Adding files to the Serato DJ Pro Library](https://support.serato.com/hc/en-us/articles/223446528-Adding-files-to-the-Serato-DJ-Pro-Library)
- **Auto-mix: official no.** “The short answer is no. There is no function in Serato DJ that will auto-blend two tracks together for you.” Autoplay plays tracks one after another **without** crossfading; Autoplay with hardware connected, or sequential play in the Offline player. — [Serato Support: Can Serato DJ auto-mix my songs?](https://support.serato.com/hc/en-us/articles/202304934-Can-Serato-DJ-auto-mix-my-songs)
- Recording: REC panel; default `~/Music/_Serato_/Recording` on macOS; WAV/AIFF 16- or 24-bit; auto-split at 3 h (16-bit) or 1 h 50 min (24-bit). **Recording disabled if a streaming track is loaded.** — [Recording Your Set with Serato DJ Pro](https://support.serato.com/hc/en-us/articles/202304734-Recording-Your-Set-with-Serato-DJ-Pro); [Serato record tutorial](https://www.youtube.com/watch?v=u5WFdjXUeok)
- Spotify in Serato (2026): personal/non-commercial; no recording; no offline; no Stems; no full bulk analysis like local files. — [Lexicon: Serato and Spotify](https://www.lexicondj.com/blog/serato-and-spotify-the-complete-guide-and-why-your-set-still-needs-local-files)

**VirtualDJ**
- Official Automix: drag files or a playlist into Automix; start/stop; **Will Play at** times. Default **single-deck** Automix (other decks free for live takeover); optional `automixDualDeck` uses both decks and the crossfader. Types: **Smart** (optimal mix point from outro/intro, ~4–8 s), Fade remove intro/outro, Fade remove silence, Fade remove nothing, Fade out/Cut in, None (back-to-back). Automix Editor for per-pair custom transitions. Mix now / Play next. Settings include beatmatch-on-fade, max song length, tempo mode (return to 0% / keep pitch / keep BPM ±10%). — [VirtualDJ User Manual — Automix](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html); [Features: Intelligent Automix](https://virtualdj.com/products/virtualdj/features.html)
- Record: master output (or record loopback); formats MP3 (default 192 kbps, option 128/320), OGG, FLAC, WAV, WEBM, MP4. Auto-start, wait-for-sound, pause-on-silence, auto-split, cue sheet. Streaming/DRM tracks cannot be recorded. — [VirtualDJ Record](https://virtualdj.com/manuals/virtualdj/settings/record.html); [How to record your mix in VirtualDJ](https://djgear2k.com/how-to-record-your-mix-in-virtual-dj/)
- License: Free if not professional and no pro controller; Home $4/mo (entry-level controllers, branding remains); Pro monthly (any controller, no drops, advanced AI). Record audio/video is listed on Free in the comparison table. — [VirtualDJ Price](https://www.virtualdj.com/products/virtualdj/price.html); [Licenses](https://virtualdj.com/manuals/virtualdj/settings/licenses.html)
- Reads Rekordbox, Serato, Traktor libraries (third-party feature lists). 2026: VirtualDJ can export **OneLibrary** (AlphaTheta USB format) for CDJ-3000X and related players. — [Digital DJ Tips: VirtualDJ OneLibrary](https://www.digitaldjtips.com/virtualdj-now-officially-supports-alphathetas-onelibrary/)
- Key detection is built into analysis (OpenKeyScan 2026 overview lists VirtualDJ among apps with built-in key). — [OpenKeyScan 2026 comparison](https://www.openkeyscan.com/best-key-detection-software-2026)

**Engine DJ**
- Official Desktop product copy: “Create, manage and prepare your DJ collection from the comfort of a computer.” Import rekordbox / Apple Music / Serato / Traktor; playlists; beatgrids/hot cues/loops; Sync Manager to USB; Smartlists; Active Loops (up to 8); track preview **without loading a deck**; Dropbox; lighting export. Auto Analysis in preferences. — [Engine DJ Desktop](https://enginedj.com/software/enginedj-desktop); [Adding music and exporting](https://support.enginedj.com/support/solutions/articles/69000844056-engine-dj-adding-music-and-exporting-to-a-drive)
- Official FAQ: “The Engine Desktop software serves as a **library management tool**.” Streaming (e.g. Apple Music) is **Engine OS hardware only**, not Desktop. — [Engine DJ: Apple Music in desktop?](https://enginedj.com/kb/solutions/69000867550/engine-dj-can-i-access-apple-music-in-the-engine-dj-desktop-software)
- DJ.Studio’s comparison (vendor blog, but aligned with Engine’s own positioning): Engine DJ Desktop “doesn’t actually have tools for DJ mixing inside”; mixing is Engine OS on Prime/Mixstream hardware. — [DJ.Studio vs Engine DJ](https://dj.studio/blog/engine-dj)
- Analysis data lives in Engine Library DB (`~/Music/Engine Library` on Mac), not in the MP3s (unlike Serato). — [Digital DJ Tips](https://www.digitaldjtips.com/dj-software-secrets/); [Engine library location](https://support.enginedj.com/support/solutions/articles/69000815206-engine-dj-fixing-and-preventing-engine-library-corruption)
- Stems: pre-render on Desktop, play on compatible standalone hardware; not real-time streaming stems. — [DJ Stems Compared 2026](https://thedjmixtape.com/virtualdj-stems-vs-serato-stems-vs-rekordbox-stems/)
- A 2026 “best auto-mix software” aggregator claimed Engine DJ Desktop does auto-mix. That **conflicts** with Engine’s and DJ.Studio’s descriptions of Desktop as library-only. Treat the aggregator as unreliable here. — [wifitalents auto-mix ranking](https://wifitalents.com/best/auto-mix-software/) vs [enginedj.com/software/enginedj-desktop](https://enginedj.com/software/enginedj-desktop)

**Algoriddim djay Pro (Mac)**
- Local + streaming library: Apple Music, Spotify, TIDAL, SoundCloud, Beatport, **Finder / local files**. Requires macOS 10.15+. — [djay Pro for Mac](https://www.algoriddim.com/djay-pro-mac)
- **Automix is a PRO feature:** “AI-powered automatic DJ mixes.” Official Mac settings: Transition (Automatic, Fade, Filter, EQ, Echo, Dissolve, **Neural Mix™**, and more); Duration automatic or N bars/seconds; Tempo adjust Off / Sync / Sync+Tempo blend / Automatic; start/end points automatic or manual; honor song start/end markers; max song play duration. — [Automix settings (djay Pro Mac)](https://help.algoriddim.com/user-manual/djay-pro-mac/settings/automix); [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro)
- Product page: “Automix AI intelligently identifies rhythmic patterns including the best intro and outro sections.” — [djay Pro Mac](https://www.algoriddim.com/djay-pro-mac)
- **Neural Mix™** is real-time stem separation (vocals/drums/harmonics/bass), **not** Auto DJ. Can be used as an Automix *transition* type. Not available on Apple Music or Spotify streams. — [Neural Mix](https://www.algoriddim.com/neural-mix); [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro)
- **Recording** is PRO; “Recording is not available when using streamed tracks.” Bonedo: AAC (~1 MB/min) or WAV (~10 MB/min). Library Batch Analysis is PRO. USB library export on macOS/Windows is PRO. — [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro); [Bonedo djay Pro AI 4 test](https://www.bonedo.de/artikel/algoriddim-djay-pro-ai-4-test/)
- Pricing commonly cited: **$6.99/month or $49.99/year**, one subscription across Mac/iOS/etc. App Store IAP $6.99–$49.99. — [Algoriddim Mac App Store listing](https://apps.apple.com/us/app/djay-dj-app-ai-mix/id450527929); [help.algoriddim.com free vs pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro)

**Traktor Pro 4**
- Official manual TOC includes **“Using Cruise Mode for Automatic Mixing”** (p. 124) and **“Recording Your Mix with the AUDIO RECORDER”** (p. 122). Mix Recorder: Preferences → Mix Recorder; Source Internal (master) or External; directory; split file size up to 2048 MB. Default Mac path `~/Music/Traktor/Recordings`. Mix Recorder **unavailable when any LINK (Beatport/Beatsource streaming) track is loaded**. — [Traktor Pro 4 Manual PDF](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/Traktor-Pro-4-Manual-English-170724.pdf); [Vibes: Record your set in Traktor Pro](https://vibesdj.io/how-to/record-your-set-in-traktor)
- Local formats: MP3, M4A/AAC (no DRM), WAV, AIFF, FLAC, Ogg Vorbis. Import Music Folders / drag-drop. Collection stores metadata, BPM, key, etc., and also writes much of it back to files (hybrid). — [Traktor Pro 4 manual](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/Traktor-Pro-4-Manual-English-170724.pdf); [Digital DJ Tips](https://www.digitaldjtips.com/dj-software-secrets/); [NI blog: manage Traktor library](https://blog.native-instruments.com/how-to-manage-your-traktor-track-library/)
- Stems: generate per-track, stored as MP4 under `Music/Traktor/Stems` on Mac; not real-time. — [Bonedo Traktor Pro 4 test](https://www.bonedo.de/artikel/native-instruments-traktor-pro-4-test/)
- macOS 12–14 listed in 2024 Bonedo spec; community reports of Traktor Pro 4 on Sequoia/M-series exist. Confirm current NI system requirements before relying on Tahoe 26.

### Inferences
- Best **hands-off local-folder auto-mix** among closed-source DJ apps: **VirtualDJ Automix** (Smart + editor, can record MP3) and **djay Pro Automix** (AI transitions including Neural Mix). Rekordbox Automix is the native option if the user stays in Pioneer.
- Serato is a poor fit for “auto-mix a folder” despite excellent local analysis and recording.
- Engine DJ Desktop will not auto-mix on the Mac; only useful here if the user also owns Prime/Mixstream hardware.
- Traktor Cruise Mode is the NI analogue of Automix; details of how smart it is were not extracted from p. 124 (see Gaps).

### Gaps
- Traktor Cruise Mode behavior (beatmatch? intro/outro? EQ?) was not read beyond the manual TOC title.
- Engine OS hardware Auto Mix (if any, on Prime units) was not verified from an Engine OS manual.
- Serato DJ Pro current license price (subscription vs box) was not fetched from serato.com buy page.
- VirtualDJ “2026” stems branding vs Automix: Automix documentation is solid; whether Smart Automix uses stems was not stated in the Automix manual page.

---

## Mixxx (open source): Auto DJ, analysis, export, license, local folders

### Takeaway
Mixxx 2.5 is **GPLv2**, free, macOS/Windows/Linux, built around **local files**. It analyzes BPM/beatgrid, key, ReplayGain, waveforms, intro/outro (silence at −60 dBFS). **Auto DJ** is first-class: queue a playlist or crate, four mix modes using intro/outro cues, records the mix to disk (default WAV). It can **read Rekordbox USB exports** (grids/cues) and Serato file tags. It does **not** auto-sequence by Camelot unless you sort/filter yourself. Analysis stays in Mixxx’s SQLite unless you enable writing tags.

### Cited Findings
- GitHub: “Mixxx is Free DJ software… Mixxx works on GNU/Linux, Windows, and macOS.” **License: GPLv2** (`LICENSE` file). Latest stable via mixxx.org/download. Manual tree is **2.5**. — [github.com/mixxxdj/mixxx](https://github.com/mixxxdj/mixxx)
- Local library: first-run folder scan; Computer view for arbitrary folders; drag MP3/WAV/AIFF/FLAC/Ogg/AAC/Opus into decks. DRM m4p not supported. ALAC-in-m4a not supported (convert to FLAC). — [Mixxx library](https://manual.mixxx.org/latest/en/chapters/library.html); [Getting started](https://manual.mixxx.org/latest/en/chapters/getting_started.html)
- Analyze view: beatgrid, key, ReplayGain, waveforms, corruption. Pre-analyze recommended (CPU heavy). Key column can sort by circle of fifths / Lancelot (Camelot-like). Harmonic mixing: key lock + detected key; notation in Key Detection preferences. Fuzzy search `~key:c#m` for compatible keys. — [Getting started — Analyze](https://manual.mixxx.org/latest/en/chapters/getting_started.html); [DJing with Mixxx — Harmonic mixing](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [Library search](https://manual.mixxx.org/latest/en/chapters/library.html)
- **Auto DJ:** loads tracks and mixes them. Add from library/playlist/crate or drag from Finder. Enable Auto DJ; uses first two opposing decks and **takes the crossfader**. Manual says it does **not** consider volume, frequency content, or rhythms—“not intended to be a replacement for a human DJ” but “good enough to give a human DJ a break.” Modes:
  - **Full Intro + Outro** (default): uses intro/outro cues; crossfade = shorter of outro vs intro; always plays full intro and outro (starts next track during a long outro).
  - **Fade At Outro Start:** aligns intro start to outro start; may cut a long outro.
  - **Full Track** / **Skip Silence:** ignore intro/outro; crossfade N seconds (0 = gapless player); Skip Silence trims −60 dBFS silence.
  Repeat/re-queue option; random from Auto DJ crates; Fade now / Skip. — [DJing with Mixxx — Auto DJ](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html); [Library — Auto DJ](https://manual.mixxx.org/latest/en/chapters/library.html)
- Intro/outro: analyzer places intro start at first sound and outro end at last sound (−60 dBFS). User sets intro end / outro start. Auto DJ uses those section lengths. — same Auto DJ chapter
- **Recording:** main output (or Record/Broadcast input). Preferences → Recording: formats/quality, split, cue files, custom dir. Default **lossless WAV** in `Mixxx/Recordings`. Older manuals mentioned LAME for MP3 recording not enabled by default (licensing); current 2.5 recording chapter documents WAV default and “various audio formats.” — [Recording Your Mix](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- Export playlists/crates to **m3u, m3u8, pls, txt, csv**. Export Track files copies audio only (not Mixxx waveforms). Metadata write-back to files is **off by default** (Preferences → Library → Track Metadata Synchronisation). — [Library playlists/crates](https://manual.mixxx.org/latest/en/chapters/library.html)
- External libraries: iTunes, Traktor, Rhythmbox, Banshee, **Serato**, **Rekordbox** (USB/SD export as above). Playing a track from an external library adds it to Mixxx. — [Using libraries from other software](https://manual.mixxx.org/latest/en/chapters/library.html)
- Analysis data lives in `mixxxdb.sqlite` in the Mixxx settings directory; cloning that directory copies cues/grids to another Mac. — [Mixxx discourse: copy analyzed songs](https://mixxx.discourse.group/t/copy-analyzed-songs-to-usb-other-computers/24507)
- Standalone CLI `mixxx-analyzer` ports Mixxx QueenMary BPM/key, ebur128 gain, silence intro/outro—useful if someone wants Mixxx analysis without the GUI. — [github.com/Radexito/mixxx-analyzer](https://github.com/Radexito/mixxx-analyzer)

### Inferences
- Mixxx is the strongest **free, local, offline** answer to “point at a folder, auto-mix, record an MP3/WAV.” Workflow: add the 60–70 MP3 folder → Analyze → optional key sort / build playlist in Camelot order → Auto DJ Full Intro+Outro → Record.
- Rekordbox analysis reuse: export a USB stick (or use a FAT volume) and open it in Mixxx’s Rekordbox sidebar to pull grids/cues; or export M3U from rekordbox and re-analyze in Mixxx (grids may differ).
- Mixxx Auto DJ will not magically harmonic-mix; the user (or Mixed In Key tags + Mixxx key column sort) must order the playlist.

### Gaps
- Whether Mixxx 2.5 on macOS records MP3 natively (vs WAV-only / LAME) was not confirmed from the 2.5 recording chapter (it says “various audio formats” and defaults to WAV).
- Mixxx does not import rekordbox **XML** natively in the 2.5 library chapter (USB export only). MIXO documents an XML→Mixxx converter path.

---

## Dedicated “auto mix a folder into a set” apps (Pacemaker-style, Mixed In Key mastering, AI DJ, streaming DJ that does not apply)

### Takeaway
The 2026 “drop a local folder, get a mixed set” category is **DJ.Studio** (timeline DAW, local-file mode, bounce MP3/WAV/FLAC, can import rekordbox). Mixed In Key is analysis-only; Platinum Notes is mastering, not DJ mixing. djay Neural Mix is stems, not an auto-set builder (though djay Automix is). Engine DJ Desktop is not an auto-mixer. Spotify/SoundCloud DJ features do not use the user’s MP3 folder. No currently shipping Pacemaker hardware/app showed up in official 2026 docs. Hobby/open-source “AI DJ” projects exist but are not production DJ suites.

### Cited Findings
- **DJ.Studio:** “timeline-based DAW for DJs on Mac and Windows.” Local File mode imports from disk or from rekordbox, Serato, Traktor, VirtualDJ, Engine DJ, Mixed In Key, Apple Music, djay Pro. Auto-arranges transitions; user edits on a timeline. **Export Record:** MP3 (320 kbps), WAV, FLAC; master gain, auto-gain, limiter, optional split-per-transition (WAV/FLAC), CUE sheet. Video MP4/WebM. DJ Set export: M3U/M3U8/TXT/CSV; dedicated rekordbox (hot cues at transitions), Serato, VirtualDJ, djay Pro, Engine DJ, Traktor Pro. Ableton Live project. Mixcloud upload. Default export folder `~/Music/DJ.Studio/Exports`. Streaming Beatport tracks cannot be bounced until **Legalize** (buy). Can record/render faster than realtime (marketing: “5X”). Desktop app can enable rekordbox/Serato libraries in Settings → Library (imports cue points and phrases). — [dj.studio](https://dj.studio/); [How to export a DJ mix](https://dj.studio/academy/export); [Exporting Mixes help](https://help.dj.studio/en/articles/8106079-exporting-mixes); [9 steps to create a mix](https://dj.studio/academy/9-steps-to-create-your-dj-mix); [Export mix to rekordbox](https://help.dj.studio/en/articles/8842722-export-mix-to-rekordbox)
- DJ.Studio help (updated ~2 weeks before fetch): DJ Set tab lists Playlist, rekordbox, Serato, VirtualDJ, djay Pro, Engine DJ, Traktor Pro. FAQ: beatgrid/hotcue export to VirtualDJ/Engine/Traktor “at the moment” not available the same way as rekordbox/Ableton; they say they are building it. — [Exporting Mixes](https://help.dj.studio/en/articles/8106079-exporting-mixes)
- **Mixed In Key / Platinum Notes:** MIK 11 UI has an “Improve tracks” playlist for Platinum Notes enhancement. That is restoration/mastering of individual tracks, not assembling a DJ set. — [mixedinkey.com/learn-more](https://mixedinkey.com/learn-more/)
- **djay Neural Mix / Neural Mix Pro:** source separation and stem mixing; Neural Mix Pro manual describes browsing My Music and My Files folders. Not a folder-to-mixed-MP3 renderer. Automix (separate feature) is the auto-set tool. — [Neural Mix](https://www.algoriddim.com/neural-mix); [Neural Mix Pro manual PDF](https://download.algoriddim.com/manual/neural-mix-pro-manual-loqual.pdf)
- **Streaming DJ (does not apply):** Spotify-in-rekordbox/Serato/djay cannot USB-export, generally cannot record, cannot use stems. SoundCloud/Spotify DJ radio-style features are catalog-side, not the user’s MP3 folder. — [DJGear2K Spotify 2026](https://djgear2k.com/can-you-dj-with-spotify/); [Save My Gig USB](https://www.savemygig.com/fix/streaming-tracks-usb-export)
- **Open-source AI DJ (GitHub ElMoorish/AI-DJ-Software):** Electron/ONNX, offline, Camelot + BPM + energy sequencer, FFmpeg render of MP3 mixes with EQ sweeps/echo-outs. Project-page claims, not a reviewed shipping product. — [GitHub AI-DJ-Software](https://github.com/ElMoorish/AI-DJ-Software.git)
- **RoEx Automix Desktop:** AI *production* mix/master of stems (EQ/compression), not DJ beatmixing a playlist of songs. Easy to confuse by name. — [RoEx Automix Desktop](https://www.roexaudio.com/blog/introducing-automix-desktop-beta)
- **Pacemaker:** no current official product page appeared in 2026 search results for local-folder auto-mix apps; results were VirtualDJ, Mixxx, djay, DJ.Studio.

### Inferences
- If the user wants **one mixed MP3 of the 60–70 track folder** with editable transitions, **DJ.Studio local file mode** is the dedicated tool, and it can reuse rekordbox cues/phrases.
- If they want **hands-off live playback** (party, background), Mixxx Auto DJ, VirtualDJ Automix, djay Automix, or rekordbox Automix are the right class—not Mixed In Key.
- Ignore Spotify DJ / SoundCloud DJ for this library.

### Gaps
- DJ.Studio current macOS version, offline license behavior, and price were not fetched from the buy page (7-day trial is advertised).
- Pacemaker (the 2010s auto-DJ hardware) current status was not independently confirmed beyond absence in 2026 vendor results.
- No evaluation of AI-DJ-Software quality; treat as unproven.

---

## Which tools can preview a mix live vs bounce/export a mixed MP3

### Takeaway
**Live preview / auto-DJ while you listen:** rekordbox Automix, Mixxx Auto DJ, VirtualDJ Automix, djay Automix, Traktor Cruise Mode. **True offline bounce to a mixed file (render, not real-time record):** DJ.Studio is the clear dedicated renderer (MP3/WAV/FLAC, faster than realtime). Everyone else “exports a mix” by **recording the live master** (WAV/AIFF/MP3 depending on app) while Automix or you play. Streaming tracks block recording almost everywhere.

### Cited Findings
- **DJ.Studio:** render path is Export → Record → Audio (MP3 320 / WAV / FLAC), not a live capture of a two-deck mixer. Optional 5× render (product page). Auto-gain/limiter. Split-per-transition for WAV/FLAC. — [Exporting Mixes](https://help.dj.studio/en/articles/8106079-exporting-mixes); [dj.studio](https://dj.studio/)
- **Mixxx:** Auto DJ is live (crossfader moves). Recording is a parallel capture of main output to WAV (default). You listen at 1× while it records. — [Mixxx Auto DJ + Recording](https://manual.mixxx.org/latest/en/chapters/djing_with_mixxx.html)
- **VirtualDJ:** Automix is live; Record writes MP3/OGG/FLAC/WAV (and video). Smart automix mix-in/out shown on waveform. — [VDJ Automix](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html); [VDJ Record](https://virtualdj.com/manuals/virtualdj/settings/record.html)
- **djay Pro:** Automix live with AI transitions; Recording is a PRO capture; no recording of streams; Bonedo reports AAC or WAV. — [Automix settings](https://help.algoriddim.com/user-manual/djay-pro-mac/settings/automix); [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro)
- **rekordbox:** Automix live on decks 1/2; recording panel exists (plan/hardware caveats); USB export is **unmixed tracks + analysis**, not a mixdown. Playlist m3u8/txt is a list, not audio. — [7.2.16 manual Automix p.171](https://cdn.rekordbox.com/files/20260706162433/rekordbox7.2.16_manual_EN.pdf)
- **Serato:** no automix; recording is live capture to WAV/AIFF only (not MP3 in the official article). — [Serato recording](https://support.serato.com/hc/en-us/articles/202304734-Recording-Your-Set-with-Serato-DJ-Pro)
- **Traktor:** Cruise Mode live; Mix Recorder writes a file (split by size); convert to MP3 afterwards if needed (third-party how-to). LINK tracks disable Mix Recorder. — [Traktor Pro 4 manual](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/Traktor-Pro-4-Manual-English-170724.pdf)
- **Engine DJ Desktop:** preview a track from the list; no mix bounce in the Desktop product description. — [Engine DJ Desktop](https://enginedj.com/software/enginedj-desktop)
- **Mixed In Key:** no mix playback beyond a preview player; no mixdown.

| Tool | Live auto-mix preview | Bounce/render mixed audio | Typical file |
| --- | --- | --- | --- |
| rekordbox 7.2.x | Automix window (PERFORMANCE) | Record panel (live) | Plan-dependent; not USB mixdown |
| Mixxx 2.5 | Auto DJ | Record mix (live, default WAV) | WAV; cue sheet optional |
| VirtualDJ | Automix (Smart + editor) | Record (live) | MP3/WAV/FLAC/OGG |
| djay Pro | Automix AI | Record (PRO, live) | AAC or WAV (Bonedo) |
| Traktor Pro 4 | Cruise Mode | Mix Recorder (live) | WAV-class file; split by MB |
| Serato DJ Pro | No (Autoplay only) | REC panel (live) | WAV/AIFF |
| Engine DJ Desktop | No mix | No | n/a on Mac app |
| DJ.Studio | Timeline preview in app | **Offline render** | MP3 320 / WAV / FLAC |
| Mixed In Key 11 | No | No | tags/cues only |

### Inferences
- “Export a mixed MP3 of my playlist folder” without sitting through 4 hours: **DJ.Studio**.
- “Let it run at a party and maybe record”: Mixxx, VirtualDJ, djay, or rekordbox Automix + record.
- rekordbox USB export is the wrong button for a mixtape; it prepares CDJs.

### Gaps
- rekordbox recording file format (MP3 vs WAV) and whether Free plan recording is fully enabled were not in the extracted manual pages.
- djay official recording format is not on the Free vs Pro page (only Bonedo’s AAC/WAV).
- Whether VirtualDJ Smart Automix can be “printed” faster than realtime: not documented; assume 1× live record.

---

## Licensing, macOS support, offline / local-file requirement

### Takeaway
All major tools here run on **macOS** and play **local MP3s offline** once analyzed. Subscriptions (rekordbox paid plans, djay Pro, VirtualDJ Home/Pro, Serato) may still want periodic online account checks. Mixed In Key 11 Pro and Studio Edition have been reported/required to use the internet. Mixxx is the only fully free/open offline suite. Hardware is **not** required for Mixxx, VirtualDJ (keyboard/mouse), djay, rekordbox PERFORMANCE (software mixer), Traktor, or DJ.Studio; Engine mixing requires Engine hardware. Streaming integrations are optional and must be ignored for this offline MP3 folder.

### Cited Findings
- **rekordbox:** Mac/Windows; Tahoe 26 compatibility posted. Free plan exists; Core/Creative/Professional subscriptions. Hardware Unlock with eligible Pioneer/AlphaTheta gear. Analysis of local files is core even on Free (library management). Some PERFORMANCE features and MIX POINT LINK are plan-gated. Cloud analysis is optional (“High-speed analysis using the cloud”). Local Collection + USB export work on owned files without streaming. — [Plans](https://rekordbox.com/en/plan/); [Information / Tahoe](https://rekordbox.com/en/support/information/)
- **Mixxx:** GPLv2, no license fee, macOS via .dmg to Applications. Local files; analysis and Auto DJ work offline. MusicBrainz lookup needs net (optional). — [GitHub Mixxx](https://github.com/mixxxdj/mixxx); [Getting started](https://manual.mixxx.org/latest/en/chapters/getting_started.html)
- **VirtualDJ:** Mac and Windows. Free / Home / Pro / Business. Local files in the browser; Automix and Record documented without requiring hardware. Pro needed for professional use and full controller support. Login enables licenses; some features limited if not logged in. — [Price](https://www.virtualdj.com/products/virtualdj/price.html)
- **djay Pro:** macOS 10.15+; Mac App Store. Free download; PRO subscription unlocks Automix, Neural Mix, Recording, batch analysis. Local Finder files work; streaming optional. Recording/Neural Mix blocked on Apple Music/Spotify. — [djay Pro Mac](https://www.algoriddim.com/djay-pro-mac); [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro)
- **Serato DJ Pro:** local library; analysis; recording. Auto-mix absent. Hardware unlocks some modes historically (older docs required disconnecting hardware to analyze; 4.0 Analyze on Import). Streaming optional and recording-incompatible. — [Analyzing Files](https://support.serato.com/hc/en-us/articles/14361068095759-Analyzing-Files)
- **Traktor Pro 4:** paid NI product; local collection; Cruise Mode + Mix Recorder. LINK streaming disables recorder. Bonedo 2024: macOS 12–14; community use on Sequoia. — [Traktor Pro 4 manual](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/Traktor-Pro-4-Manual-English-170724.pdf)
- **Engine DJ Desktop:** free library app (download from enginedj.com); Mac supported. Mixing requires Engine OS hardware. Local files on internal APFS are fine for Desktop; performance sticks need FAT32/exFAT. — [Engine DJ Desktop](https://enginedj.com/software/enginedj-desktop)
- **Mixed In Key 11:** Mac and Windows; one-time license; up to 3 same-OS computers (Crossfader). Bonedo: internet required for 11 Pro. Studio Edition FAQ: internet required. — [learn-more](https://mixedinkey.com/learn-more/); [Studio Edition FAQ](https://mixedinkey.com/studio-edition/); [Bonedo](https://www.bonedo.de/artikel/mixed-in-key-11-pro-test/)
- **DJ.Studio:** Mac and Windows desktop; 7-day trial advertised; local file mode is the relevant path. — [dj.studio](https://dj.studio/)
- **OneLibrary / Device Library Plus:** AlphaTheta USB format that VirtualDJ (and promised Traktor) can write for CDJ-3000-class players. Not required for laptop mixing. Spec not publicly documented. — [Digital DJ Tips OneLibrary](https://www.digitaldjtips.com/virtualdj-now-officially-supports-alphathetas-onelibrary/)

### Inferences
- For **offline personal MP3s on a Mac, no extra hardware:** Mixxx (free), VirtualDJ (free–Pro), djay Pro (sub for Automix+record), rekordbox (already owned), DJ.Studio (bounce).
- Do not buy Engine hardware or a Serato controller just to auto-mix this folder.
- Keep cookies/streaming logins out of the mix-record path; use the local playlist folder only.

### Gaps
- rekordbox Free vs paid exact matrix for Automix and recording (HTML comparison table on /plan did not serialize feature checkmarks reliably).
- Mixed In Key and DJ.Studio current USD prices (shop/geo issues).
- Traktor Pro 4 current NI store price and Tahoe 26 official support.
- Whether Mixed In Key 11 still requires always-on internet after activation (Bonedo said yes for Pro; vendor FAQ for Studio Edition is explicit; MIK 11 desktop FAQ was not a dedicated offline page).

---

## Practical fit for a ~60–70 track local MP3 playlist (synthesis)

This section only combines cited facts above; it is not a new product claim.

- **Stay in rekordbox:** Import the folder → Track Analysis (BPM/Grid, KEY, Phrase) → playlist → PERFORMANCE Automix and/or RELATED TRACKS. Record the session if a file is needed. Export XML if other tools should see BPM/key/cues. USB export only if playing on CDJs.
- **Better keys, still rekordbox decks:** Mixed In Key 11 on the folder, XML cue/key sync, disable rekordbox KEY re-analysis.
- **Hands-off live + record WAV/MP3, free:** Mixxx 2.5 Auto DJ on that folder (optionally ingest rekordbox USB grids).
- **Smarter live automix + record MP3:** VirtualDJ Automix Smart, or djay Pro Automix (Neural Mix transitions if PRO).
- **Edited, bounced mixtape MP3 without playing in real time:** DJ.Studio Local File mode, optionally reading the rekordbox library, Export → Record MP3.
- **Do not use for this job:** Serato (no automix), Engine DJ Desktop (no mix), Captain Plugins / Studio Edition (DAW, not DJ auto-mix), Spotify/SoundCloud DJ (not local files).
