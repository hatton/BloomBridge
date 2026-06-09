# @bloombridge/desktop

A desktop app for converting PDFs and ePUBs to Bloom format (`@bloombridge/gui`).

## How it works

Uses [Neutralino](https://neutralino.js.org) for the frontend, runs a Node backend as a **sidecar process**:

```
Neutralino window
 └─ resources/index.html (boot page, Neutralino origin)
      ├─ spawns:  node ../gui/server-dist/serve.cjs --port 5181
      ├─ waits for the sidecar's port to come up
      ├─ shows:   <iframe src="http://127.0.0.1:5181/">  (the GUI, same-origin inside)
      └─ on windowClose: kills the sidecar, then exits
```

## First-time setup (downloads the Neutralino framework binaries — needs network)

```bash
vp run app-setup
```

## Run

```bash
vp run app-dev
```

This rebuilds lib + gui + sidecar (Node must be on `PATH`), then launches the desktop
window via `neu run`.

## Building the Windows installer

```bash
vp run app-build
```

[scripts/build-installer.mjs](scripts/build-installer.mjs) (Windows-only) builds lib + gui +
sidecar, runs `neu build --release`, downloads a pinned portable `node.exe`, assembles a
self-contained install image under `stage/`, and compiles it with Inno Setup
([installer/bloombridge.iss](installer/bloombridge.iss)) into
`installer-out/BloomBridge-Setup-<version>.exe`.

It installs per-user into `%LOCALAPPDATA%\BloomBridge` (no admin). The installer is currently
**unsigned**, so Windows SmartScreen shows an "unknown publisher" prompt on first run.

Requirements to build locally: Inno Setup 6 (`winget install JRSoftware.InnoSetup`, or set the
`ISCC` env var to `ISCC.exe`). CI installs it automatically (see below).

## Releases (CI)

Releasing is driven by the version in [package.json](package.json): bump it, commit, and
push to `master`, and [.github/workflows/release.yml](../../.github/workflows/release.yml)
builds the installer on a Windows runner and publishes a GitHub Release (tagged
`desktop-v<version>`). See [RELEASING.md](../../RELEASING.md) for the full process.

## Scope

Windows x64 only for now
