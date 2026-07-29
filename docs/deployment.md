# Windows deployment and automatic updates

Production builds are distributed as a public GitHub Release from
`lamb-of-god-phx-wels/bulletin`. Each stable `vX.Y.Z` tag builds a per-user
Windows NSIS installer, publishes the installer and update metadata, and
includes SHA-256 checksums. Installers are currently unsigned, so Windows
identifies their publisher as unknown.
The repository and its Releases must remain public so installed clients can
check and download updates without GitHub credentials.

Only application binaries are published to GitHub. Bulletins, songs, assets,
templates, and church-week overrides remain in the church's synchronized
SharePoint folder and are never part of a release.

The app checks GitHub after startup and every six hours. It downloads a stable
update in the background, then offers **Install and restart**. That action stays
disabled while a bulletin, template, church-week override, or library form has
unsaved work. Choosing **Later** leaves the current session alone; the update is
offered again after the next launch.

## One-time GitHub setup

Enable GitHub Actions and grant workflows read/write access under **Settings →
Actions → General → Workflow permissions**. The release workflow uses the
automatically provided `GITHUB_TOKEN`; it does not require Azure resources,
GitHub environments, or custom secrets.

Unsigned installers display a Windows **Unknown publisher** warning. Only
install releases produced by this repository, and compare the installer
against the published `SHA256SUMS.txt` when manually distributing it.

## Publish a release

1. Change `version` in `package.json` and `package-lock.json`.
2. Commit and push the release changes.
3. Create and push the matching tag, for example:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow rejects tags that do not exactly match the package version and
rejects prerelease versions. GitHub release notes are generated from the
commits since the previous release.

Install the first release manually on each PC. Every later release is delivered
through the in-app updater.

## Workspace compatibility

`workspace.json` may declare `minimumAppVersion` and an optional
`minimumAppMessage`. An older app can still open and preview that synchronized
workspace, but the Electron process rejects every mutation and the UI presents
the workspace as read-only. Set this field only in a release that performs a
forward-only workspace migration, after that release is available to all PCs.

Never reuse or replace an existing release version. Fix a bad release with a
higher patch version so every client sees an unambiguous upgrade path.
