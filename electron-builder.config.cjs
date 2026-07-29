const signingRequired = process.env.BULLETIN_REQUIRE_SIGNING === '1';
const signingEnvironment = {
  endpoint: process.env.AZURE_ARTIFACT_SIGNING_ENDPOINT,
  codeSigningAccountName: process.env.AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME,
  certificateProfileName: process.env.AZURE_ARTIFACT_SIGNING_PROFILE_NAME,
  publisherName: process.env.AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME
};
const signingConfigured = Object.values(signingEnvironment).every(Boolean);

if (signingRequired && !signingConfigured) {
  throw new Error('A signed release requires all AZURE_ARTIFACT_SIGNING_* variables.');
}

module.exports = {
  appId: 'org.mylambofgod.bulletinbuilder',
  productName: 'Bulletin Builder',
  artifactName: 'Bulletin-Builder-${version}-${os}-${arch}.${ext}',
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],
  directories: { output: 'release' },
  electronUpdaterCompatibility: '>=2.16',
  publish: [{
    provider: 'github',
    owner: 'lamb-of-god-phx-wels',
    repo: 'bulletin',
    releaseType: 'release'
  }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    forceCodeSigning: signingRequired,
    verifyUpdateCodeSignature: true,
    ...(signingConfigured ? { azureSignOptions: signingEnvironment } : {})
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  linux: {
    target: ['AppImage'],
    category: 'Office',
    syncDesktopName: true
  }
};
