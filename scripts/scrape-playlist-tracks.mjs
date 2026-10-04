#!/usr/bin/env node
/** Historical diagnostic entry point. Intentionally performs no I/O or CDP. */
process.stderr.write("This HTML track scraper has been retired. Use node scripts/spotify-session.mjs playlist <id> for API metadata; see scripts/CDP.md. No Chrome connection was requested; no files were changed.\n");
process.exitCode = 2;
