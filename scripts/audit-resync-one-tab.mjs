#!/usr/bin/env node
/** Historical diagnostic entry point. Intentionally performs no I/O or CDP. */
process.stderr.write("This historical HTML audit has been retired. Use Sync Spotify library in the website and API track counts; see scripts/CDP.md. No Chrome connection was requested; no files were changed.\n");
process.exitCode = 2;
