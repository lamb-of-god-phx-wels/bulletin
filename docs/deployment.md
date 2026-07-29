# Windows deployment and automatic updates

Production builds are distributed as a public GitHub Release from
`lamb-of-god-phx-wels/bulletin`. Each stable `vX.Y.Z` tag builds a per-user
Windows NSIS installer, signs it with Azure Artifact Signing, publishes the
installer and update metadata, and includes SHA-256 checksums.
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

## One-time Azure and GitHub setup

1. Create an Azure Artifact Signing account and a public-trust certificate
   profile for the church.
2. Create a Microsoft Entra application/service principal and grant it the
   **Artifact Signing Certificate Profile Signer** role on that certificate
   profile.
3. Add a federated credential for this repository's GitHub `production`
   environment. No long-lived client secret is needed.
4. In the GitHub repository, create an environment named `production`. Protect
   it with required reviewers if desired.
5. Add these GitHub environment variables:

   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `AZURE_ARTIFACT_SIGNING_ENDPOINT`
   - `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`
   - `AZURE_ARTIFACT_SIGNING_PROFILE_NAME`
   - `AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME`

The publisher-name value must match the certificate subject shown on the
signed installer. Update installation verifies that publisher before running
the downloaded installer. The release job fails instead of publishing an
unsigned installer when any signing setting is absent.

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

Install the first signed release manually on each PC. Every later signed
release is delivered through the in-app updater.

## Workspace compatibility

`workspace.json` may declare `minimumAppVersion` and an optional
`minimumAppMessage`. An older app can still open and preview that synchronized
workspace, but the Electron process rejects every mutation and the UI presents
the workspace as read-only. Set this field only in a release that performs a
forward-only workspace migration, after that release is available to all PCs.

Never reuse or replace an existing release version. Fix a bad release with a
higher patch version so every client sees an unambiguous upgrade path.
