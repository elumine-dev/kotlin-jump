import * as fs from 'fs/promises';
import * as path from 'path';
import type { CacheEntry } from '../model';
import type { CacheStore } from '../cache';

/**
 * Metadata cache on disk, under the extension's global storage.
 *
 * One JSON file per cache key, the key's slashes becoming directories:
 * `central/com/squareup/okhttp3/okhttp.json`. Global on purpose: okhttp's
 * versions are the same for every project on the machine.
 *
 * Nothing is created at construction. `DrawableGutterThumbnailProvider` runs
 * `mkdirSync` in its constructor; this store creates its directory on the
 * first write, so a user who never consents never gets a folder. Writes go
 * through a temporary file and a rename, so a crash mid write leaves the old
 * entry or none, never half a document.
 */
export class DiskCacheStore implements CacheStore {
  constructor(private readonly root: string) {}

  fileFor(key: string): string {
    // `.` and `..` would climb out of the root: a key is data, never a path.
    const safe = key.split('/').filter(Boolean).map(part => (/^\.+$/.test(part) ? '_' : part.replace(/[^A-Za-z0-9._-]/g, '_')));
    return `${path.join(this.root, ...safe)}.json`;
  }

  async read(key: string): Promise<CacheEntry | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.fileFor(key), 'utf8')) as CacheEntry;
      return parsed && parsed.v === 1 && typeof parsed.url === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async write(key: string, entry: CacheEntry): Promise<void> {
    const file = this.fileFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry));
    await fs.rename(tmp, file);
  }

  async remove(key: string): Promise<void> {
    try { await fs.unlink(this.fileFor(key)); } catch { /* already gone */ }
  }
}
