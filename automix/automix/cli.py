"""automix CLI: analyse | plan | serve | render | medley (prep | build)."""

from __future__ import annotations

import argparse
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.environ.get("AUTOMIX_DATA", os.path.join(REPO, "data", "automix"))
CACHE = os.path.join(DATA, "analysis")


def _folder(p: str) -> str:
    p = os.path.abspath(os.path.expanduser(p))
    if not os.path.isdir(p):
        sys.exit(f"not a folder: {p}")
    return p


def cmd_analyze(args) -> None:
    from .analyze import analyze_folder
    tracks = analyze_folder(_folder(args.folder), CACHE)
    print(f"analysed {len(tracks)} tracks; cache {CACHE}")


def cmd_plan(args) -> None:
    from .session import Session
    s = Session(_folder(args.folder), DATA, CACHE)
    plan = s.plan()
    print(f"{'#':>3} {'tier':<5} {'energy':>6} {'bpm':>6} {'key':>4}  {'into next':<10} track")
    for i, t in enumerate(plan["order"]):
        tr = plan["transitions"][i] if i < len(plan["transitions"]) else None
        style = tr["style"] if tr else ""
        print(f"{i + 1:>3} {t['tier']:<5} {t['energy']:6.2f} {t['bpm']:6.1f} {t['camelot']:>4}  "
              f"{style:<10} {t['artist']} - {t['title']}")
    print(f"\n{len(plan['order'])} tracks, est. {plan['total_seconds'] / 60:.1f} min")


def cmd_serve(args) -> None:
    from .server import serve
    serve(_folder(args.folder), DATA, CACHE, args.host, args.port)


def cmd_render(args) -> None:
    from .session import Session
    s = Session(_folder(args.folder), DATA, CACHE)
    path = s.render_full(log=print)
    print(path)


def cmd_medley(args) -> None:
    from .medley import build
    if args.action == "prep":
        build.cli_prep(_folder(args.folder), DATA, log=print, rederive=args.rederive)
        return
    build.cli_build(_folder(args.folder), os.path.abspath(os.path.expanduser(args.out)), args.seed,
                    args.limit_joins, data_dir=DATA, strict=args.strict, no_verify=args.no_verify,
                    mix_check=not args.no_mix_check, log=print)


def main() -> None:
    ap = argparse.ArgumentParser(prog="automix")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("analyze", cmd_analyze), ("plan", cmd_plan), ("render", cmd_render)):
        p = sub.add_parser(name)
        p.add_argument("folder")
        p.set_defaults(fn=fn)
    p = sub.add_parser("serve")
    p.add_argument("folder")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=4300)
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser("medley", help="Claude_Best · Medley: features, then build + verify")
    msub = p.add_subparsers(dest="action", required=True)
    q = msub.add_parser("prep", help="compute the medley features cache (CPU, one track at a time)")
    q.add_argument("folder")
    q.add_argument("--rederive", action="store_true",
                   help="re-derive landings and stem features of every cached track (no audio analysis)")
    q = msub.add_parser("build", help="plan, render and verify every join, render the MP3 with chapters")
    q.add_argument("folder")
    q.add_argument("--out", required=True, help="output folder (MP3, .json report, .cue, verify.json)")
    q.add_argument("--seed", type=int, default=None)
    q.add_argument("--limit-joins", type=int, default=None, metavar="K", help="only the first K joins")
    q.add_argument("--strict", action="store_true", help="every §16 hard check fails a join (default: Phase 1 set)")
    q.add_argument("--no-verify", action="store_true", help="render only: no checks, no ladder")
    q.add_argument("--no-mix-check", action="store_true", help="skip V13 (Beat This on the whole mix)")
    p.set_defaults(fn=cmd_medley)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
