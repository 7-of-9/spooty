[![GitHub License](https://img.shields.io/github/license/dougchansan/spooty)](https://github.com/dougchansan/spooty/blob/main/LICENSE.md)
[![GitHub Repo stars](https://img.shields.io/github/stars/dougchansan/spooty)](https://github.com/dougchansan/spooty)
[![GitHub last commit](https://img.shields.io/github/last-commit/dougchansan/spooty)](https://github.com/dougchansan/spooty/commits/main)

![spooty logo](assets/logo.svg)
# Spooty - selfhosted Spotify downloader
Spooty is a self-hosted Spotify downloader.
It allows download track/playlist/album from the Spotify url.
It can also subscribe to a playlist or author page and download new songs upon release.
Spooty basically downloads nothing from Spotify, it only gets information from spotify and then finds relevant and downloadeds music on Youtube. 
The project is based on NestJS and Angular.

## CLI and website

This fork supports two first-class entry points to the shared acquisition stack:
the local website at `http://127.0.0.1:4200/` and the **[Spooty CLI](scripts/acquire/README.md)**.
Use Node **20.19.4** (`nvm use`), then:

```sh
npm run acquire -- doctor
npm run acquire -- plan
npm run acquire -- run --limit 8
```

The CLI reference covers every command/option, skip and retry semantics,
prerequisites, durable state, graceful web/CLI ownership transfer and the
shared duration-checked pipeline. [ACQUIRE.md](ACQUIRE.md) retains historical
benchmark/audit notes; its old trial commands are not the default restart recipe.

> [!IMPORTANT]
> Please do not use this tool for piracy! Download only music you own rights! Use this tool only on your responsibility.

### Content
- [🚀 Installation](#-installation)
  - [Docker](#docker)
    - [Docker command](#docker-command)
    - [Docker compose](#docker-compose)
  - [Build from source](#build-from-source)
    - [Process](#requirements)
    - [Requirements](#process)
  - [Environment variables](#environment-variables)
- [⚖️ License](#-license)

## 🚀 Installation
Recommended and the easiest way how to start to use of Spooty is using docker.

> [!NOTE]
> This fork does not require a Spotify Developer application. It reads playlist
> saved and authenticated web-player metadata, so there is no
> `SPOTIFY_CLIENT_ID` or `SPOTIFY_CLIENT_SECRET` to configure.

### Docker

This fork does not publish an image to Docker Hub, so build it locally first:

```shell
git clone https://github.com/dougchansan/spooty.git
cd spooty
docker build -t spooty .
```

For detailed configuration, see available [environment variables](#environment-variables).

#### Docker command
```shell
docker run -d -p 3000:3000 \
  -v /path/to/downloads:/spooty/backend/downloads \
  -v /path/to/cookies.txt:/spooty/cookies.txt:ro \
  spooty
```

#### Docker compose
```yaml
services:
  spooty:
    image: spooty
    container_name: spooty
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /path/to/downloads:/spooty/backend/downloads
      - /path/to/cookies.txt:/spooty/cookies.txt:ro
    environment:
      # Configure other environment variables if needed
      - DOWNLOAD_CONCURRENCY=2
```

### Build from source

Spooty can be also build from source files on your own.

#### Requirements
- Node v20.19.4 (use the repository `.nvmrc` with `nvm use`)
- Redis in memory cache
- Ffmpeg
- Python3

#### Process
- install Node v20.19.4 using `nvm install` and use that node version `nvm use`
- from project root install all dependencies using `npm install`
- copy `.env.default` as `.env` in `src/backend` folder and modify desired environment properties (see [environment variables](#environment-variables))
- build source files `npm run build`
    - built project will be stored in `dist` folder
- start server `npm run start`

### Environment variables

Some behaviour and settings of Spooty can be configured using environment variables and `.env` file.

> [!IMPORTANT]
> `YT_WEB_PROFILE` and custom Bull worker concurrency are read at module-import
> time. Export them before starting Nest. The default `cli-proven` profile uses
> the shared, duration-guarded MP3 pipeline; see the CLI reference for its current
> profile, path defaults and safety behavior. Old per-web extractor/client/batch
> knobs no longer define a second pipeline.

 Name                 | Default                                     | Description                                                                                                                                   |
----------------------|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
 DB_PATH              | `./config/db.sqlite` (relative to backend)  | Path where Spooty database will be stored                                                                                                     |
 FE_PATH              | `../frontend/browser` (relative to backend) | Path to frontend part of application                                                                                                          |
 DOWNLOADS_PATH       | `./downloads` (relative to backend)         | Path where downaloded files will be stored                                                                                                    |
 FORMAT               | `mp3`                                       | Shared ingest publishes MP3; other formats are rejected, not silently mislabeled. |
 QUALITY              | `0`                                         | Shared ingest uses best VBR MP3 quality0. Other values are rejected. |
 PORT                 | 3000                                        | Port of Spooty server                                                                                                                         |
 BIND_HOST            | 127.0.0.1                                   | Interface address for the unauthenticated local API. Keep loopback unless an authenticated reverse proxy is intentionally added.             |
 REDIS_PORT           | 6379                                        | Port of Redis server                                                                                                                          |
 REDIS_HOST           | localhost                                   | Host of Redis server                                                                                                                          |
 REDIS_RUN            | false                                       | Whenever Redis server should be started from backend (recommended for Docker environment)                                                     |
 YT_WEB_PROFILE | `cli-proven` | Shared reviewed profile; `custom` opts out of its authenticated route and Bull slot defaults, not out of duration/safety checks. |
 DOWNLOAD_CONCURRENCY | 32 logical jobs in retained profile | Custom-profile Bull download slots only; the shared pace gate separately limits actual yt-dlp processes. |
 SEARCH_CONCURRENCY | 8 logical jobs in retained profile | Custom-profile Bull search slots only; the shared pace gate separately limits actual yt-dlp processes. |
 ACQUIRE_STATE_PATH | `data/acquire` under this checkout | CLI/web shared work journal and rejection history; must point to the same directory. |
 YT_POT_RECOVERY_ENABLED | on in retained profile | Enable the existing pinned bgutil2.0.0 plugin/provider for authenticated downloads in custom mode. |
 YT_JS_RUNTIME_PATH | local Node22.13.0 path | Executable used only by yt-dlp's JavaScript solver; Nest and CLI remain on Node20.19.4. |
 YT_REPEAT_BOT_COOLDOWN_MIN_MS | 900000                             | Minimum cooldown after another confirmed block while already at the safety floor.                                                            |
 YT_REPEAT_BOT_COOLDOWN_MAX_MS | 1800000                            | Maximum cooldown after another confirmed block while already at the safety floor.                                                            |
 YT_REPEAT_BOT_WINDOW_MS | 3600000                                  | How recently a prior confirmed block must have occurred to use the longer repeated-floor cooldown.                                            |

The optional POT recovery route expects the pinned 2.0.0 provider to be running
under Node 20.19.4 as `node build/main.js --host 127.0.0.1 --port 4416`. Start
and health-check that process before enabling the flag. The shared stack pins
the plugin under `data/yt-dlp-plugins` and the provider to that loopback endpoint.
Authenticated downloads use `mweb` + POT when enabled; authenticated searches
use `web_creator`, and anonymous requests explicitly use `visionos`.
The installed reviewed release does not support `android_sdkless`.
Set `YT_JS_RUNTIME_PATH` to Node 22 or newer so yt-dlp can solve current EJS
challenges while the Nest application continues to run under Node 20.19.4.

> [!WARNING]
> A genuine YouTube block immediately kills owned yt-dlp work and trips the
> shared one-process,8-admissions/ten-minute safety floor with a cooldown.
> Network failures and candidate disqualifications are accounted separately.
> Restarts preserve this history; monitor output before explicitly changing pace.

### How to supply your YouTube cookies

Some downloads are restricted unless the request is authenticated. Spooty passes
a cookies file straight to `yt-dlp`, which expects **Netscape format** — not the
`name=value; name=value` string used by older versions of these instructions.

1. Install a "cookies.txt" browser extension that exports in Netscape format.
2. Go to https://www.youtube.com and log in if needed.
3. Export the cookies for that domain to a file named `cookies.txt`.
4. Mount that file into the container at `/spooty/cookies.txt`, as shown in the
   [Docker](#docker) examples above.

> [!CAUTION]
> This file contains live Google account session cookies, not just YouTube ones.
> Anyone who obtains it can access your Google account without a password.
> Store it outside your repository, never commit it, never paste its contents
> into a chat, issue, or web form, and mount it read-only (`:ro`) so the
> container cannot modify it. Prefer exporting from a throwaway Google account.
> Bake it into an image only if you are certain that image will never be shared —
> image layers preserve it even if a later layer deletes the file.

# ⚖️ License
[MIT](https://choosealicense.com/licenses/mit/)
