#!/usr/bin/env bash
# Start the full GUI dev stack (gui + lib + cli) in parallel watch mode.
# Equivalent to `vp run dev`: gui Vite/React HMR on http://localhost:5180,
# lib and cli rebuilding on change.
set -e
exec vp run -r --parallel dev
