#!/usr/bin/env python3
"""Walk Recents playlists in the kept-alive Spotify tab and scrape tracks
from the DOM. Does not call api.spotify.com.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "http://127.0.0.1:17331"
ROOT = Path("/Users/dom/src/spooty")
OUT = ROOT / "PLAYLISTS_2026-09-08"
INDEX = json.loads((OUT / "index.json").read_text())
DEST = OUT / "playlists"
DEST.mkdir(parents=True, exist_ok=True)
PROGRESS = OUT / "dom_progress.json"
SKIP_URIS = {
    "spotify:playlist:37i9dQZF1EYkqdzj48dyYq",  # DJ — user skip
    "spotify:playlist:4pROFAqvhp7pdYUtWDKTmw",  # My Shazam Tracks — 0 tracks, was looping
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def post(path: str, body: dict | None = None, timeout: int = 45):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="GET" if data is None else "POST",
    )
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (500, 502, 503, 504) and i < 2:
                time.sleep(1.2 * (i + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            if i < 2:
                time.sleep(1.2 * (i + 1))
                continue
            raise
    raise last


def cdp(method: str, params: dict | None = None, session_id: str | None = None):
    body = {"method": method, "params": params or {}}
    if session_id:
        body["sessionId"] = session_id
    return post("/cdp", body)


def attach(target: str) -> str:
    att = cdp("Target.attachToTarget", {"targetId": target, "flatten": True})
    sid = (att.get("result") or {}).get("sessionId")
    if not sid:
        raise RuntimeError(f"attach failed: {att}")
    cdp("Runtime.enable", {}, sid)
    cdp("Page.enable", {}, sid)
    return sid


def make_worker() -> str:
    created = cdp(
        "Target.createTarget",
        {
            "url": "https://open.spotify.com/",
            "background": True,
        },
    )
    tid = (created.get("result") or {}).get("targetId")
    if not tid:
        raise RuntimeError(f"createTarget failed: {created}")
    time.sleep(1.5)
    attach(tid)
    return tid


def ev(target: str, expr: str):
    """Always re-attach. SPA navigations kill the previous CDP session."""
    attached = post(
        "/cdp",
        {
            "method": "Target.attachToTarget",
            "params": {"targetId": target, "flatten": True},
        },
    )
    sid = (attached.get("result") or {}).get("sessionId")
    if not sid:
        raise RuntimeError(f"attach failed: {attached}")
    post("/cdp", {"method": "Runtime.enable", "params": {}, "sessionId": sid})
    msg = post(
        "/cdp",
        {
            "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": True,
            },
            "sessionId": sid,
        },
    )
    result = (msg.get("result") or {}).get("result") or {}
    if (msg.get("result") or {}).get("exceptionDetails"):
        raise RuntimeError((msg["result"]["exceptionDetails"]).get("text"))
    return result.get("value")


def slug(name: str, rank: int) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "playlist").strip("_")[:60] or "playlist"
    return f"{rank:04d}_{s}"


def scrape_open_playlist(target: str) -> dict:
    ev(
        target,
        """(() => {
      const child = document.querySelector('.main-view-container__scroll-node-child');
      const scroller = child && child.parentElement;
      if (scroller) scroller.scrollTop = 0;
      return true;
    })()""",
    )
    time.sleep(0.4)
    header = ev(
        target,
        r"""(() => {
      const page = document.querySelector('[data-testid="playlist-page"]');
      const h1 = document.querySelector('[data-testid="playlist-page"] [data-testid="entityTitle"], [data-testid="playlist-page"] h1');
      const m = page && page.innerText.match(/(\d[\d,]*)\s+songs?/i);
      return {
        title: h1 ? h1.innerText.trim() : document.title,
        href: location.href,
        songHint: m ? Number(m[1].replace(/,/g,'')) : null,
      };
    })()""",
    )
    seen = {}
    stagnant = 0
    for _ in range(100):
        batch = ev(
            target,
            """(() => {
          const rows = [...document.querySelectorAll('[data-testid="playlist-tracklist"] [data-testid="tracklist-row"]')];
          const items = rows.map(row => {
            const titleEl = row.querySelector('a[data-testid="internal-track-link"], [data-testid="internal-track-link"]');
            const artists = [...row.querySelectorAll('a[href*="/artist/"]')].map(a => a.innerText.trim()).filter(Boolean);
            const href = titleEl && titleEl.href ? titleEl.href : '';
            const idm = href.match(/track\\/([A-Za-z0-9]+)/);
            return { name: titleEl ? titleEl.innerText.trim() : '', artist: artists.join(', '), href, id: idm ? idm[1] : null };
          }).filter(t => t.name && t.artist);
          const child = document.querySelector('.main-view-container__scroll-node-child');
          const scroller = child && child.parentElement;
          if (scroller) scroller.scrollTop += 650;
          const atEnd = scroller && (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8);
          return { items, atEnd, scrollTop: scroller && scroller.scrollTop, scrollH: scroller && scroller.scrollHeight };
        })()""",
        )
        added = 0
        for t in batch.get("items") or []:
            key = t["artist"] + "|||" + t["name"]
            if key not in seen:
                seen[key] = t
                added += 1
        if added == 0:
            stagnant += 1
        else:
            stagnant = 0
        if batch.get("atEnd") and stagnant >= 3:
            break
        if stagnant >= 8:
            break
        time.sleep(0.28)
    tracks = [{"n": i, **t} for i, t in enumerate(seen.values(), 1)]
    return {**header, "trackCount": len(tracks), "tracks": tracks}


def open_playlist(target: str, item: dict) -> bool:
    pid = item.get("id")
    uri = item.get("uri") or ""
    if not pid and uri.startswith("spotify:playlist:"):
        pid = uri.split(":")[-1]
    if not pid:
        return False
    url = f"https://open.spotify.com/playlist/{pid}"
    sid = attach(target)
    cdp("Page.navigate", {"url": url}, sid)
    for _ in range(25):
        time.sleep(0.45)
        info = ev(
            target,
            """(() => ({
          href: location.href,
          title: document.title,
          rows: document.querySelectorAll('[data-testid="tracklist-row"]').length
        }))()""",
        ) or {}
        href = info.get("href") or ""
        rows = info.get("rows") or 0
        if pid in href and rows:
            return True
        if pid in href and _ > 8:
            return True
    return False


def remaining(want) -> int:
    n = 0
    for it in want:
        if it.get("uri") in SKIP_URIS:
            continue
        dest = DEST / f"{slug(it.get('name') or 'playlist', it.get('rank') or 0)}.json"
        if not dest.exists():
            n += 1
            continue
        try:
            if (json.loads(dest.read_text()).get("trackCount") or 0) == 0:
                n += 1
        except Exception:
            n += 1
    return n


def write_status(want, done) -> None:
    left = remaining(want)
    status = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "playlists": len(want),
        "withTracks": len(want) - left,
        "remaining": left,
        "doneUris": len(done),
    }
    (OUT / "STATUS.json").write_text(json.dumps(status, indent=2))
    (OUT / "STATUS.txt").write_text(
        f"{status['updated']}\nwithTracks={status['withTracks']}/{status['playlists']} remaining={left}\n"
    )


def run_pass(target: str) -> str:
    progress = {"done": []}
    if PROGRESS.exists():
        progress = json.loads(PROGRESS.read_text())
    done = set(progress.get("done") or [])
    want = [it for it in INDEX if it.get("kind") == "playlist" and it.get("uri")]
    log(f"{len(want)} playlists, remaining={remaining(want)}")
    write_status(want, done)
    for it in want:
        uri = it["uri"]
        dest = DEST / f"{slug(it.get('name') or 'playlist', it.get('rank') or 0)}.json"
        if uri in SKIP_URIS:
            done.add(uri)
            continue
        if dest.exists():
            try:
                existing = json.loads(dest.read_text())
                if (existing.get("trackCount") or 0) > 0:
                    done.add(uri)
                    continue
            except Exception:
                pass
        log(f"[{it.get('rank')}] {it.get('name')}")
        try:
            if not open_playlist(target, it):
                log("  skip — navigation did not land on playlist")
                continue
            time.sleep(0.8)
            data = scrape_open_playlist(target)
            if data.get("href") and it.get("id") and it["id"] not in (data.get("href") or ""):
                log(f"  skip — still on {(data.get('href') or '')[-40:]}")
                continue
            payload = {
                **it,
                "href": data.get("href"),
                "trackCount": data.get("trackCount"),
                "tracks": data.get("tracks"),
                "source": "dom",
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
            }
            dest.write_text(json.dumps(payload, indent=2))
            if payload["trackCount"]:
                done.add(uri)
                progress["done"] = list(done)
                PROGRESS.write_text(json.dumps(progress))
            write_status(want, done)
            log(f"  saved {dest.name} ({payload['trackCount']} tracks)")
            time.sleep(0.8)
        except Exception as e:
            log(f"  ERROR {e}")
            write_status(want, done)
            raise
    return target


def main() -> None:
    want = [it for it in INDEX if it.get("kind") == "playlist" and it.get("uri")]
    target = None
    passes = 0
    while remaining(want) > 0:
        passes += 1
        try:
            health = json.load(urllib.request.urlopen(BASE + "/health", timeout=5))
            if not health.get("connected"):
                raise RuntimeError("cdp keepalive down")
            if target is None:
                target = make_worker()
                log(f"dom-scrape worker tab {target}")
            run_pass(target)
        except Exception as e:
            log(f"pass {passes} crashed: {e} — new worker in 15s")
            target = None
            time.sleep(15)
            continue
        left = remaining(want)
        log(f"pass {passes} done, remaining={left}")
        if left:
            time.sleep(20)
    log("all playlists have tracks")


if __name__ == "__main__":
    main()
