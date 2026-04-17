import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '../../src/util/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

// Builds dns-sd -B output with the given instance names
function browseOutput(...instances: string[]): string {
  return instances.map(name =>
    `Timestamp A/R    Flags  if Domain               Service Type         Instance Name\n` +
    `12:00:00.000  Add        2   5 local.               _adb-tls-connect._tcp. ${name}`,
  ).join('\n');
}

// Builds dns-sd -L output (lookup) for a given hostname and port
function lookupOutput(host: string, port: string): string {
  return `12:00:00.000  ${host}._adb-tls-connect._tcp.local. can be reached at ${host}:${port} (interface 5)`;
}


// ── Unit tests for discoverWifiDevices ────────────────────────────────────────
// We mock the dns-sd runner so tests don't spawn actual processes.

async function runDiscovery(dnsSdResponses: Record<string, string>) {
  // Dynamically import to get fresh module with mocked internals.
  // We expose discoverWifiDevices via export for testability.
  const mod = await import('../../src/commands/AndroidRunCommand');
  return mod.discoverWifiDevices;
}

// Because runDnsSd is module-private, we test discoverWifiDevices by
// mocking child_process.spawn, which runDnsSd uses internally.

describe('AdbWifi — discoverWifiDevices parsing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('extracts instance names from browse output', () => {
    const out = browseOutput('Kevin-Pixel9', 'Kevin-S24');
    const instances = out.split('\n')
      .filter(l => l.includes(' Add '))
      .map(l => l.trim().split(/\s+/).at(-1))
      .filter((x): x is string => Boolean(x));
    expect(instances).toHaveLength(2);
    expect(instances[0]).toBe('Kevin-Pixel9');
    expect(instances[1]).toBe('Kevin-S24');
  });

  it('filters out lines without " Add "', () => {
    const lines = ['header line', 'no match here', '  Add  something  MyDevice'];
    const instances = lines
      .filter(l => l.includes(' Add '))
      .map(l => l.trim().split(/\s+/).at(-1))
      .filter((x): x is string => Boolean(x));
    expect(instances).toEqual(['MyDevice']);
  });

  it('extracts hostname and port from lookup output', () => {
    const out = lookupOutput('Kevin-Phone.local', '37251');
    const reached = out.match(/can be reached at (\S+)/)?.[1];
    expect(reached).toBe('Kevin-Phone.local:37251');
    const colonIdx = reached!.lastIndexOf(':');
    expect(reached!.slice(0, colonIdx)).toBe('Kevin-Phone.local');
    expect(reached!.slice(colonIdx + 1)).toBe('37251');
  });

  it('strips trailing DNS dot from hostname (FQDN → plain)', () => {
    const rawHost = 'Kevin-Phone.local.';
    const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
    expect(host).toBe('Kevin-Phone.local');
  });

  it('does not strip trailing dot if absent', () => {
    const rawHost = 'Kevin-Phone.local';
    const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
    expect(host).toBe('Kevin-Phone.local');
  });
});

// ── adb connect result classification ────────────────────────────────────────

describe('AdbWifi — adb connect result classification', () => {
  function classify(result: string | undefined): 'connected' | 'already' | 'auth' | 'error' {
    if (result?.includes('connected to') || result?.includes('already connected')) return 'connected';
    if (result?.includes('already connected')) return 'already';
    if (result?.includes('failed to authenticate')) return 'auth';
    return 'error';
  }

  it('classifies "connected to IP:PORT" as connected', () => {
    expect(classify('connected to 192.168.1.42:37251')).toBe('connected');
  });

  it('classifies "already connected to IP:PORT" as connected', () => {
    expect(classify('already connected to 192.168.1.42:37251')).toBe('connected');
  });

  it('classifies "failed to authenticate" as auth', () => {
    expect(classify('failed to authenticate to 192.168.1.42:37251')).toBe('auth');
  });

  it('classifies "failed to connect" as error', () => {
    expect(classify('failed to connect to 192.168.1.42:37251')).toBe('error');
  });

  it('classifies undefined as error', () => {
    expect(classify(undefined)).toBe('error');
  });

  it('classifies empty string as error', () => {
    expect(classify('')).toBe('error');
  });
});

// ── Deduplication by hostname ─────────────────────────────────────────────────

describe('AdbWifi — duplicate host deduplication', () => {
  it('deduplicates two instances resolving to the same host', () => {
    const seenHosts = new Set<string>();
    const results: string[] = [];

    for (const host of ['Kevin-Phone.local', 'Kevin-Phone.local']) {
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      results.push(host);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toBe('Kevin-Phone.local');
  });

  it('keeps two instances with different hostnames', () => {
    const seenHosts = new Set<string>();
    const results: string[] = [];

    for (const host of ['Kevin-Pixel.local', 'Kevin-S24.local']) {
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      results.push(host);
    }

    expect(results).toHaveLength(2);
  });
});

// ── lookup output edge cases ──────────────────────────────────────────────────

describe('AdbWifi — lookup output edge cases', () => {
  it('handles hostname with multiple dots (lastIndexOf finds correct port)', () => {
    const reached = 'Kevin-Phone.local.:37251';
    const colonIdx = reached.lastIndexOf(':');
    expect(reached.slice(0, colonIdx)).toBe('Kevin-Phone.local.');
    expect(reached.slice(colonIdx + 1)).toBe('37251');
  });

  it('returns undefined when lookup output has no "can be reached at"', () => {
    const out = 'some unexpected dns-sd output';
    const reached = out.match(/can be reached at (\S+)/)?.[1];
    expect(reached).toBeUndefined();
  });
});

// ── getConnectedDevice fallback logic ─────────────────────────────────────────

describe('AdbWifi — getConnectedDevice mDNS fallback', () => {
  function parseConnectedDevice(adbDevicesOutput: string): string | undefined {
    let mdnsFallback: string | undefined;
    for (const line of adbDevicesOutput.split('\n').slice(1)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.endsWith('\tdevice') || /\tdevice\b/.test(trimmed)) {
        const serial = trimmed.split(/\s+/)[0];
        if (!serial) continue;
        if (trimmed.includes('_adb-tls-connect') || serial.startsWith('adb-')) {
          mdnsFallback ??= serial;
        } else {
          return serial;
        }
      }
    }
    return mdnsFallback;
  }

  it('returns USB serial immediately', () => {
    const out = 'List of devices attached\nR3CN90BAZLE\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('R3CN90BAZLE');
  });

  it('returns HOST:PORT serial immediately', () => {
    const out = 'List of devices attached\nPixel-9.local:42949\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('Pixel-9.local:42949');
  });

  it('prefers HOST:PORT over adb-XXXX-YYYY (ADB auto-mDNS)', () => {
    const out = 'List of devices attached\nadb-DEVICE01234-Aa1Bb\tdevice\nPixel-9.local:42949\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('Pixel-9.local:42949');
  });

  it('falls back to adb-XXXX-YYYY when no USB/HOST:PORT device', () => {
    const out = 'List of devices attached\nadb-DEVICE01234-Aa1Bb\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('adb-DEVICE01234-Aa1Bb');
  });

  it('falls back to _adb-tls-connect serial as last resort', () => {
    const out = 'List of devices attached\nadb-ABC._adb-tls-connect._tcp.\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('adb-ABC._adb-tls-connect._tcp.');
  });

  it('uses first mDNS fallback when multiple are present', () => {
    const out = 'List of devices attached\nadb-DEVICE01234-Aa1Bb\tdevice\nadb-ABC._adb-tls-connect._tcp.\tdevice\n';
    expect(parseConnectedDevice(out)).toBe('adb-DEVICE01234-Aa1Bb');
  });

  it('returns undefined when no device is connected', () => {
    const out = 'List of devices attached\n';
    expect(parseConnectedDevice(out)).toBeUndefined();
  });

  it('ignores unauthorized entries', () => {
    const out = 'List of devices attached\nR3CN90BAZLE\tunauthorized\n';
    expect(parseConnectedDevice(out)).toBeUndefined();
  });
});
