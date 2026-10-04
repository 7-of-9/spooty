"""Audio I/O and DSP helpers: ffmpeg decode/encode, Rubber Band time maps, filters, limiter."""

from __future__ import annotations

import os
import subprocess
import tempfile
from collections import OrderedDict
from threading import Lock

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

SR = 44100
FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
RUBBERBAND = os.environ.get("RUBBERBAND", "/opt/homebrew/bin/rubberband")


def decode(path: str, sr: int = SR) -> np.ndarray:
    """Decode any audio file to float32 stereo, shape (frames, 2)."""
    out = subprocess.run(
        [FFMPEG, "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0",
         "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(sr), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, 2).copy()


class AudioCache:
    """Small LRU of decoded tracks; a 4-minute track is ~85 MB as float32 stereo."""

    def __init__(self, size: int = 8):
        self.size = size
        self.items: OrderedDict[str, np.ndarray] = OrderedDict()
        self.lock = Lock()

    def get(self, path: str) -> np.ndarray:
        with self.lock:
            if path in self.items:
                self.items.move_to_end(path)
                return self.items[path]
        y = decode(path)
        with self.lock:
            self.items[path] = y
            while len(self.items) > self.size:
                self.items.popitem(last=False)
        return y


def write_wav(path: str, y: np.ndarray, sr: int = SR) -> None:
    sf.write(path, y, sr, subtype="PCM_16")


def encode_mp3(y: np.ndarray, out_path: str, sr: int = SR, bitrate: str = "320k",
               metadata: dict | None = None) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "in.wav")
        sf.write(wav, y, sr, subtype="FLOAT")
        cmd = [FFMPEG, "-v", "error", "-nostdin", "-y", "-i", wav]
        meta_file = None
        if metadata and metadata.get("chapters"):
            meta_file = os.path.join(tmp, "meta.txt")
            with open(meta_file, "w") as fh:
                fh.write(";FFMETADATA1\n")
                if metadata.get("title"):
                    fh.write(f"title={_ffmeta_escape(metadata['title'])}\n")
                for ch in metadata["chapters"]:
                    fh.write("[CHAPTER]\nTIMEBASE=1/1000\n")
                    fh.write(f"START={int(ch['start'] * 1000)}\nEND={int(ch['end'] * 1000)}\n")
                    fh.write(f"title={_ffmeta_escape(ch['title'])}\n")
            cmd += ["-i", meta_file, "-map_metadata", "1", "-map_chapters", "1", "-map", "0:a"]
        cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, "-id3v2_version", "3", out_path]
        subprocess.run(cmd, check=True, capture_output=True)


def _ffmeta_escape(s: str) -> str:
    for ch in "\\=;#\n":
        s = s.replace(ch, "\\" + ch)
    return s


def timemap_stretch(y: np.ndarray, src: list[float], dst: list[float], sr: int = SR) -> np.ndarray:
    """Stretch y so that source time src[k] (s) lands on output time dst[k] (s).

    src/dst must start at 0 and be strictly increasing; src[-1] should be the
    input length and dst[-1] the desired output length. Pitch is preserved.
    """
    n_out = int(round(dst[-1] * sr))
    if len(y) < 16 or n_out < 16:
        return np.zeros((max(n_out, 0), 2), dtype=np.float32)
    ratio = n_out / len(y)
    if all(abs((d - s) - 0) < 1e-4 for s, d in zip(src, dst)):
        return y.copy()
    with tempfile.TemporaryDirectory() as tmp:
        fin, fout, fmap = (os.path.join(tmp, n) for n in ("in.wav", "out.wav", "map.txt"))
        sf.write(fin, y, sr, subtype="FLOAT")
        with open(fmap, "w") as fh:
            last_s = -1
            for s, d in zip(src[1:-1], dst[1:-1]):
                fs, fd = int(round(s * sr)), int(round(d * sr))
                if fs > last_s and 0 < fs < len(y):
                    fh.write(f"{fs} {fd}\n")
                    last_s = fs
        subprocess.run(
            [RUBBERBAND, "-q", "--timemap", fmap, "-t", f"{ratio:.9f}", fin, fout],
            check=True, capture_output=True,
        )
        out, _ = sf.read(fout, dtype="float32", always_2d=True)
    if out.shape[1] == 1:
        out = np.repeat(out, 2, axis=1)
    if len(out) >= n_out:
        return out[:n_out]
    return np.pad(out, ((0, n_out - len(out)), (0, 0)))


def pitch_map_shift(y: np.ndarray, knots: list, sr: int = SR, step_s: float = 0.02) -> np.ndarray:
    """Pitch-shift y (n, ch) by a piecewise-linear semitone curve over output = input time (R3:
    R2's real-time pitch map lands 1 st at 1.1 and 2 st at 2.5; no time map here, so no R3 drift);
    knots [[t_s, semis], ...] (held before the first and after the last). Rubber Band with
    --pitchmap (its real-time mode: the map cannot be combined with --timemap, so time maps run
    first). The output keeps len(y) samples, latency-compensated by the CLI."""
    n = len(y)
    if n < 1024:
        return y.copy()
    ts = np.asarray([k[0] for k in knots], float)
    vs = np.asarray([k[1] for k in knots], float)
    if np.all(np.abs(vs) < 1e-6):
        return y.copy()
    grid = np.arange(0.0, n / sr, step_s)
    st = np.interp(grid, ts, vs)
    keep = np.r_[True, np.abs(np.diff(st)) > 1e-4]
    with tempfile.TemporaryDirectory() as tmp:
        fin, fout, fmap = (os.path.join(tmp, x) for x in ("in.wav", "out.wav", "pitch.txt"))
        sf.write(fin, y, sr, subtype="FLOAT")
        with open(fmap, "w") as fh:
            for t, v in zip(grid[keep], st[keep]):
                fh.write(f"{int(round(t * sr))} {v:.5f}\n")
        subprocess.run([RUBBERBAND, "-q", "-3", "--pitchmap", fmap, "-p", "0", "-t", "1", fin, fout],
                       check=True, capture_output=True)
        out, _ = sf.read(fout, dtype="float32", always_2d=True)
    if out.shape[1] == 1 and y.ndim == 2 and y.shape[1] == 2:
        out = np.repeat(out, 2, axis=1)
    if len(out) >= n:
        return out[:n]
    return np.pad(out, ((0, n - len(out)), (0, 0)))


_sos_cache: dict[tuple, np.ndarray] = {}


def split_bands(y: np.ndarray, crossover_hz: float, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """Zero-phase low/high split; low + high reconstructs y exactly."""
    key = (round(crossover_hz), sr)
    if key not in _sos_cache:
        _sos_cache[key] = butter(2, crossover_hz, btype="low", fs=sr, output="sos")
    if len(y) < 64:
        return y * 0, y.copy()
    low = sosfiltfilt(_sos_cache[key], y, axis=0).astype(np.float32)
    return low, y - low


def highpass(y: np.ndarray, hz: float, sr: int = SR) -> np.ndarray:
    return split_bands(y, hz, sr)[1]


def echo_tail(y: np.ndarray, delay_s: float, feedback: float, tail_s: float, sr: int = SR) -> np.ndarray:
    """Feedback delay applied to y, returned with tail_s of extra output."""
    d = max(1, int(delay_s * sr))
    n = len(y) + int(tail_s * sr)
    out = np.zeros((n, 2), dtype=np.float32)
    out[: len(y)] = y
    # out[t] = x[t] + fb * out[t - d]; process in blocks of d for vectorisation
    for start in range(d, n, d):
        end = min(start + d, n)
        out[start:end] += feedback * out[start - d: end - d]
    return out


def fade_curve(n: int, kind: str = "equal_power", rising: bool = True,
               handover: float = 0.5) -> np.ndarray:
    """Fade over n samples. `handover` moves where a rising and a falling curve cross:
    0.5 = the middle; lower = the outgoing track drops and the incoming one arrives
    early and fast; higher = the outgoing track lingers and the incoming one comes in late.
    The rising and falling curves stay exact mirror images of each other."""
    t = np.linspace(0.0, 1.0, max(n, 1), dtype=np.float64)
    h = min(0.95, max(0.05, float(handover)))
    if abs(h - 0.5) > 1e-6:
        t = t ** (np.log(0.5) / np.log(h))      # warp so the crossover lands at t = h
    x = t if rising else 1.0 - t
    if kind == "linear":
        g = x
    elif kind == "s_curve":
        g = 0.5 - 0.5 * np.cos(np.pi * x)
    else:
        g = np.sin(0.5 * np.pi * x)
    return g.astype(np.float32)


def limiter(y: np.ndarray, ceiling_db: float = -1.0, release_s: float = 0.08, sr: int = SR) -> np.ndarray:
    """Block-based look-ahead peak limiter with exponential release."""
    from scipy.ndimage import minimum_filter1d
    ceiling = 10 ** (ceiling_db / 20)
    peak = np.max(np.abs(y), axis=1)
    if len(y) == 0 or peak.max() <= ceiling:
        return y
    blk = 64
    nb = -(-len(peak) // blk)
    padded = np.pad(peak, (0, nb * blk - len(peak)))
    need = np.minimum(1.0, ceiling / np.maximum(padded.reshape(nb, blk).max(axis=1), 1e-9))
    need = minimum_filter1d(need, size=2 * max(1, int(0.004 * sr / blk)) + 3)
    rel = 1 - np.exp(-blk / (release_s * sr))
    g = np.empty(nb)
    cur = 1.0
    for i, n in enumerate(need.tolist()):
        cur = cur + (1.0 - cur) * rel
        if n < cur:
            cur = n
        g[i] = cur
    centers = np.arange(nb) * blk + blk / 2
    gs = np.interp(np.arange(len(peak)), centers, g).astype(np.float32)
    return np.clip(y * gs[:, None], -ceiling, ceiling).astype(np.float32)
