#!/usr/bin/env node
/** Historical diagnostic entry point. Intentionally performs no I/O or CDP. */
process.stderr.write("This one-off page inspector has been retired. Use the existing HTTP bridge /eval for diagnostics; see scripts/CDP.md. No Chrome connection was requested; no files were changed.\n");
process.exitCode = 2;
