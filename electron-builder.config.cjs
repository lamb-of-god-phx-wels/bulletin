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
    forceCodeSigning: false,
    verifyUpdateCodeSignature: false
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
