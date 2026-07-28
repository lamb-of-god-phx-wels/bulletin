import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type DialogPathKey = 'workspace' | 'asset' | 'export';
type DialogPaths = Partial<Record<DialogPathKey, string>>;

export class DialogPathStore {
  private loaded?: Promise<DialogPaths>;

  constructor(private readonly filePath: string) {}

  private load(): Promise<DialogPaths> {
    this.loaded ??= readFile(this.filePath, 'utf8')
      .then(raw => {
        const value = JSON.parse(raw) as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(value).filter(([key, location]) =>
            ['workspace', 'asset', 'export'].includes(key) && typeof location === 'string' && location.length > 0
          )
        ) as DialogPaths;
      })
      .catch(() => ({}));
    return this.loaded;
  }

  async get(key: DialogPathKey): Promise<string | undefined> {
    return (await this.load())[key];
  }

  async remember(key: DialogPathKey, location: string): Promise<void> {
    const state = await this.load();
    state[key] = location;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
