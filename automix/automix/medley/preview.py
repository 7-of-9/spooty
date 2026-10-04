"""Creation preview: render a handful of joins of an existing medley build with creation forms.

`python -m automix.medley.preview <reference medley .json> --joins 0-9 --out <mp3>` picks a
creation form per join (variety rule; every form at least once when `--cover`), renders each join
with ~16 s of A before and ~16 s of B after, verifies it (V1-V12 + the measured one-kit / one-bass
invariant from the stems) and retries another parameter seed, then another creation form, before
any slam. Writes the chaptered MP3, a .cue and a .txt with the per-join description and checks.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import time

import numpy as np

from . import CFG
from . import schema as S
from . import verify as VF
from .creation import CREATION, choose_form, creation_options, describe, stem_overlaps
from .forms import JoinCtx, _dL, PairCtx, exits_by_bar, stable_rng
from .planner import has_stems
from ..audio import FFMPEG, SR
from ..render import crop
from ..render import track_gain

DATA = "/Users/dom/src/spooty/data/automix"
FOLDER = "/Users/dom/Desktop/mp3_downloads/50"


class PreviewSession:
    """A read-only host over an existing build's plan (the build CLI's CliSession, without the
    re-plan)."""

    def __init__(self, ref_json: str, folder: str = FOLDER, data_dir: str = DATA, log=print):
        from ..audio import AudioCache
        from ..params import defaults
        from .build import load_tracks
        from .engine import WarpCache
        from .feats import FeatStore
        from .stems import StemStore
        with open(ref_json) as fh:
            self.report = json.load(fh)
        self.plan_doc = self.report["plan"]
        self.state = {"params": defaults()}
        self.tracks = load_tracks(folder, data_dir, log)
        self.by_id = {t["id"]: t for t in self.tracks}
        self.audio = AudioCache(size=8)
        self.mfeats = FeatStore(os.path.join(data_dir, "medley", "feats"), data_dir)
        self.stems = StemStore(os.path.join(data_dir, CFG["stems"]["dir"]))
        self.warp_cache = WarpCache(int(CFG["warp_cache_mb"]) << 20)
        self.store = VF.VerifyStore(os.path.join("/tmp", f"creation-preview-verify-{os.getpid()}.json"))

    @property
    def params(self):
        return self.state["params"]

    def plan(self):
        return self.plan_doc

    def order_tracks(self, plan: dict) -> list[dict]:
        ex = {e["track"]: e for e in plan["medley"]["excerpts"]}
        tgt = float(self.params["target_lufs"])
        return [dict(self.by_id[o["id"]], lufs=tgt - float(ex[o["id"]]["gain_db"])) for o in plan["order"]]

    def ctx(self, i: int) -> JoinCtx | None:
        plan = self.plan_doc
        tr = plan["transitions"][i]
        comp = tr["composition"]
        tracks = self.order_tracks(plan)
        ta, tb = tracks[i], tracks[i + 1]
        fa, fb = self.mfeats.get(ta), self.mfeats.get(tb)
        X, j = int(comp["a_ref"]["exit_bar"]), int(comp["b_ref"]["land_bar"])
        xs = exits_by_bar(fa)
        land = next((ld for ld in fb["landings"] if int(ld["bar"]) == j), None)
        if X not in xs or land is None:
            return None
        ex, ld_a = xs[X]
        sa, sb = has_stems(self.stems, ta, fa), has_stems(self.stems, tb, fb)
        pc = PairCtx(ta, tb, fa, fb, sa, sb, target_lufs=float(self.params["target_lufs"]))
        return JoinCtx(ta, tb, fa, fb, ex, land, idx=i, stems_a=sa, stems_b=sb, dL=_dL(pc, ex, ld_a, land))

    def bounds(self, i: int) -> tuple[float, float]:
        """R9 for join i inside the reference plan: A's region after the previous join's B and
        A's native solo; B's region before the next join's A."""
        from .planner import TrackInfo
        plan = self.plan_doc
        trs = plan["transitions"]
        tracks = self.order_tracks(plan)
        c = CFG

        def info(k):
            t = tracks[k]
            F = self.mfeats.get(t)
            return TrackInfo(t, F, {int(ld["bar"]): ld for ld in F["landings"]})
        lo = trs[i - 1]["b_in_end"] + info(i).need(int(trs[i - 1]["composition"]["b_ref"]["land_bar"]), c) \
            if i > 0 else -np.inf
        hi = trs[i + 1]["a_out_start"] - info(i + 1).need(int(trs[i]["composition"]["b_ref"]["land_bar"]), c) \
            if i + 1 < len(trs) else np.inf
        return lo, hi


def _plan_with(s: PreviewSession, i: int, comp: dict) -> dict:
    """The reference plan with join i's composition swapped in (geometry from the composition)."""
    from .build import _geo_fields
    plan = s.plan_doc
    tr = dict(plan["transitions"][i], composition=comp, form=comp["form"], variant=comp["variant"])
    tracks = s.order_tracks(plan)
    geo = _geo_fields(comp, s.mfeats.get(tracks[i]), s.mfeats.get(tracks[i + 1]))
    if geo:
        tr.update(geo)
    p2 = dict(plan)
    p2["transitions"] = list(plan["transitions"])
    p2["transitions"][i] = tr
    return p2


REQUIRED = ("V1", "V3", "V4", "V6", "V7")


def render_check(s: PreviewSession, i: int, comp: dict, log=print) -> dict:
    """Render join i with comp, verify (Phase 1 hard set) and measure the stems invariant."""
    from .build import render_comp, verify_rendered
    plan = _plan_with(s, i, comp)
    r = render_comp(s, plan, i, comp)
    det: dict = {}
    ch = verify_rendered(s, plan, i, comp, r, hard=VF.HARD_PHASE1, detail=det)
    a, b = r["a"], r["b"]
    p = s.params
    ov = det.get("stem_overlaps")
    if ov is None:                    # a non-creation fallback: measure it the same way
        st_a = s.stems.bind(a["id"], a.get("path"), r["ya"])
        st_b = s.stems.bind(b["id"], b.get("path"), r["yb"])
        ov = stem_overlaps(r["prog"], r["ya"], r["yb"], track_gain(a, p), track_gain(b, p), st_a, st_b,
                           s.warp_cache)
    fails = [f for f in ch["fail"]]
    if not ov["kit_ok"] and "KIT" not in fails:
        fails.append("KIT")
    if not ov["bass_ok"] and "BASS" not in fails:
        fails.append("BASS")
    if abs(float(ch["land_err_ms"])) > 10.0 and "V1" not in fails:
        fails.append("V1")
    return {"comp": comp, "checks": ch, "detail": det, "overlaps": ov, "fail": fails, "r": r, "plan": plan}


def pick_forms(s: PreviewSession, joins: list[int], seed: int, cover: bool, log=print) -> dict[int, dict]:
    """Per join: {form: [comps]} options and the variety-rule choice; with cover, a forced
    assignment so every creation form appears at least once (most-constrained form first)."""
    opts = {}
    for i in joins:
        ctx = s.ctx(i)
        if ctx is None:
            opts[i] = {}
            continue
        opts[i] = creation_options(ctx)          # a preview: the neighbours' solos are not rendered
        log(f"  join {i}: {ctx.title('a')} -> {ctx.title('b')}: " +
            ", ".join(f"{f} x{len(v)}" for f, v in opts[i].items()))
    order: dict[int, str] = {}
    if cover:
        # backtracking: forms in join order, each form at least once, no repeat within the window
        w = int(CFG["creation"]["variety_window"])

        def solve(k: int, used: list[str]) -> list[str] | None:
            if k == len(joins):
                return used if set(CREATION) <= set(used) else None
            left = len(joins) - k
            missing = [f for f in CREATION if f not in used]
            if len(missing) > left:
                return None
            cands = [f for f in opts[joins[k]] if f not in used[-(w - 1):]]
            rng = stable_rng("cover", seed, k)
            rng.shuffle(cands)
            cands.sort(key=lambda f: (f in used, sum(f in opts[x] for x in joins)))
            for f in cands:
                got = solve(k + 1, used + [f])
                if got:
                    return got
            return None
        got = solve(0, [])
        if got:
            order = dict(zip(joins, got))
    if not order:
        recent, counts = [], {}
        for i in joins:
            f = choose_form(opts[i], recent, counts, stable_rng("pick", seed, i))
            if f:
                order[i] = f
                counts[f] = counts.get(f, 0) + 1
            recent.append(f or "-")
    return {"opts": opts, "order": order}


def ladder(s: PreviewSession, i: int, opts: dict[str, list[dict]], first: str, recent: list[str], log=print,
           ahead: list[str] = ()) -> dict:
    """Creation ladder: the chosen form's parameter seeds, then other creation forms (those the
    variety window allows first: not in the previous or the next planned window-1 joins), then
    the reference build's own composition (the old slam) as last resort."""
    w = int(CFG["creation"]["variety_window"])
    others = [f for f in opts if f != first]
    near = set(recent[-(w - 1):]) | set(ahead[: w - 1])
    others = [f for f in others if f not in near]     # the variety rule is hard
    tries = []
    for f in [first] + others:
        for comp in opts.get(f, []):
            res = render_check(s, i, comp, log)
            tries.append({"form": comp["form"], "variant": comp["variant"], "fail": res["fail"]})
            log(f"    {comp['form']} {comp['variant']}: {'PASS' if not res['fail'] else 'fail ' + ','.join(res['fail'])}"
                f"  land {res['checks']['land_err_ms']} ms, flams {res['checks']['flams']}, "
                f"kit {res['overlaps']['kit_overlap_beats']} b, bass {res['overlaps']['bass_overlap_beats']} b, "
                f"clicks {res['checks']['clicks']}, tp {res['checks']['tp_dbtp']}")
            if not res["fail"]:
                res["tries"] = tries
                return res
    comp = s.plan_doc["transitions"][i]["composition"]
    res = render_check(s, i, comp, log)
    tries.append({"form": comp["form"], "variant": comp["variant"], "fail": res["fail"]})
    res["tries"] = tries
    res["fallback"] = True
    return res


def _mmss(t: float) -> str:
    return f"{int(t // 60)}:{t - 60 * int(t // 60):04.1f}"


def write_preview(s: PreviewSession, results: list[tuple[int, dict]], mp3: str, pre_s: float = 16.0,
                  post_s: float = 16.0, log=print) -> list[dict]:
    """Each join: A native for pre_s before the region, the region, B native for post_s; chunks
    joined with 1 s equal-power crossfades of silence-free audio, true-peak limited, MP3 320k
    with chapters. Returns the chapter rows with output timestamps."""
    from .build import write_cue
    from ..render import XF
    from .dsp import tp_limiter
    p = s.params
    ceiling = float(p["ceiling_db"]) - float(CFG["loudness"]["mp3_headroom_db"])
    chunks, rows, t = [], [], 0.0
    gap_fade = int(0.75 * SR)
    for i, res in results:
        r, tr = res["r"], res["plan"]["transitions"][i]
        a, b = r["a"], r["b"]
        ga, gb = track_gain(a, p), track_gain(b, p)
        a0, b1 = float(tr["a_out_start"]), float(tr["b_in_end"])
        pre = crop(r["ya"], int(round((a0 - pre_s) * SR)), int(round(a0 * SR))) * np.float32(ga)
        post = crop(r["yb"], int(round(b1 * SR)), int(round((b1 + post_s) * SR))) * np.float32(gb)
        reg = np.asarray(r["out"], np.float32)
        # region seconds [-XF, T + XF]: overlap its edges with the native pre / post (as render_medley)
        ramp = np.linspace(0, 1, XF, dtype=np.float32)[:, None]
        body = np.concatenate([pre[:-XF], pre[-XF:] * (1 - ramp) + reg[:XF] * ramp, reg[XF:-XF],
                               reg[-XF:] * (1 - ramp) + post[:XF] * ramp, post[XF:]])
        fade = np.linspace(0, 1, gap_fade, dtype=np.float32)[:, None]
        body[:gap_fade] *= fade
        body[-gap_fade:] *= fade[::-1]
        body = tp_limiter(body, ceiling)
        T = float(tr["T"])
        land = pre_s + float(tr["T_overlap"])
        rows.append({"i": i, "start": t, "region": t + pre_s, "land": t + land, "end": t + len(body) / SR,
                     "T": T, "a": a, "b": b})
        chunks.append(body)
        chunks.append(np.zeros((int(0.6 * SR), 2), np.float32))
        t += len(body) / SR + 0.6
    y = np.concatenate(chunks)
    meta = mp3[:-4] + ".ffmeta"
    esc = lambda x: re.sub(r"([=;#\\\n])", r"\\\1", x)       # noqa: E731
    title = "Claude_Best · Medley creation preview"
    chapters = []
    with open(meta, "w") as fh:
        fh.write(f";FFMETADATA1\ntitle={esc(title)}\n")
        for k, row in enumerate(rows):
            res = dict(results)[row["i"]]
            name = (f"{k + 1:02d} join {row['i'] + 1} {res['comp']['form']}: {row['a'].get('title')} > "
                    f"{row['b'].get('title')}")
            end = rows[k + 1]["start"] if k + 1 < len(rows) else t
            chapters.append({"start": round(row["start"], 3), "end": round(end, 3),
                             "title": f"{res['comp']['form']} - join {row['i'] + 1} {row['a'].get('title')} > {row['b'].get('title')}"})
            fh.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(row['start'] * 1000)}\nEND={int(end * 1000)}\n"
                     f"title={esc(name)}\n")
    proc = subprocess.run([FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
                           "-i", "pipe:0", "-i", meta, "-map_metadata", "1", "-map_chapters", "1", "-map", "0:a",
                           "-codec:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", mp3],
                          input=y.astype(np.float32).tobytes())
    os.remove(meta)
    if proc.returncode:
        raise RuntimeError("ffmpeg failed")
    write_cue(mp3[:-4] + ".cue", mp3, title, chapters)
    return rows


def write_txt(path: str, rows: list[dict], results: dict[int, dict]) -> None:
    out = ["Claude_Best · Medley — CREATION preview (10 joins)", "",
           "Each chapter: ~16 s of A, the composed creation region, ~16 s of B. Times are in the preview MP3.",
           "Checks are measured on the rendered audio: landing = B's onset vs its downbeat; flams = onset",
           "flams (V3); kit / bass = beats where BOTH tracks' drum (bass) stems sound (re-rendered from the",
           "stems, each within 20 dB of its own peak level); clicks (V6); true peak after the limiter (V7).", ""]
    for k, row in enumerate(rows):
        res = results[row["i"]]
        comp, ch, ov = res["comp"], res["checks"], res["overlaps"]
        a, b = row["a"], row["b"]
        rel = comp["rel"]
        semis = next((c["pitch"]["semis"] for c in comp["clips"] if c.get("pitch")), 0)
        out.append(f"{k + 1:02d}. Join {row['i'] + 1}: {a.get('artist', '')} - {a.get('title')}  ->  "
                   f"{b.get('artist', '')} - {b.get('title')}")
        out.append(f"    form: {comp['form']} ({comp['variant']})" + ("   [FALLBACK: reference slam]" if res.get("fallback") else ""))
        out.append(f"    chapter {_mmss(row['start'])}  creation region {_mmss(row['region'])}  B lands {_mmss(row['land'])}"
                   f"  chapter end {_mmss(row['end'])}")
        out.append(f"    tempo: A {60 / comp['a_ref']['period_s'] / 1:.1f} -> B {60 / comp['b_ref']['period_s']:.1f} BPM "
                   f"({rel['kind']}, A stretched {rel['stretch_pct']:+.1f}%{', A at ' + format(rel['a_ratio'], 'g') + ':1' if rel['a_ratio'] != 1 else ''}); "
                   f"key: Camelot {a.get('camelot')} -> {b.get('camelot')}"
                   + (f", A's vocals/music/bass pitched {semis:+g} st" if semis else ", no pitch shift"))
        out.append("    what happens:")
        for d in describe(comp):
            out.append(f"      - {d}")
        out.append(f"    checks: {'PASS' if not res['fail'] else 'FAIL ' + ','.join(res['fail'])} | landing {ch['land_err_ms']} ms"
                   f" (Beat This {ch['bt_down_err_ms']} ms) | flams {ch['flams']} | kit overlap {ov['kit_overlap_beats']} beats"
                   f" | bass overlap {ov['bass_overlap_beats']} beats (V4 low-band {ch['dbl_bass_beats']}) | clicks {ch['clicks']}"
                   f" | true peak {ch['tp_dbtp']} dBTP | status {ch['status']}"
                   + (f" (warn: {','.join(res['detail'].get('warn', []))})" if res['detail'].get('warn') else ""))
        if len(res.get("tries", [])) > 1:
            out.append("    ladder: " + "; ".join(f"{t['form']} {t['variant']} {'ok' if not t['fail'] else 'x ' + ','.join(t['fail'])}"
                                                for t in res["tries"]))
        out.append("")
    with open(path, "w") as fh:
        fh.write("\n".join(out))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("--joins", default="0-9")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--cover", action="store_true")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args(argv)
    if "-" in a.joins and "," not in a.joins:
        lo, hi = (int(x) for x in a.joins.split("-"))
        joins = list(range(lo, hi + 1))
    else:
        joins = [int(x) for x in a.joins.split(",")]
    t0 = time.time()
    s = PreviewSession(a.ref)
    pk = pick_forms(s, joins, a.seed, a.cover)
    print("assignment:", pk["order"])
    if a.dry:
        return
    results, recent = {}, []
    for i in joins:
        f = pk["order"].get(i)
        print(f"join {i}: {f}")
        if f is None:
            continue
        ahead = [pk["order"].get(k, "-") for k in joins if k > i]
        results[i] = ladder(s, i, pk["opts"][i], f, recent, ahead=ahead)
        recent.append(results[i]["comp"]["form"])
    rows = write_preview(s, [(i, results[i]) for i in joins if i in results], a.out)
    write_txt(a.out[:-4] + ".txt", rows, results)
    print(f"wrote {a.out} in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
