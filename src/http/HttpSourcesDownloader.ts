import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { Logger } from '../util/logger';
import { MavenCoords, sourcesJarUrl, formatCoords } from './MavenCoordinatesParser';

const TIMEOUT_MS  = 30_000;
const RETRY_COUNT = 3;

export interface DownloadResult {
  coords:    MavenCoords;
  cachePath: string | undefined;
  bytes:     number;
  error:     string | undefined;
}

export interface ProgressUpdate {
  current: number;
  total:   number;
  coords:  MavenCoords;
  state:   'started' | 'completed' | 'failed';
}

/**
 * Downloads `-sources.jar` files directly from Maven Central via
 * HTTPS — no JVM, no Gradle, no Maven invocation. Writes them into
 * the local Gradle cache layout (`~/.gradle/caches/modules-2/files-2.1/
 * <group>/<artifact>/<version>/<sha1>/<artifact>-<version>-sources.jar`)
 * so the existing `GradleSourcesScanner` picks them up on next scan.
 *
 * Pure Node `https` — respects the `https_proxy` / `HTTPS_PROXY`
 * environment variables (browser-compatible too). No external HTTP lib
 * dependency to keep the VSIX lean.
 */
export class HttpSourcesDownloader {
  private cancelToken = { cancelled: false };

  constructor(private readonly log: Logger) {}

  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  /**
   * Downloads each coord's `-sources.jar`. Returns one `DownloadResult`
   * per input coord (success or failure). Calls `onProgress` per JAR
   * if provided — useful for `withProgress` notifications.
   *
   * Skips coords whose JAR is already cached locally.
   */
  async downloadAll(
    coords: MavenCoords[],
    cacheRoot?: string,
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<DownloadResult[]> {
    const token = this.cancelToken = { cancelled: false };
    const root = cacheRoot ?? path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1');
    const results: DownloadResult[] = [];

    for (let i = 0; i < coords.length; i++) {
      if (token.cancelled) break;
      const c = coords[i];
      onProgress?.({ current: i, total: coords.length, coords: c, state: 'started' });

      // Already cached? Check by walking the version directory for any
      // `<artifact>-<version>-sources.jar` file under any sha1 subdir.
      const cached = await this.findCached(c, root);
      if (cached) {
        results.push({ coords: c, cachePath: cached, bytes: (await fs.stat(cached)).size, error: undefined });
        onProgress?.({ current: i + 1, total: coords.length, coords: c, state: 'completed' });
        continue;
      }

      const result = await this.downloadOne(c, root);
      results.push(result);
      onProgress?.({
        current: i + 1,
        total:   coords.length,
        coords:  c,
        state:   result.error ? 'failed' : 'completed',
      });
    }
    return results;
  }

  private async findCached(c: MavenCoords, root: string): Promise<string | undefined> {
    const versionDir = path.join(root, c.group, c.artifact, c.version);
    let hashDirs: string[];
    try { hashDirs = await fs.readdir(versionDir); } catch { return undefined; }
    const target = `${c.artifact}-${c.version}-sources.jar`;
    for (const h of hashDirs) {
      const candidate = path.join(versionDir, h, target);
      try { await fs.access(candidate); return candidate; } catch { /* keep looking */ }
    }
    return undefined;
  }

  private async downloadOne(c: MavenCoords, root: string): Promise<DownloadResult> {
    const url = sourcesJarUrl(c);

    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      if (this.cancelToken.cancelled) {
        return { coords: c, cachePath: undefined, bytes: 0, error: 'cancelled' };
      }
      try {
        const buffer = await this.fetchBuffer(url);
        const sha1   = crypto.createHash('sha1').update(buffer).digest('hex');
        const target = path.join(root, c.group, c.artifact, c.version, sha1);
        await fs.mkdir(target, { recursive: true });
        const filePath = path.join(target, `${c.artifact}-${c.version}-sources.jar`);
        await fs.writeFile(filePath, buffer);
        this.log.info(`[http-dl] ✓ ${formatCoords(c)} (${(buffer.length / 1024).toFixed(0)} KB)`);
        return { coords: c, cachePath: filePath, bytes: buffer.length, error: undefined };
      } catch (e) {
        lastErr = e as Error;
        if (attempt < RETRY_COUNT) {
          // Exponential backoff: 500 ms, 1500 ms.
          await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
        }
      }
    }
    this.log.warn(`[http-dl] ✗ ${formatCoords(c)} after ${RETRY_COUNT} attempts: ${lastErr?.message}`);
    return { coords: c, cachePath: undefined, bytes: 0, error: lastErr?.message ?? 'unknown' };
  }

  private fetchBuffer(urlStr: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: url.hostname,
          port:     url.port || (url.protocol === 'https:' ? 443 : 80),
          path:     url.pathname + url.search,
          method:   'GET',
          timeout:  TIMEOUT_MS,
          headers:  { 'User-Agent': 'kotlin-jump-vscode-extension' },
        },
        (res) => {
          // Follow up to 5 redirects.
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
              && res.headers.location) {
            res.resume();  // discard body
            this.fetchBuffer(new URL(res.headers.location, urlStr).toString())
              .then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end',   () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error',   reject);
      req.end();
    });
  }
}
