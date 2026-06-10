#!/usr/bin/env bash
# Start the BloomBridge dev server: the GUI (React + the in-process conversion API)
# on http://localhost:5180, with @bloombridge/lib resolved from SOURCE.
#
# That means editing packages/lib is live in the running conversion engine — no
# separate `lib build --watch`, no stale dist cached in the dev-server process (see
# packages/gui/vite.config.ts + conversionApiPlugin). Develop in a browser at :5180.
#
# The native desktop shell (packages/app, Neutralino) is a separate, build-based
# concern — run `pnpm --filter @bloombridge/app dev` when you want the packaged app.
set -e
exec vp run -F @bloombridge/gui dev
