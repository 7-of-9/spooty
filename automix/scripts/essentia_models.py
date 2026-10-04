#!/usr/bin/env python3
"""Essentia pre-trained model outputs (MTG, essentia.upf.edu/models) per MP3.

Runtime: essentia-tensorflow (bundled libtensorflow, CPU only; no Metal/MPS).
One JSON per track in OUT_DIR named <mp3 basename>.json; existing JSONs are
skipped so re-runs only process new tracks.

Usage:
  venv-essentia-models/bin/python essentia_models.py [--dir DIR] [--out OUT]
      [--only SUBSTR ...] [--force]
"""
import argparse
import glob
import json
import os
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np  # noqa: E402
import essentia  # noqa: E402
import essentia.standard as es  # noqa: E402

essentia.log.warningActive = False
essentia.log.infoActive = False

HERE = os.environ.get("SPOOTY_AUTOMIX_DATA", str(Path(__file__).resolve().parents[2] / "data" / "automix"))
MODELS = os.path.join(HERE, "models-essentia")
SR = 16000
SCHEMA_VERSION = 1

EFFNET = "discogs-effnet-bs64-1"
MUSICNN = "msd-musicnn-1"

# Heads on Discogs-EffNet embeddings (1280-d, PartitionedCall:1).
EFFNET_HEADS = {
    "mood_aggressive": "mood_aggressive-discogs-effnet-1",
    "mood_relaxed": "mood_relaxed-discogs-effnet-1",
    "mood_party": "mood_party-discogs-effnet-1",
    "mood_happy": "mood_happy-discogs-effnet-1",
    "mood_sad": "mood_sad-discogs-effnet-1",
    "mood_acoustic": "mood_acoustic-discogs-effnet-1",
    "mood_electronic": "mood_electronic-discogs-effnet-1",
    "danceability": "danceability-discogs-effnet-1",
    "approachability_2c": "approachability_2c-discogs-effnet-1",
    "approachability_regression": "approachability_regression-discogs-effnet-1",
    "engagement_2c": "engagement_2c-discogs-effnet-1",
    "engagement_regression": "engagement_regression-discogs-effnet-1",
    "genre_discogs400": "genre_discogs400-discogs-effnet-1",
    "mtg_jamendo_moodtheme": "mtg_jamendo_moodtheme-discogs-effnet-1",
}
# Arousal/valence regressors on MSD-MusiCNN embeddings (200-d, model/dense/BiasAdd).
MUSICNN_HEADS = {
    "deam": "deam-msd-musicnn-2",
    "emomusic": "emomusic-msd-musicnn-2",
    "muse": "muse-msd-musicnn-2",
}
# Positive class of each binary head (the class whose probability we report).
POSITIVE = {
    "mood_aggressive": "aggressive",
    "mood_relaxed": "relaxed",
    "mood_party": "party",
    "mood_happy": "happy",
    "mood_sad": "sad",
    "mood_acoustic": "acoustic",
    "mood_electronic": "electronic",
    "danceability": "danceable",
    "approachability_2c": "approachable",
    "engagement_2c": "engaging",
}
CURVE_BIN_S = 10.0


def meta(name):
    with open(os.path.join(MODELS, name + ".json")) as fh:
        return json.load(fh)


def io_nodes(m):
    """Input node and 'predictions' output node from the model metadata."""
    sch = m["schema"]
    inp = sch["inputs"][0]["name"]
    outs = [o for o in sch["outputs"] if o.get("output_purpose") == "predictions"]
    out = (outs[0] if outs else sch["outputs"][0])["name"]
    return inp, out


class Models:
    def __init__(self):
        self.meta = {}
        self.effnet = es.TensorflowPredictEffnetDiscogs(
            graphFilename=os.path.join(MODELS, EFFNET + ".pb"),
            output="PartitionedCall:1",
        )
        self.musicnn = es.TensorflowPredictMusiCNN(
            graphFilename=os.path.join(MODELS, MUSICNN + ".pb"),
            output="model/dense/BiasAdd",
        )
        self.heads = {}
        for key, name in list(EFFNET_HEADS.items()) + list(MUSICNN_HEADS.items()):
            m = meta(name)
            self.meta[key] = m
            inp, out = io_nodes(m)
            self.heads[key] = es.TensorflowPredict2D(
                graphFilename=os.path.join(MODELS, name + ".pb"), input=inp, output=out
            )
        self.meta[EFFNET] = meta(EFFNET)
        self.meta[MUSICNN] = meta(MUSICNN)

    def classes(self, key):
        return self.meta[key]["classes"]


def bin_curve(series, hop_s, patch_s, duration, bin_s=CURVE_BIN_S):
    """Average per-patch values into fixed time bins using patch centres."""
    series = np.asarray(series, dtype=float)
    centres = np.arange(len(series)) * hop_s + patch_s / 2.0
    nbins = max(1, int(np.ceil(duration / bin_s)))
    out = []
    for b in range(nbins):
        sel = (centres >= b * bin_s) & (centres < (b + 1) * bin_s)
        out.append(round(float(series[sel].mean()), 4) if sel.any() else None)
    return out


def window_mean(series, hop_s, patch_s, lo, hi):
    series = np.asarray(series, dtype=float)
    centres = np.arange(len(series)) * hop_s + patch_s / 2.0
    sel = (centres >= lo) & (centres < hi)
    return round(float(series[sel].mean()), 4) if sel.any() else None


def spotify_id(basename):
    m = re.search(r"\[sp-([0-9A-Za-z]{22})\]", basename)
    return m.group(1) if m else None


def analyse(models, path):
    t0 = time.time()
    audio = es.MonoLoader(filename=path, sampleRate=SR, resampleQuality=4)()
    duration = len(audio) / SR
    t_load = time.time() - t0

    t1 = time.time()
    emb = models.effnet(audio)  # (n_patches, 1280)
    t_effnet = time.time() - t1
    t2 = time.time()
    emb_mnn = models.musicnn(audio)  # (n_patches, 200)
    t_musicnn = time.time() - t2

    # Patch timing (Essentia defaults): effnet 128 frames hop 62, musicnn 187 hop 93, frame hop 256 @16k.
    fr = 256.0 / SR
    eff_patch_s, eff_hop_s = 128 * fr, 62 * fr
    mnn_patch_s, mnn_hop_s = 187 * fr, 93 * fr

    t3 = time.time()
    per_patch = {}
    for key in EFFNET_HEADS:
        per_patch[key] = np.asarray(models.heads[key](emb))
    for key in MUSICNN_HEADS:
        per_patch[key] = np.asarray(models.heads[key](emb_mnn))
    t_heads = time.time() - t3

    rec = {
        "schema_version": SCHEMA_VERSION,
        "path": os.path.abspath(path),
        "basename": os.path.basename(path),
        "spotify_id": spotify_id(os.path.basename(path)),
        "duration_s": round(duration, 3),
        "n_patches": {"effnet": int(emb.shape[0]), "musicnn": int(emb_mnn.shape[0])},
    }

    # Binary heads: mean-over-patches softmax, both classes kept in "classes".
    probs = {}
    classes_full = {}
    curve_src = {}
    for key, pos in POSITIVE.items():
        cls = models.classes(key)
        p = per_patch[key]
        mean = p.mean(axis=0)
        classes_full[key] = {c: round(float(v), 4) for c, v in zip(cls, mean)}
        idx = cls.index(pos)
        probs[key] = round(float(mean[idx]), 4)
        curve_src[key] = p[:, idx]

    rec["mood"] = {k.split("_", 1)[1]: probs[k] for k in probs if k.startswith("mood_")}
    rec["danceability"] = probs["danceability"]
    rec["approachability"] = {
        "p_approachable_2c": probs["approachability_2c"],
        "regression": round(float(per_patch["approachability_regression"].mean()), 4),
    }
    rec["engagement"] = {
        "p_engaging_2c": probs["engagement_2c"],
        "regression": round(float(per_patch["engagement_regression"].mean()), 4),
    }
    rec["classes"] = classes_full

    # Arousal / valence regressors. Metadata classes are ["valence", "arousal"].
    av = {}
    for key in MUSICNN_HEADS:
        cls = models.classes(key)
        p = per_patch[key]
        mean = p.mean(axis=0)
        d = {c: round(float(v), 4) for c, v in zip(cls, mean)}
        d["arousal_std_over_patches"] = round(float(p[:, cls.index("arousal")].std()), 4)
        av[key] = d
        curve_src["arousal_" + key] = p[:, cls.index("arousal")]
        curve_src["valence_" + key] = p[:, cls.index("valence")]
    av["scale"] = (
        "raw, unclipped regressor outputs trained on each dataset's annotation scale "
        "(DEAM and emoMusic: 1..9; MuSe: Warriner-lexicon 1..9). Higher = more aroused / more positive. "
        "Values cluster mid-scale; compare tracks relatively, not against absolute thresholds."
    )
    rec["arousal_valence"] = av

    # Discogs 400 styles.
    g = per_patch["genre_discogs400"].mean(axis=0)
    gcls = models.classes("genre_discogs400")
    top = np.argsort(-g)[:5]
    rec["genre_discogs400_top5"] = [{"style": gcls[i], "prob": round(float(g[i]), 4)} for i in top]

    # MTG-Jamendo mood/theme (56 multi-label sigmoid tags).
    mt = per_patch["mtg_jamendo_moodtheme"].mean(axis=0)
    mtcls = models.classes("mtg_jamendo_moodtheme")
    rec["moodtheme_top5"] = [
        {"tag": mtcls[i], "prob": round(float(mt[i]), 4)} for i in np.argsort(-mt)[:5]
    ]
    rec["moodtheme"] = {c: round(float(v), 4) for c, v in zip(mtcls, mt)}
    curve_src["moodtheme_energetic"] = per_patch["mtg_jamendo_moodtheme"][:, mtcls.index("energetic")]

    # Time structure: intro/outro means and 10 s curves for mix-transition use.
    edges = {}
    curves = {}
    for key, series in curve_src.items():
        is_mnn = key.startswith("arousal_") or key.startswith("valence_")
        if key.startswith("valence_") and key != "valence_deam":
            continue
        if key.startswith("arousal_") and key not in ("arousal_deam", "arousal_emomusic"):
            continue
        if key in ("approachability_2c", "engagement_2c", "mood_acoustic", "mood_electronic"):
            continue
        hop, patch = (mnn_hop_s, mnn_patch_s) if is_mnn else (eff_hop_s, eff_patch_s)
        edges[key] = {
            "first30s": window_mean(series, hop, patch, 0, 30),
            "last30s": window_mean(series, hop, patch, duration - 30, duration + 1),
        }
        curves[key] = bin_curve(series, hop, patch, duration)
    rec["edges"] = edges
    rec["curves_10s"] = {"bin_s": CURVE_BIN_S, **curves}

    rec["timing_s"] = {
        "load": round(t_load, 3),
        "effnet": round(t_effnet, 3),
        "musicnn": round(t_musicnn, 3),
        "heads": round(t_heads, 3),
        "total": round(time.time() - t0, 3),
    }
    rec["runtime"] = {
        "backend": "essentia-tensorflow (libtensorflow CPU)",
        "essentia": essentia.__version__,
        "sample_rate": SR,
        "embedding_models": {"effnet": EFFNET, "musicnn": MUSICNN},
        "heads": {**EFFNET_HEADS, **MUSICNN_HEADS},
        "aggregation": "mean over patches (effnet ~2.05 s patches hop ~0.99 s; musicnn ~2.99 s hop ~1.49 s)",
    }
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", default=os.path.join(HERE, "moods"))
    ap.add_argument("--only", nargs="*", default=None, help="substring filters on basename")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    files = sorted(glob.glob(os.path.join(args.dir, "*.mp3")))
    if args.only:
        files = [f for f in files if any(s.lower() in os.path.basename(f).lower() for s in args.only)]

    todo = []
    for f in files:
        outp = os.path.join(args.out, os.path.splitext(os.path.basename(f))[0] + ".json")
        if args.force or not os.path.exists(outp):
            todo.append((f, outp))
    print(f"{len(files)} files, {len(files) - len(todo)} cached, {len(todo)} to do", flush=True)
    if not todo:
        return 0

    t0 = time.time()
    models = Models()
    print(f"models loaded in {time.time() - t0:.1f}s", flush=True)

    failed = []
    for i, (f, outp) in enumerate(todo, 1):
        name = os.path.basename(f)
        try:
            rec = analyse(models, f)
            tmp = outp + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(rec, fh, indent=1, ensure_ascii=False)
            os.replace(tmp, outp)
            t = rec["timing_s"]
            m = rec["mood"]
            print(
                f"[{i}/{len(todo)}] {t['total']:.1f}s (effnet {t['effnet']:.1f} mnn {t['musicnn']:.1f}) "
                f"dur {rec['duration_s']:.0f}s agg {m['aggressive']:.2f} rel {m['relaxed']:.2f} "
                f"party {m['party']:.2f} dance {rec['danceability']:.2f} "
                f"A {rec['arousal_valence']['deam']['arousal']:.2f} V {rec['arousal_valence']['deam']['valence']:.2f} "
                f"| {rec['genre_discogs400_top5'][0]['style']} | {name}",
                flush=True,
            )
        except Exception as e:  # keep going; report at end
            failed.append((name, repr(e)))
            print(f"[{i}/{len(todo)}] FAILED {name}: {e!r}", flush=True)
    print(f"done in {time.time() - t0:.1f}s; failed {len(failed)}", flush=True)
    for n, e in failed:
        print(f"  FAILED {n}: {e}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
