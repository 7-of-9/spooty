#!/usr/bin/env python3
"""Zero-shot LAION-CLAP (music checkpoint) scores for a folder of MP3s.

One JSON per track in OUT_DIR named <mp3 basename>.json; re-runs skip tracks
whose JSON already matches this checkpoint + schema. Meta files (prompt text
embeddings, failures) live in OUT_DIR/_meta/ so `OUT_DIR/*.json` is tracks only.

Audio: 3 x 10 s excerpts centred at 25/50/75 % of duration, decoded by ffmpeg to
48 kHz mono float32 (exactly 480000 samples, so CLAP does no random truncation).
Excerpt embeddings (already L2-normalised by CLAP) are averaged and re-normalised.
Score = cosine(audio, prompt). Per-group softmax uses the checkpoint's learned
audio logit scale (exp(logit_scale_a)) as inverse temperature.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get("SPOOTY_AUTOMIX_DATA", Path(__file__).resolve().parents[2] / "data" / "automix"))
os.environ.setdefault("HF_HOME", str(ROOT / "hf-cache"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("WANDB_DISABLED", "true")

import numpy as np  # noqa: E402
import torch  # noqa: E402

SCHEMA_VERSION = 1
CKPT_NAME = "music_audioset_epoch_15_esc_90.14.pt"
CKPT = ROOT / "models" / "clap" / CKPT_NAME
AMODEL, TMODEL = "HTSAT-base", "roberta"
SR = 48000
EXCERPT_S = 10.0
N_SAMPLES = int(SR * EXCERPT_S)  # 480000 == CLAP max_len
POSITIONS = (0.25, 0.50, 0.75)
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"

GROUPS = {
    "energy": [
        "high energy, intense, loud, fast, driving music",
        "medium energy, groovy, moderate music",
        "low energy, calm, slow, soft, mellow music",
        "ambient, still, atmospheric, meditative music",
    ],
    "aggression": [
        "aggressive heavy metal",
        "hard rock with distorted guitars",
        "gentle acoustic ballad",
        "slow soulful ballad",
    ],
    "genre": [
        "electronic dance music for a party",
        "pop music",
        "hip hop",
        "drum and bass",
        "house music",
        "rock music with electric guitars",
        "heavy metal",
        "blues rock guitar solo",
        "instrumental guitar rock",
        "ambient electronic music",
        "downtempo chillout",
        "jazz",
        "bossa nova",
        "soul ballad",
    ],
}
# Ordinal weights for a derived scalar (softmax-weighted); high=1 ... ambient=0.
ENERGY_WEIGHTS = [1.0, 2.0 / 3.0, 1.0 / 3.0, 0.0]


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def decode_excerpt(path: Path, start: float) -> np.ndarray:
    raw = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{EXCERPT_S:.3f}",
         "-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    if x.size < N_SAMPLES:
        x = np.pad(x, (0, N_SAMPLES - x.size))
    return x[:N_SAMPLES]


def softmax(v: np.ndarray, scale: float) -> np.ndarray:
    z = v * scale
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def load_model(threads: int):
    torch.set_num_threads(threads)
    import laion_clap
    model = laion_clap.CLAP_Module(enable_fusion=False, amodel=AMODEL, tmodel=TMODEL, device="cpu")
    model.load_ckpt(str(CKPT), verbose=False)
    model.eval()
    scale = float(model.model.logit_scale_a.exp().item())
    return model, scale


def embed_prompts(model):
    out = {}
    with torch.no_grad():
        for g, prompts in GROUPS.items():
            t = model.get_text_embedding(prompts)
            t = t / np.linalg.norm(t, axis=1, keepdims=True)
            out[g] = t.astype(np.float32)
    return out


def is_done(p: Path) -> bool:
    try:
        d = json.loads(p.read_text())
        return (d.get("schema_version") == SCHEMA_VERSION
                and d.get("model", {}).get("checkpoint") == CKPT_NAME
                and isinstance(d.get("embedding"), list) and len(d["embedding"]) > 0)
    except Exception:
        return False


def atomic_write(p: Path, obj) -> None:
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    os.replace(tmp, p)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", required=True)
    ap.add_argument("--out-dir", default=str(ROOT / "clap"))
    ap.add_argument("--only", action="append", default=[],
                    help="case-insensitive substring filter on basename (repeatable, OR)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    in_dir, out_dir = Path(args.in_dir), Path(args.out_dir)
    meta_dir = out_dir / "_meta"
    meta_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in in_dir.iterdir() if p.suffix.lower() == ".mp3" and not p.name.startswith("."))
    if args.only:
        subs = [s.lower() for s in args.only]
        files = [p for p in files if any(s in p.name.lower() for s in subs)]
    todo = [p for p in files if args.force or not is_done(out_dir / (p.stem + ".json"))]
    print(f"{len(files)} selected, {len(files) - len(todo)} cached, {len(todo)} to do", flush=True)
    if not todo:
        return 0

    t0 = time.perf_counter()
    model, scale = load_model(args.threads)
    text = embed_prompts(model)
    load_s = time.perf_counter() - t0
    print(f"model loaded in {load_s:.1f}s; logit_scale={scale:.3f}; torch threads={torch.get_num_threads()}", flush=True)

    model_info = {"package": "laion_clap", "checkpoint": CKPT_NAME, "amodel": AMODEL,
                  "tmodel": TMODEL, "enable_fusion": False, "device": "cpu",
                  "logit_scale": scale, "embed_dim": int(next(iter(text.values())).shape[1])}
    atomic_write(meta_dir / "prompts.json", {
        "schema_version": SCHEMA_VERSION, "model": model_info,
        "groups": {g: [{"prompt": pr, "embedding": [round(float(v), 7) for v in text[g][i]]}
                       for i, pr in enumerate(ps)] for g, ps in GROUPS.items()},
    })

    fail_path = meta_dir / "failures.json"
    failures = json.loads(fail_path.read_text()) if fail_path.exists() else {}

    for n, path in enumerate(todo, 1):
        out = out_dir / (path.stem + ".json")
        t_start = time.perf_counter()
        try:
            dur = probe_duration(path)
            starts = [min(max(0.0, p * dur - EXCERPT_S / 2), max(0.0, dur - EXCERPT_S)) for p in POSITIONS]
            t_dec = time.perf_counter()
            audio = np.stack([decode_excerpt(path, s) for s in starts])
            decode_s = time.perf_counter() - t_dec
            t_emb = time.perf_counter()
            with torch.no_grad():
                ex = model.get_audio_embedding_from_data(audio, use_tensor=False)  # (3, D)
            embed_s = time.perf_counter() - t_emb
            ex = ex / np.linalg.norm(ex, axis=1, keepdims=True)
            emb = ex.mean(axis=0)
            emb = emb / np.linalg.norm(emb)

            groups, per_excerpt = {}, {}
            for g, prompts in GROUPS.items():
                cos = text[g] @ emb
                sm = softmax(cos, scale)
                order = np.argsort(-cos)
                groups[g] = {
                    "top": prompts[int(order[0])],
                    "ranked": [prompts[int(i)] for i in order],
                    "cosine": {pr: round(float(cos[i]), 6) for i, pr in enumerate(prompts)},
                    "softmax": {pr: round(float(sm[i]), 6) for i, pr in enumerate(prompts)},
                }
                if g in ("energy", "aggression"):
                    ec = ex @ text[g].T  # (3, P)
                    per_excerpt[g] = [
                        {"position": POSITIONS[k], "top": prompts[int(np.argmax(ec[k]))],
                         "cosine": {pr: round(float(ec[k, i]), 6) for i, pr in enumerate(prompts)}}
                        for k in range(len(POSITIONS))]

            e_sm = np.array([groups["energy"]["softmax"][p] for p in GROUPS["energy"]])
            record = {
                "path": str(path),
                "basename": path.name,
                "schema_version": SCHEMA_VERSION,
                "model": model_info,
                "duration_s": round(dur, 3),
                "excerpts": [{"position": p, "start_s": round(s, 3), "length_s": EXCERPT_S}
                             for p, s in zip(POSITIONS, starts)],
                "groups": groups,
                "per_excerpt": per_excerpt,
                "derived": {
                    "energy_index": round(float(e_sm @ np.array(ENERGY_WEIGHTS)), 6),
                    "energy_index_note": "softmax-weighted energy prompts; high=1, medium=2/3, low=1/3, ambient=0",
                },
                "embedding": [round(float(v), 7) for v in emb],
                "timing_s": {"decode": round(decode_s, 3), "embed": round(embed_s, 3),
                             "total": round(time.perf_counter() - t_start, 3)},
                "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
            atomic_write(out, record)
            failures.pop(path.name, None)
            print(f"[{n}/{len(todo)}] {record['timing_s']['total']:.2f}s  "
                  f"E={groups['energy']['top'][:22]:<22} G={groups['genre']['top']:<34} {path.stem}", flush=True)
        except Exception as exc:  # keep going; record failure
            failures[path.name] = {"path": str(path), "error": f"{type(exc).__name__}: {exc}"[:500],
                                   "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
            print(f"[{n}/{len(todo)}] FAILED {path.name}: {exc}", file=sys.stderr, flush=True)
        atomic_write(fail_path, failures)

    print(f"done in {time.perf_counter() - t0:.1f}s; failures={len(failures)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
