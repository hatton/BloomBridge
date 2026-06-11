---
name: release
description: Commit and push a new app version. Ensures packages/app/package.json version is at least one patch (last digit) ahead of the last commit — bumping it automatically if it isn't — then commits all changes and pushes. Use when the user says "commit and push a new version", "ship a new version", "release", or invokes /release.
---

# Release a new app version

A one-shot "ship it": make sure the app's version is newer than what's committed, then commit everything and push. Follow these steps exactly.

## 1. Read the two versions

- **Current** — the `"version"` field in `packages/app/package.json` (working tree).
- **Committed** — `git show HEAD:packages/app/package.json`, then read its `"version"`.

Parse both as dotted numeric semver (e.g. `0.1.6` → `[0,1,6]`). Ignore any `-prerelease` suffix.

## 2. Ensure the version is bumped

Compare current vs committed component-by-component:

- If **current is strictly greater** than committed (any component higher — at minimum the patch/last digit), it's already bumped. **Leave it as-is.**
- Otherwise (current equals committed, or somehow lower), compute a new version =
  **committed version with its last (patch) digit incremented by 1**, and write it
  into `packages/app/package.json`. Change only the version string — preserve all
  other formatting and indentation (use a targeted Edit, not a full rewrite).

State the result in one line, e.g. `version: 0.1.6 (committed) → 0.1.7 (bumped)` or
`version: 0.2.0 already ahead of committed 0.1.6 — keeping it`.

## 3. Commit

- Stage everything: `git add -A`.
- If, after staging, there is **nothing to commit** (clean tree and the version was
  already committed), stop and tell the user there's nothing to ship.
- Commit message:
  - If the user passed text as arguments, use that as the subject line.
  - Otherwise use `chore(app): release v<new-version>`.
  - End the message with the required trailer on its own line:
    `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## 4. Push

- `git push`. If the branch has no upstream, `git push -u origin <current-branch>`.
- This repo commits directly to `master`; push to the current branch (don't create a
  new one) unless the user is already on a different branch.

## 5. Report

Print the new version, the commit hash, and the push result (branch + remote).

## Scope / non-goals

- This skill **only** versions, commits, and pushes. It does **not** build the
  installer or create a GitHub release. (The auto-updater needs a GitHub release
  tagged `app-v<version>` carrying the installer; that's a separate step.)
- Do not touch `neutralino.config.json` — its version is a placeholder that the build
  syncs from `package.json` automatically.
