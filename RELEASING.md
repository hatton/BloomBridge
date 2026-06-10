# Branching, versioning & releasing

This is an internal utility, so the process is deliberately light.

## Branching

Trunk-based on `master`:

- Commit small changes straight to `master`.
- Use a short-lived `feat/…` branch + PR only when you want review or want CI to vet
  something risky. No long-lived or release branches.
- `master` is always releasable.

Direct commits are allowed — `master` is not protected. CI still runs on every push
(see below) and tells you if something broke; it just doesn't block you.

## Versioning

One version for the desktop app, semver-ish `MAJOR.MINOR.PATCH`, currently starting at
**0.1.0** (the `0.x` signals "internal, pre-stable" — bump freely):

- **PATCH** for fixes, **MINOR** for features. Don't worry about MAJOR for now.
- The single source of truth is the `version` field in
  [`packages/app/package.json`](packages/app/package.json). The installer
  filename, the in-app version, and the release tag are all derived from it.

## Continuous integration

Two GitHub Actions workflows:

| Workflow                                       | Runs on                                    | Does                                                                                    |
| ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)           | every push to `master` + every PR (Ubuntu) | `pnpm build` + `vp check` (format/lint/type-check). Fast, non-blocking.                 |
| [`release.yml`](.github/workflows/release.yml) | push to `master` (Windows) + manual        | Builds the installer **only when the version is new**, then publishes a GitHub Release. |

> Note: the full test suite isn't run in CI because many tests need API keys / large
> fixtures (see `CLAUDE.md`). Run `vp test run` locally when needed.

## Cutting a release

The version bump _is_ the release signal — no manual tagging:

1. Bump `version` in [`packages/app/package.json`](packages/app/package.json)
   (e.g. `0.1.0` → `0.2.0`).
2. Commit and push to `master`.
3. `release.yml` sees a version with no existing release, builds
   `BloomBridge-Setup-<version>.exe` on a Windows runner, and publishes a GitHub
   Release tagged **`app-v<version>`** with the installer attached and auto-generated
   notes.
4. Share the Release page link. Users download and run the installer (per-user install,
   no admin; unsigned, so SmartScreen shows an "unknown publisher" prompt on first run).

If the version is unchanged, pushing to `master` does **not** build or release — the
job short-circuits after the version check.

### Test builds without releasing

Run the **release** workflow manually (Actions → "Build & Release Windows Installer" →
"Run workflow"). It builds the installer and uploads it as a workflow **artifact** but
does **not** publish a Release.

## Notes

- The `app-v*` tag prefix is intentional — it keeps app releases separate from the
  existing [`publish.yml`](.github/workflows/publish.yml), which npm-publishes the lib/CLI
  on `v*` tags. The two don't collide.
- Building locally: `vp run app-build` (Windows + Inno Setup).
  See [`packages/app/README.md`](packages/app/README.md).
- Code signing is not set up yet; `release.yml` is structured so a `signtool` step can be
  slotted in later.
