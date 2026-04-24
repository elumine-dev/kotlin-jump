/**
 * Adversarial tests for dispatcher badges in SuspendMarkerProvider.
 *
 * Guards the regex-based detection of `Dispatchers.X` passed to a
 * coroutine builder. The README has advertised these badges since the
 * Skia caption fix but the code only shipped `⚡` suspend markers until
 * v1.16. These tests lock the contract so the README and the runtime
 * behavior can't drift again.
 *
 * Covered:
 *   - recognised builders: withContext, launch, async, flowOn, produce, actor
 *   - recognised dispatchers: IO, Main, Main.immediate, Default, Unconfined
 *   - the builder name doesn't also get a ⚡ (dedupe)
 *   - false-positive guards: inside comments, strings, variable reference
 *   - unrecognised builder/dispatcher → no badge
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { SuspendMarkerProvider } from '../../src/providers/SuspendMarkerProvider';

afterEach(() => vi.restoreAllMocks());

type Entry = { name: string; isSuspend?: boolean };

function makeIndex(entries: Entry[] = []) {
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  return { lookup: (name: string) => byName.get(name) ?? [] };
}

function setupConfig(enabled = true) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, def: any) => key === 'suspendCallMarkers' ? enabled : def,
  } as any);
}

function hintsFor(lines: string[], extraEntries: Entry[] = []) {
  setupConfig(true);
  const provider = new SuspendMarkerProvider(makeIndex(extraEntries) as any);
  const doc = {
    languageId: 'kotlin',
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
    fileName: 'file.kt',
  } as any;
  const range = new vscodeMock.Range(0, 0, lines.length - 1, 0);
  return provider.provideInlayHints(doc, range);
}

describe('ADV-dispatcher — happy path per builder', () => {
  const cases: Array<{ code: string; builder: string; badge: string }> = [
    { code: 'withContext(Dispatchers.IO) {',      builder: 'withContext',  badge: '🧵 IO' },
    { code: 'withContext(Dispatchers.Main) {',    builder: 'withContext',  badge: '🖥 Main' },
    { code: 'withContext(Dispatchers.Default) {', builder: 'withContext',  badge: '⚙ Default' },
    { code: 'launch(Dispatchers.IO) {',           builder: 'launch',       badge: '🧵 IO' },
    { code: 'async(Dispatchers.Default) {',       builder: 'async',        badge: '⚙ Default' },
    { code: 'flow.flowOn(Dispatchers.IO)',        builder: 'flowOn',       badge: '🧵 IO' },
    { code: 'produce(Dispatchers.IO) {',          builder: 'produce',      badge: '🧵 IO' },
    { code: 'actor(Dispatchers.Main) {',          builder: 'actor',        badge: '🖥 Main' },
  ];

  for (const c of cases) {
    it(`${c.builder}(Dispatchers.${c.badge}) → badge`, () => {
      const result = hintsFor([c.code]);
      const badges = result.filter(h => h.label === c.badge);
      expect(badges.length, `expected ${c.badge} on "${c.code}"`).toBe(1);
    });
  }
});

describe('ADV-dispatcher — Main.immediate collapses to 🖥 Main', () => {
  it('withContext(Dispatchers.Main.immediate) → 🖥 Main', () => {
    const result = hintsFor(['withContext(Dispatchers.Main.immediate) {']);
    expect(result.filter(h => h.label === '🖥 Main')).toHaveLength(1);
  });
});

describe('ADV-dispatcher — Unconfined gets its own badge', () => {
  it('launch(Dispatchers.Unconfined) → 🔀 Unconfined', () => {
    const result = hintsFor(['launch(Dispatchers.Unconfined) {']);
    expect(result.filter(h => h.label === '🔀 Unconfined')).toHaveLength(1);
  });
});

describe('ADV-dispatcher — builder name does NOT also get a ⚡', () => {
  it('withContext is in symbol index with isSuspend=true; only one hint emitted', () => {
    // If the dedupe logic broke, `withContext` would get both the badge
    // AND a ⚡ (because withContext IS a suspend fun).
    const result = hintsFor(
      ['withContext(Dispatchers.IO) { work() }'],
      [
        { name: 'withContext', isSuspend: true },
        { name: 'work',        isSuspend: true },
      ],
    );
    // Expected: one 🧵 IO (on withContext) + one ⚡ (on work) = 2 hints, no duplicates.
    expect(result).toHaveLength(2);
    expect(result.filter(h => h.label === '🧵 IO')).toHaveLength(1);
    expect(result.filter(h => h.label === '⚡')).toHaveLength(1);
  });
});

describe('ADV-dispatcher — false-positive guards', () => {
  it('inside a line comment → no badge', () => {
    const result = hintsFor(['// withContext(Dispatchers.IO) {']);
    expect(result).toHaveLength(0);
  });

  it('inside a block comment line → no badge', () => {
    const result = hintsFor([' * withContext(Dispatchers.IO) {']);
    expect(result).toHaveLength(0);
  });

  it('inside a double-quoted string literal → no badge', () => {
    const result = hintsFor(['val doc = "call withContext(Dispatchers.IO) yourself"']);
    expect(result.filter(h => String(h.label).includes('IO'))).toHaveLength(0);
  });

  it('inside a raw-string block → no badge', () => {
    const result = hintsFor([
      'val snippet = """',
      '  withContext(Dispatchers.IO) {',
      '  }',
      '"""',
    ]);
    expect(result.filter(h => String(h.label).includes('IO'))).toHaveLength(0);
  });

  it('variable reference `withContext(ctx)` does NOT light up', () => {
    // The provider intentionally only matches `Dispatchers.X` literals.
    // Dataflow analysis is out of scope.
    const result = hintsFor(['withContext(ctx) { }']);
    expect(result.filter(h => String(h.label).includes('IO'))).toHaveLength(0);
  });

  it('unrecognised builder `foo(Dispatchers.IO)` does NOT light up', () => {
    const result = hintsFor(['foo(Dispatchers.IO) { }']);
    expect(result.filter(h => String(h.label).includes('IO'))).toHaveLength(0);
  });

  it('unrecognised dispatcher `withContext(Dispatchers.Virtual)` does NOT light up', () => {
    // Virtual is not in the map — graceful no-op, no crash.
    const result = hintsFor(['withContext(Dispatchers.Virtual) { }']);
    expect(result).toHaveLength(0);
  });
});

describe('ADV-dispatcher — multiple builders on one line', () => {
  it('chained `.flowOn(Dispatchers.IO).collect { ... withContext(Dispatchers.Main) }`', () => {
    // Flat line with two builders both passing literal dispatchers.
    const line = 'flow.flowOn(Dispatchers.IO).also { withContext(Dispatchers.Main) { } }';
    const result = hintsFor([line]);
    expect(result.filter(h => h.label === '🧵 IO')).toHaveLength(1);
    expect(result.filter(h => h.label === '🖥 Main')).toHaveLength(1);
  });
});

describe('ADV-dispatcher — respects suspendCallMarkers=false setting', () => {
  it('setting off → no badges, no markers', () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'suspendCallMarkers' ? false : def,
    } as any);
    const provider = new SuspendMarkerProvider(makeIndex([]) as any);
    const doc = {
      languageId: 'kotlin',
      lineCount: 1,
      lineAt: () => ({ text: 'withContext(Dispatchers.IO) {' }),
      fileName: 'file.kt',
    } as any;
    const range = new vscodeMock.Range(0, 0, 0, 0);
    expect(provider.provideInlayHints(doc, range)).toHaveLength(0);
  });
});
