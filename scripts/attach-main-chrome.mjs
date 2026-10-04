#!/usr/bin/env node
/** Historical direct-attachment helper. It must never open a Chrome connection. */
process.stderr.write('This direct-Chrome session exporter has been retired. Spotify session access uses scripts/spotify-session.mjs and the existing HTTP bridge. For an explicitly requested cookie export, use that bridge only; see scripts/CDP.md. No Chrome connection was requested; no session files were changed.\n');
process.exitCode = 2;
