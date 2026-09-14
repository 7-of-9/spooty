# Security and public-repository hygiene

## Local-only services and credentials

Spooty's HTTP API has no built-in user authentication. Keep the backend,
Redis, the Chrome bridge and the local POT provider bound to loopback. A
deployment exposed beyond the local machine needs its own authenticated access
boundary; the development server is not a public multi-user service.

YouTube cookie exports and Spotify browser sessions are credentials. Never
commit, paste, attach to an issue, or bake them into a container image. Only
use browser/session integration on an account you are authorized to operate.
The acquisition engine makes private per-process cookie copies and does not
put credential values into its documented progress/status output.

`.gitignore` keeps downloads, MP3 copies, local environment files, cookies,
session exports, SQLite databases and sidecars, playlist dumps, runtime caches,
audit reports and provider installations out of new commits. Configuration
templates such as `.env.default` contain settings, not account credentials.
Ignoring a file does not remove it from existing Git history: review both the
outgoing tree and its history before publication.

## Public-fork audit — 14 September 2026

Publication checks cover the complete reachable `main` history, the outgoing
changes and a Git-archive copy of the committed tree, rather than scanning a
working directory containing private runtime data. Gitleaks 8.30.1 was obtained
from its official release and its archive SHA-256 was checked against the
release checksum manifest. Reports stay outside the repository and redact
detected values. Supplemental path/content checks look for downloaded media,
session files, databases, private keys and common credential formats.

One inherited `generic-api-key` finding is a CircleCI badge reference in the
original NestJS scaffold: commit `da9cf53`, `spooty-be/README.md`, line 5.
It matches the same public reference in both official templates inspected:

- `nestjs/typescript-starter/README.md`, blob
  `07fc6fa43033b4f00b97b3007cfd96369985c3c4`.
- `nestjs/schematics/src/lib/application/files/ts/README.md`, blob
  `a1f8e352875f94adbaa9da608d0fecd0a56f71d8`.

The current backend README has been replaced with Spooty-specific documentation,
so the committed file tree contains no copy of that badge reference.
The historical reference is not a credential belonging to this fork. `.gitleaksignore`
records only that exact historical fingerprint. There is no directory-wide,
rule-wide or current-file suppression. The token-shaped value is not repeated
in this document. The inherited `spooty-be/test.sqlite` fixture, removed by
upstream long before these extensions, was also inspected: its playlist and
track tables are empty and its schema has no credential fields. Our additions
contain no runtime databases or downloaded audio.

To repeat the history check with Gitleaks installed, from the repository root:

```sh
gitleaks git --redact --no-banner --ignore-gitleaks-allow --log-opts=HEAD .
git diff --cached --check
```

Do not commit scanner reports containing actual detected values. Investigate
new findings rather than expanding the exception above. An automated scan is
not a proof that every possible secret format can be detected; it complements
review of the files and history actually being pushed.

If a real credential is ever exposed, revoke or rotate it first, then remove
it from every affected Git ref and published artifact. Do not report the value
in a public issue.
