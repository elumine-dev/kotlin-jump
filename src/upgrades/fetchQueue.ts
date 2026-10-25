/**
 * How a version check talks to a repository without being banned.
 *
 * Maven Central blocks a client that hammers it, for up to a day, and asks
 * clients not to retry harder. So: six requests in flight at most, four per
 * host, fifty milliseconds between two starts on the same host, one retry on
 * a server error, none on a 404 or a 429. After a 429 or a 403 the host is
 * left alone for the time it asks (`Retry-After`), fifteen minutes by
 * default, and every request to it pending or later answers rateLimited
 * without being sent. A lost DNS answer means the machine is offline, and
 * nothing is sent for ten minutes.
 *
 * A 200 whose body is not metadata, the HTML page of a captive portal, is
 * reported as badBody so the caller never caches it: the sources downloader
 * once cached such a page as a jar and never retried it.
 *
 * No vscode, no Node: the fetcher is injected, the Node one lives elsewhere.
 */
import { looksLikeMetadataBody } from './metadataParsers';

export interface FetchRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type MetadataFetcher = (req: FetchRequest) => Promise<FetchResponse>;

export type FetchOutcome =
  | { kind: 'ok'; status: 200; headers: Record<string, string>; body: string }
  | { kind: 'notModified' }
  | { kind: 'notFound' }
  | { kind: 'rateLimited' }
  | { kind: 'offline' }
  | { kind: 'badBody' }
  | { kind: 'error'; message: string };

export interface FetchQueueOptions {
  maxInFlight?: number;
  maxPerHost?: number;
  spacingMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const DEFAULT_QUIET_MS = 15 * 60_000;
const OFFLINE_MS = 10 * 60_000;
const RETRY_DELAY_MS = 1000;

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** `Retry-After` as seconds or as an HTTP date, in milliseconds from now; the default when absent or in the past. */
function retryAfterMs(headers: Record<string, string>, realNow: number): number {
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return DEFAULT_QUIET_MS;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim()) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return DEFAULT_QUIET_MS;
  const ms = date - realNow;
  return ms > 0 ? ms : DEFAULT_QUIET_MS;
}

export class FetchQueue {
  private readonly maxInFlight: number;
  private readonly maxPerHost: number;
  private readonly spacingMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  private inFlight = 0;
  private readonly perHost = new Map<string, number>();
  private readonly nextStart = new Map<string, number>();
  private readonly quietUntil = new Map<string, number>();
  private offlineUntil = -Infinity;
  private waiters: Array<() => void> = [];
  private readonly pending = new Map<string, Promise<FetchOutcome>>();
  private readonly counters = { sent: 0, notModified: 0, fromDedupe: 0 };

  constructor(private readonly fetcher: MetadataFetcher, opts: FetchQueueOptions = {}) {
    this.maxInFlight = opts.maxInFlight ?? 6;
    this.maxPerHost = opts.maxPerHost ?? 4;
    this.spacingMs = opts.spacingMs ?? 50;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.log = opts.log ?? (() => {});
  }

  /** Hosts that answered 429 or 403 and are not asked again yet. */
  quietHosts(): string[] {
    const now = this.now();
    return [...this.quietUntil].filter(([, until]) => until > now).map(([host]) => host);
  }

  stats(): { sent: number; notModified: number; fromDedupe: number } {
    return { ...this.counters };
  }

  fetch(url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<FetchOutcome> {
    const pending = this.pending.get(url);
    if (pending) { this.counters.fromDedupe++; return pending; }
    const run = this.run(url, headers, signal).finally(() => { this.pending.delete(url); });
    this.pending.set(url, run);
    return run;
  }

  private async run(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<FetchOutcome> {
    const host = hostOf(url);
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) return { kind: 'error', message: 'aborted' };
      if (this.offlineUntil > this.now()) return { kind: 'offline' };
      if ((this.quietUntil.get(host) ?? -Infinity) > this.now()) return { kind: 'rateLimited' };
      await this.acquire(host);
      // A 429 may have landed while this request waited for its slot.
      if ((this.quietUntil.get(host) ?? -Infinity) > this.now()) { this.release(host); return { kind: 'rateLimited' }; }
      if (signal?.aborted) { this.release(host); return { kind: 'error', message: 'aborted' }; }
      let response: FetchResponse;
      try {
        this.counters.sent++;
        response = await this.fetcher({ url, headers, timeoutMs: this.timeoutMs, signal });
      } catch (e) {
        this.release(host);
        const message = e instanceof Error ? e.message : String(e);
        if (signal?.aborted || message === 'aborted') return { kind: 'error', message: 'aborted' };
        if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
          this.offlineUntil = this.now() + OFFLINE_MS;
          this.log(`[upgrades] offline: ${message}`);
          return { kind: 'offline' };
        }
        if (attempt === 1) { await this.sleep(RETRY_DELAY_MS); continue; }
        return { kind: 'error', message };
      }
      this.release(host);
      const { status } = response;
      if (status === 200) return looksLikeMetadataBody(response.body) ? { kind: 'ok', status, headers: response.headers, body: response.body } : { kind: 'badBody' };
      if (status === 304) { this.counters.notModified++; return { kind: 'notModified' }; }
      if (status === 404 || status === 410) return { kind: 'notFound' };
      if (status === 429 || status === 403) {
        const quiet = retryAfterMs(response.headers, Date.now());
        this.quietUntil.set(host, this.now() + quiet);
        this.log(`[upgrades] ${host} answered ${status}: quiet for ${Math.round(quiet / 60_000)} min`);
        return { kind: 'rateLimited' };
      }
      if (status >= 500 && attempt === 1) { await this.sleep(RETRY_DELAY_MS); continue; }
      return { kind: 'error', message: `HTTP ${status}` };
    }
    return { kind: 'error', message: 'gave up' };
  }

  /** A slot under both limits, then the host's next allowed start. */
  private async acquire(host: string): Promise<void> {
    while (this.inFlight >= this.maxInFlight || (this.perHost.get(host) ?? 0) >= this.maxPerHost) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.inFlight++;
    this.perHost.set(host, (this.perHost.get(host) ?? 0) + 1);
    // Each request takes the next start slot of its host, so two requests
    // waiting together do not leave at the same moment.
    const now = this.now();
    const at = Math.max(now, this.nextStart.get(host) ?? -Infinity);
    this.nextStart.set(host, at + this.spacingMs);
    if (at > now) await this.sleep(at - now);
  }

  private release(host: string): void {
    this.inFlight--;
    this.perHost.set(host, Math.max(0, (this.perHost.get(host) ?? 1) - 1));
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}
