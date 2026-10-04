"""Per-track analysis: beats/downbeats (Beat This!), key (Essentia), loudness and energy features.

Results are cached as JSON keyed by path + size + mtime, so re-running is free.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time

import numpy as np

from .audio import SR, decode

AUDIO_EXT = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus", ".aac"}
ANALYSIS_VERSION = 1

CAMELOT = {
    ("minor", "Ab"): "1A", ("minor", "Eb"): "2A", ("minor", "Bb"): "3A", ("minor", "F"): "4A",
    ("minor", "C"): "5A", ("minor", "G"): "6A", ("minor", "D"): "7A", ("minor", "A"): "8A",
    ("minor", "E"): "9A", ("minor", "B"): "10A", ("minor", "F#"): "11A", ("minor", "Db"): "12A",
    ("major", "B"): "1B", ("major", "F#"): "2B", ("major", "Db"): "3B", ("major", "Ab"): "4B",
    ("major", "Eb"): "5B", ("major", "Bb"): "6B", ("major", "F"): "7B", ("major", "C"): "8B",
    ("major", "G"): "9B", ("major", "D"): "10B", ("major", "A"): "11B", ("major", "E"): "12B",
}
ENHARMONIC = {"C#": "Db", "D#": "Eb", "G#": "Ab", "A#": "Bb", "Gb": "F#"}


def list_tracks(folder: str) -> list[str]:
    return sorted(
        os.path.join(folder, f) for f in os.listdir(folder)
        if not f.startswith(".") and os.path.splitext(f)[1].lower() in AUDIO_EXT
    )


def track_id(path: str) -> str:
    m = re.search(r"\[sp-([A-Za-z0-9]{22})\]", os.path.basename(path))
    if m:
        return "spotify:" + m.group(1)
    return "file:" + hashlib.sha1(os.path.basename(path).encode()).hexdigest()[:16]


def display_name(path: str) -> tuple[str, str]:
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = re.sub(r"\s*\[sp-[A-Za-z0-9]{22}\]$", "", stem)
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", stem


def cache_path(cache_dir: str, path: str) -> str:
    st = os.stat(path)
    h = hashlib.sha1(f"{ANALYSIS_VERSION}|{path}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()
    return os.path.join(cache_dir, h[:2], h + ".json")


_beat_model = None


def _beats(mono44: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    global _beat_model
    if _beat_model is None:
        import torch
        from beat_this.inference import Audio2Beats
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        try:
            _beat_model = Audio2Beats(checkpoint_path="final0", device=device)
        except Exception:
            _beat_model = Audio2Beats(checkpoint_path="final0", device="cpu")
    beats, downbeats = _beat_model(mono44, SR)
    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)


def _key(mono44: np.ndarray) -> dict:
    import essentia.standard as es
    results = {}
    for profile in ("edma", "bgate", "krumhansl"):
        key, scale, strength = es.KeyExtractor(profileType=profile, sampleRate=SR)(mono44)
        results[profile] = (ENHARMONIC.get(key, key), scale, float(strength))
    # pick the most confident profile; edma/bgate suit electronic, krumhansl suits the rest
    best = max(results.values(), key=lambda r: r[2])
    key, scale, strength = best
    return {"key": key, "scale": scale, "strength": strength,
            "camelot": CAMELOT.get((scale, key), "?"),
            "profiles": {k: f"{v[0]} {v[1]} ({v[2]:.2f})" for k, v in results.items()}}


def _energy(y: np.ndarray, mono44: np.ndarray) -> dict:
    import essentia.standard as es
    import librosa
    import pyloudnorm

    lufs = float(pyloudnorm.Meter(SR).integrated_loudness(y.astype(np.float64)))
    mono22 = librosa.resample(mono44, orig_sr=SR, target_sr=22050)
    hop = 512
    rms = librosa.feature.rms(y=mono22, hop_length=hop)[0]
    active = rms > (np.max(rms) * 0.1)
    onset = librosa.onset.onset_strength(y=mono22, sr=22050, hop_length=hop)
    centroid = librosa.feature.spectral_centroid(y=mono22, sr=22050, hop_length=hop)[0]
    S = np.abs(librosa.stft(mono22, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=22050, n_fft=2048)
    low = S[freqs < 150].sum(axis=0)
    total = S.sum(axis=0) + 1e-9
    n = min(len(active), len(onset), len(centroid), len(low))
    a = active[:n] if active[:n].any() else np.ones(n, bool)
    dance, _ = es.Danceability(sampleRate=SR)(mono44)
    rms_db = 20 * np.log10(rms[:n][a] + 1e-9)
    return {
        "lufs": lufs,
        "danceability": float(dance),
        "onset_strength": float(np.mean(onset[:n][a])),
        "brightness": float(np.mean(centroid[:n][a])),
        "bass_ratio": float(np.mean((low / total)[:n][a])),
        "dynamics_db": float(np.percentile(rms_db, 95) - np.percentile(rms_db, 20)),
    }


def _bar_levels(y: np.ndarray, bar_starts: list[float], duration: float) -> list[float]:
    """RMS level (dBFS) of each bar, used to find intros/outros."""
    mono = y.mean(axis=1)
    edges = list(bar_starts) + [duration]
    out = []
    for s, e in zip(edges[:-1], edges[1:]):
        seg = mono[int(s * SR): int(e * SR)]
        out.append(float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)) if len(seg) else -120.0)
    return out


def _second_levels(y: np.ndarray) -> list[float]:
    mono = y.mean(axis=1)
    n = len(mono) // SR
    if n == 0:
        return []
    blocks = mono[: n * SR].reshape(n, SR)
    return [round(float(v), 2) for v in 20 * np.log10(np.sqrt((blocks ** 2).mean(axis=1)) + 1e-9)]


def analyze_file(path: str) -> dict:
    t0 = time.time()
    y = decode(path)
    duration = len(y) / SR
    mono44 = y.mean(axis=1).astype(np.float32)
    beats, downbeats = _beats(mono44)
    ibi = np.diff(beats) if len(beats) > 2 else np.array([0.5])
    med = float(np.median(ibi))
    bpm = 60.0 / med if med > 0 else 0.0
    # regularity: fraction of beat intervals within 8% of the local median
    regular = float(np.mean(np.abs(ibi - med) / max(med, 1e-6) < 0.08)) if len(ibi) > 4 else 0.0
    coverage = float((beats[-1] - beats[0]) / duration) if len(beats) > 2 else 0.0
    beats_per_bar = 4
    if len(downbeats) > 2:
        counts = [int(np.sum((beats >= a - 0.02) & (beats < b - 0.02)))
                  for a, b in zip(downbeats[:-1], downbeats[1:])]
        if counts:
            beats_per_bar = int(np.bincount(counts).argmax())
    artist, title = display_name(path)
    result = {
        "version": ANALYSIS_VERSION,
        "path": path,
        "file": os.path.basename(path),
        "id": track_id(path),
        "artist": artist,
        "title": title,
        "duration": duration,
        "bpm": round(bpm, 2),
        "beat_regularity": round(regular, 3),
        "beat_coverage": round(coverage, 3),
        "beats_per_bar": beats_per_bar,
        "beats": [round(float(b), 4) for b in beats],
        "downbeats": [round(float(b), 4) for b in downbeats],
        "bar_db": [round(v, 2) for v in _bar_levels(y, downbeats.tolist(), duration)],
        "second_db": _second_levels(y),
        **_key(mono44),
        **_energy(y, mono44),
    }
    result["analysis_seconds"] = round(time.time() - t0, 1)
    return result


def refine(t: dict) -> dict:
    """Beat This! works on a 20 ms frame grid; estimate tempo from multi-beat spans instead."""
    b = np.asarray(t.get("beats", []), dtype=float)
    if len(b) > 17:
        spans = (b[16:] - b[:-16]) / 16
        med = float(np.median(spans))
        good = spans[np.abs(spans - med) / med < 0.05]
        if len(good):
            t["bpm_raw"] = t["bpm"]
            t["bpm"] = round(60.0 / float(np.mean(good)), 2)
    return t


def analyze_folder(folder: str, cache_dir: str, log=print) -> list[dict]:
    tracks = list_tracks(folder)
    out = []
    for i, path in enumerate(tracks, 1):
        cp = cache_path(cache_dir, path)
        if os.path.exists(cp):
            with open(cp) as fh:
                out.append(refine(json.load(fh)))
            continue
        try:
            res = analyze_file(path)
        except Exception as exc:  # keep going; a broken file is excluded from the mix
            log(f"[{i}/{len(tracks)}] FAILED {os.path.basename(path)}: {exc}")
            continue
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        tmp = cp + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(res, fh)
        os.replace(tmp, cp)
        out.append(refine(res))
        log(f"[{i}/{len(tracks)}] {res['bpm']:6.1f} bpm  {res['camelot']:>3}  "
            f"reg {res['beat_regularity']:.2f}  {res['lufs']:6.1f} LUFS  "
            f"{res['analysis_seconds']:4.1f}s  {res['file']}")
        sys.stdout.flush()
    return out
