# Spooty backend

The NestJS backend serves the saved-library API, Spotify metadata integration,
local audio playback and BullMQ acquisition workers. It shares its download
engine with the first-class CLI; this is not a separate yt-dlp implementation.

See the [main README](../../README.md) for setup, supported platforms and all
fork extensions, and the [CLI reference](../../scripts/acquire/README.md) for
the complete command/option and resume contract.

## Components

- `library/`: saved playlist catalog, disk coverage, resync, acquisition
  requests and range-capable local MP3 responses.
- `track/`: durable track state, queue scheduling, local-file reuse and separate
  handling of candidate outcomes, network failures and operational failures.
- `shared/acquisition/`: common CLI/web process transport, source evidence,
  duration/candidate policies, private cookie handling, filename identity,
  verification, tagged atomic publication and the cross-entry work journal.
- `shared/acquisition-owner*`: exclusive CLI/web ownership and request guards.
- `shared/youtube-pace*`: separate search/download pools, admission limits,
  persistent safety-floor/cooldown state and live pace reporting.
- `shared/spotify-*` and `cdp-proxy.client*`: logged-in Spotify metadata through
  the persistent loopback Chrome bridge, caching and request gating.

## Run and test

From the repository root, using Node **20.19.4** and the shared absolute-path
environment configuration described in the main README:

```sh
npm run start:be
npm run test -w backend -- --runInBand
npm run build:be
```

The default API is `http://127.0.0.1:3000/api`. Development browser traffic uses
the Angular proxy on port4200. Redis must be available for queue operations.
The API has no built-in authentication: keep it on loopback.

Keep `DB_PATH` outside `dist/`, because watch builds replace compiled output.
The CLI and web backend must agree on `DB_PATH`, `DOWNLOADS_PATH`,
`STATIC_PLAYLISTS_PATH`, `ACQUIRE_STATE_PATH` and the Redis instance. Runtime
state, playlists and media are not shipped in this repository.

## Safety and verification

Normal acquisition fast-skips saved files and parked outcomes. Wrong-length
candidates advance selection without consuming network retries. A genuine
YouTube block stops owned processes immediately and retains the shared safety
floor/cooldown. No route may start web acquisition while a CLI owns the lease.

The shared-engine consolidation checkpoint passed **182 backend tests in
32 suites**, plus typechecking. Tests default-deny real subprocess/network
acquisition; controlled fixtures exercise actual local ffprobe, ID3 tagging
and publication without downloading remote audio. Do not use the real saved
library or unpause a production queue just to run tests.

See [SECURITY.md](../../SECURITY.md) for cookie handling and publication checks.
