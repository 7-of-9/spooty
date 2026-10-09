"""Audio-only structural boundaries without invented verse/chorus labels.

Chroma, MFCC timbre and RMS level are synchronised to detected downbeats. A
checkerboard novelty kernel finds changes in their self-similarity matrix;
section feature similarity records repeated musical material separately.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks

from .audio import decode

METHOD = "beat-synchronous chroma/MFCC/loudness self-similarity novelty v1"


def structural_boundaries(features, edges, min_seconds=10.0):
    """Return independently measured boundary strength, including file endpoints."""
    features = np.asarray(features, float)
    edges = np.asarray(edges, float)
    if features.shape[1] != len(edges) - 1:
        raise ValueError("One feature column is required for each edge interval")
    if features.shape[1] < 8:
        return [(0.0, 1.0), (float(edges[-1]), 1.0)]
    # Robust per-feature standardisation balances harmonic, timbral and level changes.
    centered = features - np.median(features, axis=1, keepdims=True)
    scale = np.std(centered, axis=1, keepdims=True)
    centered /= np.maximum(scale, .05)
    centered /= np.maximum(np.linalg.norm(centered, axis=0, keepdims=True), 1e-8)
    similarity = centered.T @ centered
    radius = min(8, max(2, features.shape[1] // 12))
    taper = np.exp(-.5 * (np.arange(-radius, radius) / (radius / 2)) ** 2)
    signed = np.r_[-np.ones(radius), np.ones(radius)] * taper
    kernel = signed[:, None] * signed[None, :]
    kernel /= np.sum(abs(kernel))
    novelty = np.zeros(features.shape[1] + 1)
    for index in range(radius, features.shape[1] - radius + 1):
        novelty[index] = max(0, float(np.sum(similarity[index - radius:index + radius,
                                                        index - radius:index + radius] * kernel)))
    peaks, _ = find_peaks(novelty, prominence=max(.035, float(np.percentile(novelty, 65)) * .18))
    chosen = []
    for index in sorted(peaks, key=lambda k: -novelty[k]):
        at = edges[index]
        if at < min_seconds or edges[-1] - at < min_seconds:
            continue
        if all(abs(at - edges[old]) >= min_seconds for old in chosen):
            chosen.append(index)
    norm = max(float(novelty.max()), 1e-6)
    return [(0.0, 1.0)] + [(float(edges[k]), round(float(novelty[k] / norm), 4))
                           for k in sorted(chosen)] + [(float(edges[-1]), 1.0)]


def scan_sections(track):
    import librosa
    sr, hop = 22050, 1024
    y = decode(track["path"], sr=sr).mean(axis=1)
    spec = abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    chroma = librosa.feature.chroma_stft(S=spec ** 2, sr=sr, n_fft=2048, hop_length=hop, tuning=0)
    mel = librosa.feature.melspectrogram(S=spec ** 2, sr=sr, n_fft=2048, n_mels=48)
    mfcc = librosa.feature.mfcc(S=librosa.power_to_db(mel), sr=sr, n_mfcc=13)[1:]
    rms = librosa.feature.rms(S=spec, frame_length=2048, hop_length=hop)
    features = np.vstack((chroma, mfcc / 20, np.log10(np.maximum(rms, 1e-6)) * 3))
    duration = float(track["duration"])
    downs = np.asarray(track.get("downbeats", []), float)
    # Downbeats can be unreliable in rubato classical recordings. Fixed two-second
    # bins still analyse the entire signal and make no beat-grid assertion.
    reliable = track.get("beat_regularity", 0) >= .7 and len(downs) >= 12
    grid = downs if reliable else np.arange(0, duration, 2.0)
    edges = np.unique(np.r_[0, grid[(grid > 0) & (grid < duration)], duration])
    cols = []
    for start, end in zip(edges[:-1], edges[1:]):
        lo = min(features.shape[1] - 1, int(start * sr / hop))
        hi = min(features.shape[1], max(lo + 1, int(end * sr / hop)))
        cols.append(features[:, lo:hi].mean(axis=1))
    synced = np.stack(cols, axis=1)
    boundaries = structural_boundaries(synced, edges)
    segments, vectors = [], []
    for (start, strength), (end, _) in zip(boundaries[:-1], boundaries[1:]):
        lo, hi = np.searchsorted(edges, [start, end])
        vec = synced[:, lo:hi].mean(axis=1)
        vectors.append(vec)
        segments.append({"start": round(start, 4), "end": round(end, 4), "label": "section",
                         "boundaryStrength": strength, "semanticLabel": "unassigned"})
    for i, segment in enumerate(segments):
        # Repetition is a relative signal, not a claim that a passage is a chorus.
        other = [float(np.linalg.norm(vectors[i] - vector)) for j, vector in enumerate(vectors) if j != i]
        segment["nearestSectionDistance"] = round(min(other), 4) if other else None
    return {"path": track["path"], "sourceSha256": track["sha256"], "method": METHOD,
            "grid": "detected downbeats" if reliable else "two-second audio windows",
            "segments": segments, "semanticLabels": False}
