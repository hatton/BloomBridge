/* Auto-updater for the BloomBridge desktop app.
 *
 * Why not Neutralino's built-in updater? `Neutralino.updater` only swaps the
 * `resources.neu` bundle (the small web frontend on this page). It does NOT touch the
 * bundled node.exe sidecar or the `app/` directory (the GUI + @bloombridge/lib), which
 * is the bulk of BloomBridge. So it can't update this app.
 *
 * Instead we reuse the channel we already ship through: GitHub Releases. Each release is
 * tagged `app-v<version>` and carries the Inno Setup installer
 * (`BloomBridge-Setup-<version>.exe`). This module:
 *   1. asks the GitHub API for the newest `app-v*` release,
 *   2. compares it to the running version (NL_APPVERSION),
 *   3. if newer, asks the user, downloads the installer, runs it, and quits.
 * The installer upgrades in place (stable AppId GUID) and relaunches the app
 * (RestartApplications in the .iss).
 *
 * Loaded before boot.js; boot.js calls window.BloomBridgeUpdater.check() once the app
 * is visible. All failures are non-fatal — the app keeps running on any error.
 */
(function () {
  // Where releases live. Overridable via the RELEASE_REPO global in
  // neutralino.config.json (exposed as NL_RELEASE_REPO). Format: "owner/repo".
  const REPO =
    typeof NL_RELEASE_REPO === "string" && NL_RELEASE_REPO ? NL_RELEASE_REPO : "hatton/BloomBridge";
  const TAG_PREFIX = "app-v";
  const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
  const INSTALLER_RE = /BloomBridge-Setup-.*\.exe$/i;

  function ulog(msg) {
    try {
      Neutralino.debug.log(`[bloombridge updater] ${msg}`);
    } catch {
      /* debug.log unavailable */
    }
  }

  /** True only in a `neu build --release` bundle — we never trigger updates in dev. */
  function isBundled() {
    return typeof NL_RESMODE !== "undefined" && NL_RESMODE === "bundle";
  }

  function currentVersion() {
    return typeof NL_APPVERSION === "string" ? NL_APPVERSION : "0.0.0";
  }

  /** Parse "1.2.3" → [1,2,3]; ignores any "-prerelease" suffix (we're pre-stable 0.x). */
  function parseVer(v) {
    return String(v)
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  }

  /** Returns >0 if a is newer than b, <0 if older, 0 if equal. */
  function cmpVer(a, b) {
    const pa = parseVer(a);
    const pb = parseVer(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /* --- small non-blocking toast over the running app --- */
  function toast(msg) {
    let el = document.getElementById("updateToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "updateToast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    return el;
  }
  function clearToast() {
    const el = document.getElementById("updateToast");
    if (el) el.remove();
  }

  /**
   * Find the newest published `app-v*` release with an installer asset.
   * Returns { version, downloadUrl, name } or null.
   */
  async function findLatestRelease() {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const releases = await res.json();
    let best = null;
    for (const r of releases) {
      if (r.draft) continue;
      const tag = r.tag_name || "";
      if (!tag.startsWith(TAG_PREFIX)) continue; // ignore lib/cli `v*` releases
      const version = tag.slice(TAG_PREFIX.length);
      const asset = (r.assets || []).find((a) => INSTALLER_RE.test(a.name));
      if (!asset) continue;
      if (!best || cmpVer(version, best.version) > 0) {
        best = { version, downloadUrl: asset.browser_download_url, name: asset.name };
      }
    }
    return best;
  }

  /** Quote a string for use inside a single-quoted PowerShell literal. */
  function psQuote(s) {
    return `'${String(s).replace(/'/g, "''")}'`;
  }

  /** Download the installer to the temp dir via PowerShell. Returns the local path. */
  async function downloadInstaller(rel) {
    const tempDir = await Neutralino.os.getPath("temp");
    const dest = `${tempDir}\\${rel.name}`;
    const cmd =
      `powershell -NoProfile -NonInteractive -Command ` +
      `"$ProgressPreference='SilentlyContinue'; ` +
      `Invoke-WebRequest -Uri ${psQuote(rel.downloadUrl)} -OutFile ${psQuote(dest)}"`;
    ulog(`downloading ${rel.downloadUrl} -> ${dest}`);
    const out = await Neutralino.os.execCommand(cmd);
    if (out.exitCode !== 0) {
      throw new Error(`download failed (exit ${out.exitCode}): ${out.stdErr || out.stdOut}`);
    }
    return dest;
  }

  /** Launch the installer detached and quit so it can replace files. */
  async function runInstallerAndExit(installerPath) {
    ulog(`launching installer: ${installerPath}`);
    // `cmd /c start` fully detaches the installer from our process tree so it survives
    // app.exit(). The empty "" is start's window-title argument.
    await Neutralino.os.execCommand(`cmd /c start "" ${psQuote(installerPath)}`, {
      background: true,
    });
    await Neutralino.app.exit();
  }

  /**
   * Check for updates and, if the user agrees, download + install. Safe to call always:
   * it no-ops in dev mode and swallows every error (logs only) so it can never break
   * the running app.
   */
  async function check() {
    if (!isBundled()) {
      ulog("dev mode — skipping update check");
      return;
    }
    try {
      const current = currentVersion();
      const rel = await findLatestRelease();
      if (!rel) {
        ulog("no app release with an installer found");
        return;
      }
      if (cmpVer(rel.version, current) <= 0) {
        ulog(`up to date (current ${current}, latest ${rel.version})`);
        return;
      }
      ulog(`update available: ${current} -> ${rel.version}`);

      const answer = await Neutralino.os.showMessageBox(
        "Update available",
        `BloomBridge ${rel.version} is available (you have ${current}).\n\n` +
          `Download and install it now? BloomBridge will close to update, then reopen.`,
        "YES_NO",
        "QUESTION",
      );
      if (answer !== "YES") {
        ulog("user declined update");
        return;
      }

      toast(`Downloading BloomBridge ${rel.version}…`);
      let installerPath;
      try {
        installerPath = await downloadInstaller(rel);
      } catch (e) {
        clearToast();
        ulog(`download error: ${(e && e.message) || e}`);
        await Neutralino.os.showMessageBox(
          "Update failed",
          `Couldn't download the update.\n\n${(e && e.message) || e}\n\n` +
            `You can download it manually from:\nhttps://github.com/${REPO}/releases`,
          "OK",
          "ERROR",
        );
        return;
      }

      toast(`Starting installer…`);
      await runInstallerAndExit(installerPath);
    } catch (e) {
      clearToast();
      ulog(`check error: ${(e && (e.message || e.code)) || e}`);
    }
  }

  window.BloomBridgeUpdater = { check };
})();
