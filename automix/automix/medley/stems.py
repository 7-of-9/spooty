"""Stem access for the medley (DESIGN §14 with AMENDMENTS 2).

Stems are produced offline by a separate demucs job, never here: `separate()` refuses. They live
at <root>/<mp3 stem>/{drums,bass,vocals,other}.flac (44.1 kHz, stereo, the length of the MP3),
optionally with meta.json {model, version, sr, offset_s, residual_db, created, accepted}. A track
has stems when all four files exist, unless a measured meta.json rejected it.

Alignment: `offset_s` > 0 means the stems lag the decoded mix (stem frame k + off holds mix frame
k). The measured offset of the demucs-mlx output is 0 samples (checked on real tracks); without
meta.json the store uses 0. `other` is derived at read time as mix - (drums + bass + vocals)
whenever the mix is supplied, so the four stems sum to the mix exactly before any warp; the
separation residual lands in `other`. Stems are read by frame range and never cached.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time

import numpy as np
import soundfile as sf

from ..audio import SR, decode
from . import CFG

_ST = CFG["stems"]
NAMES: tuple[str, ...] = tuple(_ST["names"])            # drums, bass, vocals, other
_SP = re.compile(r"\[sp-([A-Za-z0-9]{22})\]$")
_TTL_S = 5.0                                              # directory scan / version memo


def dir_name(path: str) -> str:
    """The stems folder name of an audio file: its basename without the extension."""
    return os.path.splitext(os.path.basename(path))[0]


def tid_of_dir(name: str, ext: str = ".mp3") -> str:
    """analyze.track_id() of the MP3 a stems folder was made from."""
    m = _SP.search(name)
    if m:
        return "spotify:" + m.group(1)
    return "file:" + hashlib.sha1((name + ext).encode()).hexdigest()[:16]


def separate(path: str, out_dir: str) -> None:
    """Never separates: stems come from the offline demucs pass (AMENDMENTS 2), and no MLX or
    Metal job may be started from the medley build."""
    raise RuntimeError("medley.stems.separate is disabled: stems are produced by the offline "
                       f"stems pass into {out_dir}; not separating {os.path.basename(path)}")


def _read(path: str, i0: int, i1: int, nframes: int) -> np.ndarray:
    """Frames [i0, i1) of an audio file as (n, 2) float32, zero-padded outside the file."""
    out = np.zeros((max(0, i1 - i0), 2), np.float32)
    a, b = max(i0, 0), min(i1, nframes)
    if b > a:
        y, _ = sf.read(path, start=a, stop=b, dtype="float32", always_2d=True)
        if y.shape[1] == 1:
            y = np.repeat(y, 2, axis=1)
        out[a - i0: a - i0 + len(y)] = y[:, :2]
    return out


def _crop(y: np.ndarray, i0: int, i1: int) -> np.ndarray:
    out = np.zeros((max(0, i1 - i0), 2), np.float32)
    a, b = max(i0, 0), min(i1, len(y))
    if b > a:
        out[a - i0: b - i0] = y[a:b]
    return out


def measure_offset(stem_dir: str, mix: np.ndarray, sr: int = SR, windows: int | None = None,
                   window_s: float | None = None, search_ms: float | None = None) -> dict:
    """Cross-correlate the raw stem sum (all four files) against the decoded mix over `windows`
    windows of `window_s` at 25..75 % of the track (±search_ms, parabolic sub-sample peak).
    Returns {offset_s, offsets_ms, spread_ms, residual_db, ok}: ok when the window offsets agree
    within offset_tol_ms and the raw residual (mix - aligned stem sum) is <= residual_db."""
    windows = int(windows or _ST["windows"])
    win = int(round((window_s or _ST["window_s"]) * sr))
    S = int(round((search_ms or _ST["search_ms"]) * sr / 1000))
    files = [os.path.join(stem_dir, n + _ST["ext"]) for n in NAMES]
    nfr = min(sf.info(f).frames for f in files)
    n = min(len(mix), nfr)
    win = min(win, max(1, n // (windows + 1)))
    starts = [int(n * (0.25 + 0.5 * k / max(1, windows - 1))) - win // 2 for k in range(windows)]
    offs, segs = [], []
    for c in starts:
        c = int(np.clip(c, S, max(S, n - win - S)))
        m = _crop(mix, c, c + win)
        s = sum(_read(f, c - S, c + win + S, nfr) for f in files)
        mm, sm = m.mean(axis=1).astype(float), s.mean(axis=1).astype(float)
        L = 1 << int(np.ceil(np.log2(len(mm) + len(sm))))
        # r[k] = sum_n mix[c + n] * stem[c - S + n + k]: the stem lags the mix by k - S samples
        r = np.fft.irfft(np.conj(np.fft.rfft(mm, L)) * np.fft.rfft(sm, L), L)[: 2 * S + 1]
        k = int(np.argmax(r))
        d = 0.0
        if 0 < k < 2 * S:
            den = r[k - 1] - 2 * r[k] + r[k + 1]
            d = 0.5 * (r[k - 1] - r[k + 1]) / den if den != 0 else 0.0
        offs.append(k - S + d)
        segs.append((c, m))
    off = float(np.median(offs))
    ki = int(round(off))
    num = den = 0.0
    for c, m in segs:
        s = sum(_read(f, c + ki, c + ki + win, nfr) for f in files)
        num += float(((m - s).astype(float) ** 2).sum())
        den += float((m.astype(float) ** 2).sum())
    resid = 10 * np.log10(max(num, 1e-30) / max(den, 1e-30))
    spread = (max(offs) - min(offs)) / sr * 1000
    return {"offset_s": off / sr, "offsets_ms": [o / sr * 1000 for o in offs], "spread_ms": spread,
            "residual_db": float(resid),
            "ok": bool(spread <= _ST["offset_tol_ms"] and resid <= _ST["residual_db"])}


class StemStore:
    """Read-only access to <root>/<mp3 stem>/<name>.flac (§14 interface)."""

    def __init__(self, root: str, sr: int = SR):
        self.root = root
        self.sr = sr
        self._lock = threading.Lock()
        self._scan_at = -1e9
        self._index: dict[str, str] = {}
        self._ver: tuple[float, str] | None = None
        self._info: dict[str, int] = {}
        self._measured: dict[str, float] = {}

    # ---- lookup
    def _scan(self) -> dict[str, str]:
        with self._lock:
            if time.monotonic() - self._scan_at > _TTL_S:
                idx = {}
                try:
                    names = sorted(os.listdir(self.root))
                except OSError:
                    names = []
                for name in names:
                    d = os.path.join(self.root, name)
                    if os.path.isdir(d):
                        idx[tid_of_dir(name)] = d
                self._index, self._scan_at = idx, time.monotonic()
            return self._index

    def dir_for(self, tid: str, path: str | None = None) -> str | None:
        if path:
            d = os.path.join(self.root, dir_name(path))
            return d if os.path.isdir(d) else None
        return self._scan().get(tid)

    def _files(self, d: str) -> list[str]:
        return [os.path.join(d, n + _ST["ext"]) for n in NAMES]

    def meta(self, d: str) -> dict | None:
        try:
            with open(os.path.join(d, "meta.json")) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def has(self, tid: str, path: str | None = None, duration_s: float | None = None) -> bool:
        """A usable stem set: all four files exist, are readable at the store's rate, have the
        SAME frame count (a truncated or half-written stem would otherwise put drums into
        "other" = mix - stems), match the mix length when `duration_s` is given, and no
        measured meta.json rejected them."""
        d = self.dir_for(tid, path)
        if not d:
            return False
        fs = self._files(d)
        if not all(os.path.isfile(f) for f in fs):
            return False
        try:
            n = {self._frames_of(f) for f in fs}
        except (OSError, RuntimeError, ValueError):
            return False
        if len(n) != 1:
            return False
        if duration_s is not None and abs(next(iter(n)) / self.sr - float(duration_s)) > float(_ST["len_tol_s"]):
            return False
        m = self.meta(d)
        return not (m and m.get("accepted") is False)

    def version(self) -> str:
        """sha1 of the sorted (tid, created) pairs of complete stem sets; `created` is
        meta.created, else the newest file mtime. Memoised for a few seconds."""
        with self._lock:
            if self._ver and time.monotonic() - self._ver[0] < _TTL_S:
                return self._ver[1]
        pairs = []
        for tid, d in self._scan().items():
            fs = self._files(d)
            try:
                mt = max(int(os.stat(f).st_mtime) for f in fs)
            except OSError:
                continue
            m = self.meta(d) or {}
            pairs.append((tid, str(m.get("created", mt))))
        v = hashlib.sha1(json.dumps(sorted(pairs)).encode()).hexdigest()[:16]
        with self._lock:
            self._ver = (time.monotonic(), v)
        return v

    def offset_s(self, tid: str, path: str | None = None) -> float:
        d = self.dir_for(tid, path)
        m = self.meta(d) if d else None
        if m and isinstance(m.get("offset_s"), (int, float)):
            return float(m["offset_s"])
        return self._measured.get(d or "", 0.0)

    def _frames_of(self, f: str) -> int:
        n = self._info.get(f)
        if n is None:
            info = sf.info(f)
            if info.samplerate != self.sr:
                raise ValueError(f"{f}: {info.samplerate} Hz, expected {self.sr}")
            n = self._info[f] = info.frames
        return n

    # ---- reading
    def frames(self, tid: str, path: str | None, i0: int, i1: int,
               names: tuple[str, ...] | list[str] = ("drums", "bass", "vocals")) -> dict[str, np.ndarray]:
        """Stem frames aligned to mix frames [i0, i1): {name: (n, 2) float32}, zero-padded."""
        d = self.dir_for(tid, path)
        if not d:
            raise FileNotFoundError(f"no stems for {tid}")
        off = int(round(self.offset_s(tid, path) * self.sr))
        out = {}
        for n in names:
            f = os.path.join(d, n + _ST["ext"])
            out[n] = _read(f, i0 + off, i1 + off, self._frames_of(f))
        return out

    def window(self, tid: str, path: str | None, s0: float, s1: float, names,
               mix: np.ndarray | None = None) -> dict[str, np.ndarray]:
        """{name: (n, 2) float32} over track seconds [s0, s1). With `mix` (the decoded track),
        "other" is mix - (drums + bass + vocals); without it, other.flac is read."""
        i0, i1 = int(round(s0 * self.sr)), int(round(s1 * self.sr))
        names = list(names)
        if "other" in names and mix is not None:
            base = self.frames(tid, path, i0, i1, ("drums", "bass", "vocals"))
            base["other"] = _crop(mix, i0, i1) - (base["drums"] + base["bass"] + base["vocals"])
            return {n: base[n] for n in names}
        return self.frames(tid, path, i0, i1, names)

    def bind(self, tid: str, path: str | None, mix: np.ndarray | None = None) -> "TrackStems":
        return TrackStems(self, tid, path, mix)

    # ---- offsets
    def check(self, tid: str, path: str, mix: np.ndarray | None = None, write: bool = False) -> dict:
        """Measure this track's offset and residual (decoding the MP3 unless `mix` is given) and
        remember the offset for this process. With write=True, record meta.json atomically."""
        d = self.dir_for(tid, path)
        if not d:
            raise FileNotFoundError(f"no stems for {tid}")
        res = measure_offset(d, decode(path, self.sr) if mix is None else mix, self.sr)
        self._measured[d] = res["offset_s"] if res["ok"] else 0.0
        if write:
            meta = {**(self.meta(d) or {}), "sr": self.sr, "offset_s": round(res["offset_s"], 7),
                    "residual_db": round(res["residual_db"], 2), "accepted": res["ok"],
                    "measured": time.strftime("%Y-%m-%dT%H:%M:%S")}
            meta.setdefault("created", int(max(os.stat(f).st_mtime for f in self._files(d))))
            tmp = os.path.join(d, "meta.json.tmp")
            with open(tmp, "w") as fh:
                json.dump(meta, fh, indent=1)
            os.replace(tmp, os.path.join(d, "meta.json"))
        return res


class TrackStems:
    """One track's stems bound to its decoded mix, for engine.render_program."""

    def __init__(self, store: StemStore, tid: str, path: str | None, mix: np.ndarray | None):
        self.store, self.tid, self.path, self.mix = store, tid, path, mix

    def frames(self, i0: int, i1: int, names=("drums", "bass", "vocals")) -> dict[str, np.ndarray]:
        return self.store.frames(self.tid, self.path, i0, i1, names)
