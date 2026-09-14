#!/usr/bin/env python3
"""Scrape every Spotify library playlist via the kept-alive Chrome CDP
session, in Recents (last-accessed) order. Track lists come from the
Web API with aggressive 429 backoff. Never opens a new Chrome connection.
"""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "http://127.0.0.1:17331"
ROOT = Path("/Users/dom/src/spooty")
TODAY = date.today().isoformat()
OUT = ROOT / f"PLAYLISTS_{TODAY}"
TOKEN_PATH = ROOT / ".spotify_token"
TARGET_FILE = Path("/tmp/spooty-lib-target.txt")
MIN_GAP_S = 3.0
MIN_BACKOFF_S = 60.0
MAX_BACKOFF_S = 15 * 60
CTX = ssl.create_default_context()


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def http_json(url: str, data: dict | None = None, timeout: int = 45):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ev(target: str, expression: str):
    try:
        d = http_json(f"{BASE}/eval", {"targetId": target, "expression": expression})
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode("utf-8", "replace")[:500]) from e
    if "error" in d and "value" not in d:
        raise RuntimeError(d)
    return d.get("value")


def pick_target() -> str:
    pages = http_json(f"{BASE}/targets")["pages"]
    sp = [p for p in pages if "open.spotify.com" in (p.get("url") or "")]
    if not sp:
        raise SystemExit("No Spotify tab on the kept-alive Chrome session")
    chosen = sp[-1]
    TARGET_FILE.write_text(chosen["targetId"])
    return chosen["targetId"]


COLLECT_JS = r"""
(() => {
  function prim(v) {
    if (v == null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (typeof v === 'object') {
      if (typeof v.toISOString === 'function') {
        try { return v.toISOString(); } catch (e) {}
      }
      if (typeof v.seconds === 'number') return v.seconds;
      if (typeof v.low === 'number') return v.low;
    }
    try {
      const s = String(v);
      return s === '[object Object]' ? null : s;
    } catch (e) {
      return null;
    }
  }
  function fiberInfo(el) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    if (!key) return null;
    let fiber = el[key];
    for (let i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (!props || typeof props !== 'object') continue;
      const uri = props.uri || (props.item && props.item.uri);
      if (typeof uri === 'string' && uri.startsWith('spotify:')) {
        return {
          uri,
          name: prim(props.name || (props.item && props.item.name)),
          subtitle: prim(typeof props.subtitle === 'string' ? props.subtitle : null),
          lastPlayedAt: prim(props.lastPlayedAt),
          addedAt: prim(props.addedAt),
          isActive: !!props.isActive,
        };
      }
    }
    return null;
  }
  const sidebar = document.querySelector('#Desktop_LeftSidebar_Id');
  const rows = [...sidebar.querySelectorAll('[role="row"]')].filter(r => (r.innerText || '').trim());
  const items = [];
  for (const r of rows) {
    const info = fiberInfo(r) || {};
    const lines = (r.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const rec = {
      uri: info.uri || null,
      name: info.name || (lines[0] || null),
      subtitle: info.subtitle || (lines[1] || null),
      lastPlayedAt: info.lastPlayedAt || null,
      addedAt: info.addedAt || null,
      isActive: !!info.isActive,
      rowIndex: Number(r.getAttribute('aria-rowindex') || 0),
      setSize: Number(r.getAttribute('aria-setsize') || 0),
      text: lines.join(' | '),
    };
    if (rec.name) items.push(rec);
  }
  const scroller = [...sidebar.querySelectorAll('*')].find(
    el => getComputedStyle(el).overflowY === 'scroll' && el.scrollHeight > el.clientHeight + 40
  );
  const before = scroller ? scroller.scrollTop : 0;
  if (scroller) scroller.scrollTop = Math.min(scroller.scrollTop + 520, scroller.scrollHeight);
  return {
    items,
    scrollTop: scroller ? scroller.scrollTop : null,
    scrollH: scroller ? scroller.scrollHeight : null,
    clientH: scroller ? scroller.clientHeight : null,
    moved: scroller ? scroller.scrollTop !== before : false,
  };
})()
"""

CLICK_PLAYLISTS_JS = r"""
(() => {
  const chips = [...document.querySelectorAll('#Desktop_LeftSidebar_Id button, #Desktop_LeftSidebar_Id [role="checkbox"], #Desktop_LeftSidebar_Id [role="tab"]')];
  let playlists = chips.find(b => (b.innerText || '').trim() === 'Playlists');
  if (!playlists) {
    playlists = [...document.querySelectorAll('#Desktop_LeftSidebar_Id span, #Desktop_LeftSidebar_Id div, #Desktop_LeftSidebar_Id a')]
      .find(el => (el.innerText || '').trim() === 'Playlists' && (el.innerText || '').trim().length < 12);
  }
  const already = playlists && (
    playlists.getAttribute('aria-pressed') === 'true' ||
    playlists.getAttribute('aria-checked') === 'true' ||
    playlists.getAttribute('aria-selected') === 'true'
  );
  if (playlists && !already) playlists.click();
  const scroller = [...document.querySelectorAll('#Desktop_LeftSidebar_Id *')].find(
    el => getComputedStyle(el).overflowY === 'scroll' && el.scrollHeight > el.clientHeight + 40
  );
  if (scroller) scroller.scrollTop = 0;
  return {
    clickedPlaylists: !!(playlists && !already),
    alreadyPlaylists: !!already,
    chipTexts: chips.map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 12),
  };
})()
"""


def classify(uri: str | None, name: str, subtitle: str | None) -> str:
    u = uri or ""
    if u.startswith("spotify:playlist:"):
        return "playlist"
    if "collection:tracks" in u or name == "Liked Songs":
        return "liked_songs"
    if u.startswith("spotify:album:"):
        return "album"
    if u.startswith("spotify:artist:"):
        return "artist"
    if "station" in u or "radio" in u.lower() or (name or "").endswith(" Radio"):
        return "radio"
    if "daily mix" in (name or "").lower() or (subtitle or "").startswith("Made for"):
        if u.startswith("spotify:playlist:"):
            return "playlist"
        return "mix"
    if u.startswith("spotify:collection:"):
        return "collection"
    return "other"


def collect_library(target: str) -> list[dict]:
    log("activating Spotify tab so the Recents list virtualizes")
    http_json(f"{BASE}/cdp", {"method": "Target.activateTarget", "params": {"targetId": target}})
    time.sleep(1.0)
    vis = ev(target, "document.visibilityState")
    log(f"visibility={vis}")
    ev(
        target,
        """(() => {
      const sidebar = document.querySelector('#Desktop_LeftSidebar_Id');
      const scroller = [...sidebar.querySelectorAll('*')].find(
        el => getComputedStyle(el).overflowY === 'scroll' && el.scrollHeight > el.clientHeight + 20
      );
      if (scroller) scroller.scrollTop = 0;
      return true;
    })()""",
    )
    time.sleep(0.8)
    seen: dict[str, dict] = {}
    stagnant = 0
    last_max_row = -1
    for i in range(500):
        batch = ev(target, COLLECT_JS)
        added = 0
        max_row = last_max_row
        for it in batch.get("items") or []:
            key = it.get("uri") or f"{it.get('rowIndex')}|{it.get('name')}"
            if key not in seen:
                seen[key] = it
                added += 1
            if it.get("rowIndex"):
                max_row = max(max_row, it["rowIndex"])
        st, sh = batch.get("scrollTop"), batch.get("scrollH")
        set_size = None
        if batch.get("items"):
            set_size = batch["items"][0].get("setSize")
        log(
            f"lib scroll {i+1}: added={added} total={len(seen)} "
            f"rows~{max_row}/{set_size} scroll={st}/{sh}"
        )
        at_end = (
            st is not None
            and sh is not None
            and st + (batch.get("clientH") or 0) >= sh - 20
        )
        if set_size and len(seen) >= set_size:
            break
        if added == 0 and (at_end or max_row == last_max_row):
            stagnant += 1
        else:
            stagnant = 0
        last_max_row = max_row
        if stagnant >= 10:
            break
        time.sleep(0.45)
    ordered = sorted(
        seen.values(),
        key=lambda x: (x.get("rowIndex") is None, x.get("rowIndex") or 10**9),
    )
    for n, it in enumerate(ordered, 1):
        it["rank"] = n
        it["kind"] = classify(it.get("uri"), it.get("name") or "", it.get("subtitle"))
        if it.get("uri") and it["uri"].startswith("spotify:playlist:"):
            it["id"] = it["uri"].split(":")[-1]
        elif it["kind"] == "liked_songs":
            it["id"] = "liked_songs"
    return ordered


HOOK_JS = r"""
(function() {
  const steal = (v) => {
    if (typeof v === 'string' && /^Bearer\s+\S+/i.test(v)) {
      window.__SPOOTY_TOKEN = v.replace(/^Bearer\s+/i, '');
    }
  };
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      const h = init && init.headers;
      if (h) {
        if (h.Authorization) steal(h.Authorization);
        else if (h.authorization) steal(h.authorization);
        else if (typeof h.get === 'function') steal(h.get('Authorization') || h.get('authorization'));
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(k, v) {
    if (k && v && /^authorization$/i.test(k)) steal(v);
    return origSet.apply(this, arguments);
  };
})();
"""


def refresh_token(target: str) -> str:
    """Steal a fresh Bearer from the already-open Spotify tab. No new Chrome."""
    log("refreshing Spotify token from kept-alive tab")
    http_json(f"{BASE}/cdp", {"method": "Target.activateTarget", "params": {"targetId": target}})
    attached = http_json(
        f"{BASE}/cdp",
        {
            "method": "Target.attachToTarget",
            "params": {"targetId": target, "flatten": True},
        },
    )
    session_id = (attached.get("result") or {}).get("sessionId")
    if not session_id:
        raise RuntimeError(f"attach failed: {attached}")
    http_json(
        f"{BASE}/cdp",
        {"method": "Page.enable", "params": {}, "sessionId": session_id},
    )
    http_json(
        f"{BASE}/cdp",
        {
            "method": "Page.addScriptToEvaluateOnNewDocument",
            "params": {"source": HOOK_JS},
            "sessionId": session_id,
        },
    )
    http_json(
        f"{BASE}/cdp",
        {"method": "Page.reload", "params": {"ignoreCache": False}, "sessionId": session_id},
    )
    token = None
    for i in range(25):
        time.sleep(0.4)
        try:
            token = ev(target, "window.__SPOOTY_TOKEN || null")
        except Exception:
            token = None
        if token:
            break
    if not token:
        # last resort: any in-page token endpoint
        try:
            token = ev(
                target,
                """(async () => {
                  try {
                    const r = await fetch('https://open.spotify.com/api/token', {method:'POST', credentials:'include'});
                    const j = await r.json();
                    return j.accessToken || j.access_token || null;
                  } catch (e) { return null; }
                })()""",
            )
        except Exception:
            token = None
    if not token:
        raise RuntimeError("could not capture Spotify token from Chrome tab")
    TOKEN_PATH.write_text(token)
    os.chmod(TOKEN_PATH, 0o600)
    log(f"got fresh token ({len(token)} chars)")
    return token


def load_token() -> str:
    if TOKEN_PATH.exists():
        t = TOKEN_PATH.read_text().strip()
        if t:
            return t
    raise RuntimeError("missing .spotify_token")


def spotify_request(token: str, url: str, attempt: int = 0):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=45) as r:
            retry_after = r.headers.get("Retry-After")
            return r.status, json.load(r), retry_after
    except urllib.error.HTTPError as e:
        raw = e.read()
        retry_after = e.headers.get("Retry-After") if e.headers else None
        body = None
        try:
            body = json.loads(raw.decode("utf-8", "replace"))
        except Exception:
            body = {"raw": raw[:300].decode("utf-8", "replace")}
        return e.code, body, retry_after


def backoff_seconds(attempt: int, retry_after: str | None) -> float:
    ra = None
    if retry_after:
        try:
            ra = float(retry_after)
        except ValueError:
            ra = None
    exp = 60 * (2 ** min(max(attempt, 0), 4))
    delay = max(MIN_BACKOFF_S, ra or 0, exp)
    return min(MAX_BACKOFF_S, delay)


def fetch_paginated(token_box: dict, first_url: str, label: str, target: str) -> list:
    items = []
    url = first_url
    attempt = 0
    last_ok = 0.0
    auth_tries = 0
    while url:
        wait = MIN_GAP_S - (time.time() - last_ok)
        if wait > 0:
            time.sleep(wait)
        status, body, retry_after = spotify_request(token_box["token"], url)
        if status == 429:
            delay = backoff_seconds(attempt, retry_after)
            attempt += 1
            log(f"429 on {label} — backing off {delay:.0f}s (attempt {attempt})")
            time.sleep(delay)
            continue
        if status in (401, 403):
            auth_tries += 1
            log(f"{status} on {label} — refreshing token (try {auth_tries})")
            if auth_tries > 3:
                raise RuntimeError(f"auth {status}")
            token_box["token"] = refresh_token(target)
            time.sleep(2)
            continue
        if status != 200:
            delay = backoff_seconds(attempt, retry_after)
            attempt += 1
            log(f"HTTP {status} on {label} — wait {delay:.0f}s body={str(body)[:180]}")
            time.sleep(delay)
            if attempt > 8:
                break
            continue
        attempt = 0
        auth_tries = 0
        last_ok = time.time()
        chunk = body.get("items") or []
        items.extend(chunk)
        url = body.get("next")
        log(f"  {label}: +{len(chunk)} (total {len(items)}) next={'yes' if url else 'no'}")
    return items


def normalize_playlist_items(raw_items: list) -> list[dict]:
    out = []
    for i, it in enumerate(raw_items, 1):
        t = it.get("track") or it.get("item") or it
        if not t or t.get("type") == "episode":
            # liked songs use `track` nested; playlists too
            if "track" in it:
                t = it["track"]
            else:
                continue
        if not t or not t.get("name"):
            continue
        artists = ", ".join(a.get("name", "") for a in (t.get("artists") or []))
        album = (t.get("album") or {})
        images = album.get("images") or []
        out.append(
            {
                "n": i,
                "id": t.get("id"),
                "name": t.get("name"),
                "artist": artists,
                "album": album.get("name"),
                "uri": t.get("uri"),
                "coverUrl": images[0]["url"] if images else None,
                "addedAt": it.get("added_at"),
            }
        )
    return out


def fetch_tracks(token_box: dict, item: dict, target: str) -> list[dict]:
    kind = item.get("kind")
    if kind == "liked_songs":
        raw = fetch_paginated(
            token_box,
            "https://api.spotify.com/v1/me/tracks?limit=50",
            "Liked Songs",
            target,
        )
        return normalize_playlist_items(raw)
    pid = item.get("id")
    if not pid or kind != "playlist":
        return []
    raw = fetch_paginated(
        token_box,
        f"https://api.spotify.com/v1/playlists/{pid}/tracks?limit=100"
        "&fields=items(added_at,track(id,name,artists(name),album(name,images),uri,type)),next,total",
        item.get("name") or pid,
        target,
    )
    return normalize_playlist_items(raw)


def slug(name: str, rank: int) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "playlist").strip("_")
    s = (s[:60] or "playlist")
    return f"{rank:04d}_{s}"


def main() -> None:
    health = http_json(f"{BASE}/health")
    if not health.get("connected"):
        raise SystemExit("CDP keepalive is not connected — will not open a new Chrome session")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "playlists").mkdir(exist_ok=True)
    target = pick_target()
    log(f"using kept-alive target {target}")

    index_path = OUT / "index.json"
    progress_path = OUT / "progress.json"
    if index_path.exists():
        library = json.loads(index_path.read_text())
        log(f"resuming library index ({len(library)} items)")
    else:
        library = collect_library(target)
        index_path.write_text(json.dumps(library, indent=2))
        log(f"wrote {index_path} ({len(library)} items)")

    kinds = {}
    for it in library:
        kinds[it.get("kind")] = kinds.get(it.get("kind"), 0) + 1
    log(f"kinds: {kinds}")

    readme = OUT / "README.txt"
    readme.write_text(
        "\n".join(
            [
                f"Spotify library scrape {TODAY}",
                "Order: Spotify Your Library Recents (last accessed, descending).",
                "Filter applied: Playlists chip + Recents, then full Recents list as shown.",
                f"Items: {len(library)}",
                f"Kinds: {json.dumps(kinds)}",
                "Tracks fetched sequentially with 429 backoff. No parallel API calls.",
                "",
            ]
        )
    )

    # Playlists first (Recents order). Liked Songs is 1,658 tracks and
    # paginates heavily — do it last so 429s don't block the rest.
    playlists = [it for it in library if it.get("kind") == "playlist"]
    liked = [it for it in library if it.get("kind") == "liked_songs"]
    want = playlists + liked
    progress = {"done": [], "errors": []}
    if progress_path.exists():
        progress = json.loads(progress_path.read_text())
    done = set(progress.get("done") or [])

    token_box = {"token": refresh_token(target)}
    log(f"track fetch for {len(want)} playlists/liked (skip {len(done)} already done)")

    for it in want:
        key = it.get("uri") or it.get("id") or it.get("name")
        dest = OUT / "playlists" / f"{slug(it.get('name') or 'playlist', it.get('rank') or 0)}.json"
        if key in done and dest.exists():
            continue
        log(f"[{it.get('rank')}/{len(library)}] {it.get('kind')} {it.get('name')}")
        try:
            tracks = fetch_tracks(token_box, it, target)
            payload = {**it, "trackCount": len(tracks), "tracks": tracks, "scrapedAt": datetime.now(timezone.utc).isoformat()}
            dest.write_text(json.dumps(payload, indent=2))
            done.add(key)
            progress["done"] = list(done)
            progress_path.write_text(json.dumps(progress, indent=2))
            log(f"  saved {dest.name} ({len(tracks)} tracks)")
        except Exception as e:
            log(f"  ERROR {e}")
            progress.setdefault("errors", []).append({"item": it.get("name"), "error": str(e)})
            progress_path.write_text(json.dumps(progress, indent=2))
            if "auth" in str(e).lower():
                log("auth still failing after refresh — skipping this playlist")
                continue

    summary = {
        "date": TODAY,
        "libraryItems": len(library),
        "playlistsAttempted": len(want),
        "playlistsSaved": len(done),
        "kinds": kinds,
        "out": str(OUT),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    log(f"done: {summary}")


if __name__ == "__main__":
    main()
