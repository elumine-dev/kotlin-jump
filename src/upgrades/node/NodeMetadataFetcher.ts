import * as https from 'https';
import * as http from 'http';
import type { MetadataFetcher } from '../fetchQueue';

/**
 * The one place dependency upgrades touch the network, desktop only.
 *
 * Modelled on `HttpSourcesDownloader.fetchBuffer`: Node's own `https`, a fixed
 * User-Agent, up to five redirects (`maven.google.com` answers 301), a
 * timeout, and the body as text. Every HTTP status is a RESULT: a 404 says
 * the artifact is not there, a 304 says the cache is current, a 429 says the
 * host wants a pause. Only a network failure rejects, with the error code in
 * the message so the queue can tell "offline" from "broken".
 *
 * Never imported by the browser entry: `test/unit/BrowserBundle.test.ts` lists
 * this module among the forbidden symbols.
 */

const MAX_REDIRECTS = 5;
const USER_AGENT = 'kotlin-jump-vscode-extension';

export const nodeMetadataFetcher: MetadataFetcher = (req) => fetchText(req.url, req.headers, req.timeoutMs, req.signal, 0);

function fetchText(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  hops: number,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (hops > MAX_REDIRECTS) return Promise.reject(new Error('too many redirects'));
  if (signal?.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const request = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, application/json, text/plain, */*', ...headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && res.headers.location) {
          res.resume();
          fetchText(new URL(res.headers.location, urlStr).toString(), headers, timeoutMs, signal, hops + 1).then(resolve, reject);
          return;
        }
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') flat[k.toLowerCase()] = v;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status, headers: flat, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code ? `${e.code}: ${e.message}` : e.message)));
    signal?.addEventListener('abort', () => request.destroy(new Error('aborted')), { once: true });
    request.end();
  });
}
