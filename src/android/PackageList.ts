import { runAdb } from './AdbBinary';

interface CacheEntry { values: string[]; ts: number; }

const CACHE_TTL_MS = 5_000;
const _packageCache = new Map<string, CacheEntry>();
const _pidCache     = new Map<string, CacheEntry>();
const _inflight     = new Map<string, Promise<string[]>>();

/**
 * Lists third-party (user-installed) packages on a device.
 * Cached per-serial for {@link CACHE_TTL_MS} ms; concurrent calls coalesce.
 */
export function listPackages(serial: string): Promise<string[]> {
  const cached = _packageCache.get(serial);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return Promise.resolve(cached.values);

  const key = `pkg:${serial}`;
  const existing = _inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const out = await runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3']);
    const packages = (out ?? '')
      .split('\n')
      .map(line => line.replace(/^package:/, '').trim())
      .filter(Boolean)
      .sort();
    _packageCache.set(serial, { values: packages, ts: Date.now() });
    return packages;
  })().finally(() => _inflight.delete(key));

  _inflight.set(key, promise);
  return promise;
}

/**
 * Resolves PIDs running for a given package. Returns an empty array if the app
 * isn't running. Cached briefly to dedupe rapid calls during stream startup.
 *
 * Note: empty results are NOT cached — when the app has just been launched, a
 * stale "no PID" entry would block the next call for 1.5 s and leave the
 * Follow-app filter unable to lock onto the new process.
 */
export async function resolvePids(serial: string, packageName: string): Promise<number[]> {
  const cacheKey = `${serial}:${packageName}`;
  const cached = _pidCache.get(cacheKey);
  if (cached && cached.values.length > 0 && Date.now() - cached.ts < 1500) {
    return cached.values.map(s => Number(s)).filter(n => Number.isFinite(n));
  }

  const out = await runAdb(['-s', serial, 'shell', 'pidof', packageName]);
  const pids = (out ?? '').split(/\s+/).map(s => s.trim()).filter(Boolean);
  if (pids.length > 0) {
    _pidCache.set(cacheKey, { values: pids, ts: Date.now() });
  } else {
    _pidCache.delete(cacheKey);
  }
  return pids.map(s => Number(s)).filter(n => Number.isFinite(n));
}

export function clearPackageCache(serial?: string): void {
  if (!serial) {
    _packageCache.clear();
    _pidCache.clear();
    return;
  }
  _packageCache.delete(serial);
  for (const key of _pidCache.keys()) {
    if (key.startsWith(`${serial}:`)) _pidCache.delete(key);
  }
}
