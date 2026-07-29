import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
const expected = `v${packageJson.version}`;

if (!tag) {
  console.error(`Pass a release tag (expected ${expected}).`);
  process.exit(1);
}
if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}.`);
  process.exit(1);
}
if (packageJson.version.includes('-')) {
  console.error('Only stable package versions may be released.');
  process.exit(1);
}

console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
