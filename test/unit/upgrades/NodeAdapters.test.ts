import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { nodeMetadataFetcher } from '../../../src/upgrades/node/NodeMetadataFetcher';
import { DiskCacheStore } from '../../../src/upgrades/node/DiskCacheStore';

/**
 * KJ-082, the two Node adapters of dependency upgrades: the fetcher and the
 * disk store. Everything else in `src/upgrades` is pure, so these two carry
 * every failure a real machine produces: a redirect, a 404, a 304 against an
 * ETag, a timeout, a refused connection, a corrupt cache file. A local HTTP
 * server stands in for the repositories; no test reaches the network.
 */

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/moved') { res.writeHead(301, { Location: '/maven-metadata.xml' }); res.end(); return; }
    if (url === '/maven-metadata.xml') {
      if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/xml', ETag: '"v1"' });
      res.end('<?xml version="1.0"?><metadata><versioning><versions><version>1.0</version></versions></versioning></metadata>');
      return;
    }
    if (url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 500); return; }
    if (url === '/busy') { res.writeHead(429, { 'Retry-After': '120' }); res.end('slow down'); return; }
    res.writeHead(404); res.end('not here');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('KJ-082 NodeMetadataFetcher', () => {
  it('returns the body, the status and the lowercased headers of a 200', async () => {
    const r = await nodeMetadataFetcher({ url: `${base}/maven-metadata.xml`, headers: {}, timeoutMs: 2000 });
    expect(r.status).toBe(200);
    expect(r.headers.etag).toBe('"v1"');
    expect(r.body).toContain('<version>1.0</version>');
  });

  it('follows a redirect', async () => {
    const r = await nodeMetadataFetcher({ url: `${base}/moved`, headers: {}, timeoutMs: 2000 });
    expect(r.status).toBe(200);
  });

  it('a 304 against the ETag is a result, with an empty body', async () => {
    const r = await nodeMetadataFetcher({ url: `${base}/maven-metadata.xml`, headers: { 'If-None-Match': '"v1"' }, timeoutMs: 2000 });
    expect(r.status).toBe(304);
    expect(r.body).toBe('');
  });

  it('a 404 and a 429 are results too, headers included', async () => {
    expect((await nodeMetadataFetcher({ url: `${base}/nothing`, headers: {}, timeoutMs: 2000 })).status).toBe(404);
    const busy = await nodeMetadataFetcher({ url: `${base}/busy`, headers: {}, timeoutMs: 2000 });
    expect(busy.status).toBe(429);
    expect(busy.headers['retry-after']).toBe('120');
  });

  it('a timeout rejects', async () => {
    await expect(nodeMetadataFetcher({ url: `${base}/slow`, headers: {}, timeoutMs: 50 })).rejects.toThrow(/timeout/);
  });

  it('a refused connection rejects with the error code in the message', async () => {
    await expect(nodeMetadataFetcher({ url: 'http://127.0.0.1:1/x', headers: {}, timeoutMs: 2000 })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('an aborted signal rejects', async () => {
    const controller = new AbortController();
    const p = nodeMetadataFetcher({ url: `${base}/slow`, headers: {}, timeoutMs: 2000, signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });
});

describe('KJ-082 DiskCacheStore', () => {
  const entry = { v: 1 as const, url: 'https://repo1.maven.org/maven2/x/maven-metadata.xml', fetchedAt: 1, status: 'ok' as const, versions: ['1.0', '1.1'] };

  it('creates nothing until the first write, then round trips an entry through a nested key', async () => {
    const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'kj-upgrades-')), 'cache');
    const store = new DiskCacheStore(root);
    await expect(fs.stat(root)).rejects.toThrow();
    expect(await store.read('central/com/example/kiosk/core')).toBeUndefined();
    await store.write('central/com/example/kiosk/core', entry);
    expect(await store.read('central/com/example/kiosk/core')).toEqual(entry);
    expect((await fs.readdir(root)).sort()).toEqual(['central']);
    await store.remove('central/com/example/kiosk/core');
    expect(await store.read('central/com/example/kiosk/core')).toBeUndefined();
  });

  it('a corrupt or foreign file reads as nothing, never as an entry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kj-upgrades-'));
    const store = new DiskCacheStore(root);
    await fs.mkdir(path.dirname(store.fileFor('gradle/_versions')), { recursive: true });
    await fs.writeFile(store.fileFor('gradle/_versions'), '{ not json');
    expect(await store.read('gradle/_versions')).toBeUndefined();
    await fs.writeFile(store.fileFor('gradle/_versions'), JSON.stringify({ hello: 'world' }));
    expect(await store.read('gradle/_versions')).toBeUndefined();
  });

  it('keeps a key with odd characters inside its own folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kj-upgrades-'));
    const store = new DiskCacheStore(root);
    expect(store.fileFor('custom-1a2b/com/example/a b')).toBe(path.join(root, 'custom-1a2b', 'com', 'example', 'a_b.json'));
    // A key is data: `..` never climbs out of the cache root.
    expect(store.fileFor('../../etc/passwd')).toBe(path.join(root, '_', '_', 'etc', 'passwd.json'));
  });
});
