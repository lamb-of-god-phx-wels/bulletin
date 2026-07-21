import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrateLegacyBulletin } from '../src/shared/migrate.js';

const file = resolve('example_bulletin.json');
const legacy = JSON.parse(await readFile(file, 'utf8'));
const migrated = migrateLegacyBulletin(legacy);
await writeFile(file, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
console.log(`Migrated ${file} to schema v${migrated.schemaVersion} (${migrated.blocks.length} blocks).`);
