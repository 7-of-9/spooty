"""Synthetic test audio with sample-exact, known onsets (numpy only, deterministic).

    from synth import make_track, click_track, mix_parts
    s = make_track(bpm=126, sections=[("intro", 4, {"kick", "hat"}), ("break", 4, {"pad"}),
                                      ("drop", 8, {"kick", "hat", "bass", "pad", "vox"})])
    s.y            # (n, 2) float32 mix at s.sr
    s.beats        # every beat (s); s.downbeats; beat k is exactly at sample round(t * sr)
    s.onsets       # {"kick": t[], "hat": t[], "snare": t[], "bass": t[], "pad": t[], "vox": t[], "click": t[]}
    s.stems        # {"drums", "bass", "vocals", "other"} (n, 2); their sum equals s.y exactly
    s.bars         # [{"t", "section", "parts"}] per bar

Every hit starts exactly on its onset sample with silence (from that part) before it, so an
onset detector can be scored to the sample. `jitter_ms` moves each beat by a seeded random
offset (for fit/class tests); `bpm_end` makes a linear tempo ramp across the track.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SR = 44100
PARTS = ("kick", "snare", "hat", "bass", "pad", "vox", "click")
STEM_OF = {"kick": "drums", "snare": "drums", "hat": "drums", "click": "drums",
           "bass": "bass", "vox": "vocals", "pad": "other"}
DEFAULT_SECTIONS = [("intro", 4, {"kick", "hat"}), ("break", 4, {"pad", "hat"}),
                    ("drop", 8, {"kick", "snare", "hat", "bass", "pad"})]


@dataclass
class Synth:
    y: np.ndarray
    sr: int
    bpm: float
    bpb: int
    beats: np.ndarray
    downbeats: np.ndarray
    onsets: dict[str, np.ndarray]
    stems: dict[str, np.ndarray]
    bars: list[dict] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return len(self.y) / self.sr


# ---- instruments (mono, start at sample 0 with a non-zero first sample) ----------------------
def kick(sr: int = SR, dur: float = 0.25, f0: float = 150.0, f1: float = 50.0, amp: float = 0.8) -> np.ndarray:
    t = np.arange(int(dur * sr)) / sr
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    return (amp * np.sin(2 * np.pi * np.cumsum(f) / sr + np.pi / 2) * np.exp(-t / 0.12)).astype(np.float32)


def noise_hit(sr: int = SR, dur: float = 0.05, tau: float = 0.008, amp: float = 0.25,
              seed: int = 0, hp: bool = True) -> np.ndarray:
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(int(dur * sr))
    if hp:                                         # first difference = crude high-pass (hats)
        x = np.diff(x, prepend=0.0)
    x[0] = abs(x[0]) + 1.0
    return (amp * x / np.max(np.abs(x)) * np.exp(-np.arange(len(x)) / (tau * sr))).astype(np.float32)


def click(sr: int = SR, ms: float = 2.0, freq: float = 3000.0, amp: float = 0.9) -> np.ndarray:
    t = np.arange(int(ms / 1000 * sr)) / sr
    return (amp * np.cos(2 * np.pi * freq * t) * np.hanning(len(t) * 2)[len(t):]).astype(np.float32)


def tone(freqs, dur: float, sr: int = SR, attack: float = 0.005, release: float = 0.05,
         amp: float = 0.15, saw: bool = False) -> np.ndarray:
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = np.zeros(n)
    for f in np.atleast_1d(freqs):
        x += (2 * ((t * f) % 1.0) - 1) if saw else np.sin(2 * np.pi * f * t)
    env = np.minimum(1.0, (t + 1.0 / sr) / attack) * np.minimum(1.0, (dur - t) / release)
    return (amp * x / len(np.atleast_1d(freqs)) * np.clip(env, 0, 1)).astype(np.float32)


def midi_hz(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


# ---- track builder ----------------------------------------------------------------------------
def _add(buf: np.ndarray, x: np.ndarray, i: int) -> None:
    j = min(len(buf), i + len(x))
    if 0 <= i < j:
        buf[i:j] += x[: j - i]


def make_track(bpm: float = 126.0, sections: list | None = None, bpb: int = 4, sr: int = SR,
               start_s: float = 0.5, tail_s: float = 1.0, jitter_ms: float = 0.0,
               bpm_end: float | None = None, root: int = 57, seed: int = 0) -> Synth:
    """A four-on-the-floor style track: kick on every beat, snare on 2 and 4, hats on the
    eighth-note offbeats, a bass note per beat, a pad chord per bar and a vocal-ish tone
    (harmonics 300-3400 Hz) on beats 1 and 3. Parts per section come from `sections`
    [(name, bars, {parts})]."""
    sections = sections or DEFAULT_SECTIONS
    nbars = sum(n for _, n, _ in sections)
    nbeats = nbars * bpb
    rng = np.random.default_rng(seed)
    b1 = bpm if bpm_end is None else bpm_end
    per = 60.0 / np.linspace(bpm, b1, nbeats + 1)            # linear bpm ramp over the beats
    bt = start_s + np.concatenate([[0.0], np.cumsum(per[:-1])])
    if jitter_ms:
        bt[:-1] += rng.uniform(-jitter_ms, jitter_ms, nbeats) / 1000
    bt = np.round(bt * sr) / sr                                 # sample-exact
    n = int(round((bt[-1] + tail_s) * sr))
    bufs = {p: np.zeros(n, np.float32) for p in PARTS}
    onsets: dict[str, list[float]] = {p: [] for p in PARTS}
    bars = []
    chords = [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]]   # i - iv - III - v (minor)
    k = 0
    for name, nb, parts in sections:
        for _ in range(nb):
            bar = k // bpb
            bars.append({"t": float(bt[k]), "section": name, "parts": sorted(parts)})
            chord = [midi_hz(root + x) for x in chords[bar % 4]]
            if "pad" in parts:
                pad = tone(chord, bt[k + bpb] - bt[k], sr, attack=0.08, release=0.08)
                _add(bufs["pad"], pad, int(round(bt[k] * sr)))
                onsets["pad"].append(float(bt[k]))
            for q in range(bpb):
                i, beat = int(round(bt[k] * sr)), bt[k]
                nxt = bt[k + 1]
                if "kick" in parts:
                    _add(bufs["kick"], kick(sr), i)
                    onsets["kick"].append(float(beat))
                if "click" in parts:
                    _add(bufs["click"], click(sr, amp=0.9 if q == 0 else 0.5), i)
                    onsets["click"].append(float(beat))
                if "snare" in parts and q % 2 == 1:
                    _add(bufs["snare"], noise_hit(sr, 0.15, 0.04, 0.3, seed=k, hp=False), i)
                    onsets["snare"].append(float(beat))
                if "hat" in parts:
                    h = np.round((beat + nxt) / 2 * sr) / sr
                    _add(bufs["hat"], noise_hit(sr, seed=10_000 + k), int(round(h * sr)))
                    onsets["hat"].append(float(h))
                if "bass" in parts:
                    _add(bufs["bass"], tone(midi_hz(root - 24 + chords[bar % 4][0]), (nxt - beat) * 0.9, sr,
                                            amp=0.3, saw=True), i)
                    onsets["bass"].append(float(beat))
                if "vox" in parts and q % 2 == 0:
                    f0 = midi_hz(root + 12 + chords[bar % 4][q // 2 % 3])
                    _add(bufs["vox"], tone([f0, 2 * f0, 3 * f0], (nxt - beat) * 1.8, sr, attack=0.02, amp=0.12), i)
                    onsets["vox"].append(float(beat))
                k += 1
    stems = {s: np.zeros(n, np.float32) for s in ("drums", "bass", "vocals", "other")}
    for p, x in bufs.items():
        stems[STEM_OF[p]] += x
    stems2 = {s: np.repeat(x[:, None], 2, axis=1) for s, x in stems.items()}
    y = stems2["drums"] + stems2["bass"] + stems2["vocals"] + stems2["other"]
    beats = bt[:-1]
    return Synth(y=y, sr=sr, bpm=float(bpm), bpb=bpb, beats=beats, downbeats=beats[::bpb],
                 onsets={p: np.asarray(v) for p, v in onsets.items()}, stems=stems2, bars=bars)


def click_track(bpm: float = 120.0, bars: int = 8, bpb: int = 4, sr: int = SR, **kw) -> Synth:
    """Clicks on every beat (accented downbeats): the simplest known-onset signal."""
    return make_track(bpm, [("clicks", bars, {"click"})], bpb=bpb, sr=sr, **kw)


def mix_parts(a: np.ndarray, b: np.ndarray, offset_s: float = 0.0, sr: int = SR,
              gain_b_db: float = 0.0) -> np.ndarray:
    """a + b delayed by offset_s (e.g. a 30 ms flam for V3 tests), padded to fit both."""
    off = int(round(offset_s * sr))
    n = max(len(a), len(b) + off)
    out = np.zeros((n, 2), np.float32)
    out[: len(a)] += a
    out[off: off + len(b)] += b * np.float32(10 ** (gain_b_db / 20))
    return out


def write_wav(path: str, y: np.ndarray, sr: int = SR) -> None:
    import soundfile as sf
    sf.write(path, y, sr, subtype="FLOAT")
