import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.untracked/sharepoint');
const document = JSON.parse(await readFile('example_bulletin.json', 'utf8'));
const baseTemplate = JSON.parse(await readFile(join(root, 'templates/lamb-of-god-weekly/v1.json'), 'utf8'));
const template = {
  ...baseTemplate,
  id: 'lamb-of-god-example',
  name: 'Lamb of God — June 7, 2026 Example',
  theme: {
    ...baseTemplate.theme,
    bodyFont: 'CalibriLocal, Calibri, Arial, sans-serif',
    displayFont: 'ErasLocal, Georgia, serif',
    bodySizePt: 8,
    lineHeight: 1.16,
    marginIn: 0.3
  },
  updatedAt: '2026-07-22T00:00:00.000Z'
};
const records = [
  ['bulletins/2026-06-07/bulletin.json', document],
  ['templates/lamb-of-god-example/v1.json', template]
];
for (const [relative, value] of records) {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
const assets = [
  'assets/church/logo.png',
  'assets/sermon_series/say_it_out_loud/logo.png',
  'assets/example_2026-06-07/church-building.png',
  'assets/example_2026-06-07/psalm-130-part-1.png',
  'assets/example_2026-06-07/psalm-130-part-2.png',
  'assets/example_2026-06-07/his-mercy-is-more.png',
  'assets/example_2026-06-07/prayer-care-qr.png',
  'assets/example_2026-06-07/giving-qr.png'
];
for (const relative of assets) {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(relative, target);
}
console.log('Installed June 7, 2026 example bulletin in ' + root);
