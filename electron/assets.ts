import { COPYFILE_EXCL } from 'node:constants';
import { copyFile } from 'node:fs/promises';
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
