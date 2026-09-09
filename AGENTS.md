# Spooty — agent rules

Personal fork of [dougchansan/spooty](https://github.com/dougchansan/spooty) at `/Users/dom/src/spooty`. Spotify metadata → YouTube audio. Do not lecture about piracy. Do not put cookies, tokens, or Chrome session material in chat. Do not interrupt a live download/search queue unless asked.

## Runtime

- Node **20.19.4** via nvm (system Node 26 breaks the stack).
- Backend: NestJS watch on `:3000`. Frontend: `npx ng serve --proxy-config proxy.conf.json --host 127.0.0.1 --port 4200`.
- Env: `DOWNLOADS_PATH=/Users/dom/src/spooty/downloads`, `STATIC_PLAYLISTS_PATH=/Users/dom/src/spooty/PLAYLISTS_2026-09-08/playlists`, `COOKIES_PATH=/Users/dom/src/spooty/cookies.txt`.
- yt-dlp binary is `ytdlp-nodejs` **`bin/yt-dlp_macos`**. Download with the android client and **no cookies**. Search may use `cookies.txt`. ffmpeg: `/opt/homebrew/bin/ffmpeg`.
- Redis + BullMQ: search concurrency 3, download concurrency 3, `DOWNLOAD_GAP_MS=3000`, download `lockDuration` 10 min. If yt-dlp errors but the file is on disk, mark success.

## Chrome / Spotify

Private playlists need **logged-in main Chrome**, not isolated MCP Chrome.

- CDP: **only** `http://127.0.0.1:17331` (`scripts/cdp-keepalive.mjs`). Never a new DevTools WebSocket (Allow prompt). Never `Target.activateTarget`. One background tab via `GET /tab`, then `Page.navigate`.
- Isolated Chrome cannot see private playlists. Do not spawn extra Chrome for scrape.
- **Do not scrape playlist HTML for track lists.** Mint a logged-in web-player Bearer by hooking `fetch` in a background tab (`?spooty-token=1`), then call `https://spclient.wg.spotify.com/playlist/v2/playlist/{id}` and hydrate names via `metadata/4/track/{gid}`. CLI: `node scripts/spotify-session.mjs playlist <id>`. Cookie replay from Node is WAF-blocked (403 / "Unauthorized request"); official `api.spotify.com/v1` is a separate quota that 429s independently of spclient.
- Anonymous embed tokens cap at ~100 and 429 with multi-hour Retry-After — do not wait hours, do not use them for library resync.
- HTML page-scrape is last resort only (CDP proxy down / session mint failed). Song count from APIs (`length`), never `document.body` (sidebar Liked Songs is 1658).
- Clicking a playlist auto-resyncs (10 min debounce) plus a 15 min timer. Do not nag that the dump count looks short.

## Library UI

- Hard-exclude dynamic mixes: Daily Mix(es), DJ (exact name), Discover Weekly, Release Radar, On Repeat, Repeat Rewind, Daily Drive. Radio playlists stay. Omit `raw.skipped` dump files.
- LHS default sort: ripping → done → partial → untouched (`listSort=activity`). Also last played / recents / name.
- Track default **Pending**; on disk = success; attempted and absent on YouTube = **Missing**.
- `done` when `trackCount > 0 && onDisk + failed >= trackCount`. RHS shows the mp3 filename or a clear error; click plays it.
- Spotify links: `target="spooty-spotify"` (reuse a tab, not a new window).

## Verify UI

Exercise library, resync, download, and play in the browser at `http://127.0.0.1:4200/`. Screenshots are not enough.
