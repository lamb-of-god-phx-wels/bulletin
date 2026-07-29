import { COPYFILE_EXCL } from 'node:constants';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export function numberedAssetName(fileName: string, copyNumber: number): string {
  if (copyNumber <= 1) return fileName;
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return `${stem}-${copyNumber}${extension}`;
}

export async function copyAssetWithoutOverwrite(source: string, folder: string): Promise<string> {
  const fileName = path.basename(source);
  for (let copyNumber = 1; ; copyNumber += 1) {
    const destination = path.join(folder, numberedAssetName(fileName, copyNumber));
    try {
      await copyFile(source, destination, COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export async function copyAssetToBlobStore(source: string, root: string): Promise<string> {
  const bytes = await readFile(source);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const extension = path.extname(source).toLowerCase();
  const folder = path.join(root, 'assets', 'blobs');
  const destination = path.join(folder, `${digest}${extension}`);
  await mkdir(folder, { recursive: true });
  try { await copyFile(source, destination, COPYFILE_EXCL); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return destination;
}
