import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { LogcatStackResolver, looksObfuscated } from '../../src/logcat/LogcatStackResolver';
import type { LogEntry } from '../../src/logcat/messages';
import type { SymbolEntry } from '../../src/indexer/SymbolIndex';

class FakeIndex {
  private map = new Map<string, SymbolEntry>();
  add(fqn: string, fileUri: string, line = 0): void {
    this.map.set(fqn, {
      name:        fqn.split('.').pop() ?? fqn,
      fqn,
      kind:        'class',
      uri:         vscode.Uri.parse(fileUri),
      line,
      character:   0,
      packageName: fqn.split('.').slice(0, -1).join('.'),
      isComposable: false,
      depth:        0,
    });
  }
  lookupFqn(fqn: string): SymbolEntry | undefined {
    return this.map.get(fqn);
  }
}

const mkEntry = (msg: string): LogEntry => ({
  seq: 0, ts: 0, tsDisplay: '00:00:00.000', pid: 0, tid: 0, level: 'E', tag: 'AndroidRuntime', message: msg,
});

describe('LogcatStackResolver', () => {
  it('resolves a Kotlin frame to the indexed source URI', () => {
    const idx = new FakeIndex();
    idx.add('com.app.MainActivity', 'file:///workspace/app/MainActivity.kt');
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry('\tat com.app.MainActivity.onCreate(MainActivity.kt:42)');
    resolver.resolve(entry);

    expect(entry.frames).toHaveLength(1);
    expect(entry.frames![0]!.uri).toBe('file:///workspace/app/MainActivity.kt');
    expect(entry.frames![0]!.line).toBe(42);
    expect(entry.isStackFrame).toBe(true);
  });

  it('strips inner-class suffix when direct lookup misses', () => {
    const idx = new FakeIndex();
    idx.add('com.app.Outer', 'file:///workspace/app/Outer.kt');
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry('\tat com.app.Outer$Inner.fn(Outer.kt:7)');
    resolver.resolve(entry);

    expect(entry.frames![0]!.uri).toBe('file:///workspace/app/Outer.kt');
  });

  it('strips synthetic Kotlin file-class suffix (FooKt → Foo)', () => {
    const idx = new FakeIndex();
    idx.add('com.app.Main', 'file:///workspace/app/Main.kt');
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry('\tat com.app.MainKt.toplevelFn(Main.kt:1)');
    resolver.resolve(entry);

    expect(entry.frames![0]!.uri).toBe('file:///workspace/app/Main.kt');
  });

  it('marks obfuscated FQNs when the symbol index does not match', () => {
    const idx = new FakeIndex();
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry('\tat a.b.c.Cz.a(d.kt:1)');
    resolver.resolve(entry);

    expect(entry.frames![0]!.uri).toBeUndefined();
    expect(entry.frames![0]!.obfuscated).toBe(true);
    expect(looksObfuscated(entry)).toBe(true);
  });

  it('extracts multiple frames in a single message', () => {
    const idx = new FakeIndex();
    idx.add('com.app.A', 'file:///A.kt');
    idx.add('com.app.B', 'file:///B.kt');
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry(
      'FATAL EXCEPTION\n\tat com.app.A.fn(A.kt:1)\n\tat com.app.B.fn(B.kt:2)',
    );
    resolver.resolve(entry);

    expect(entry.frames).toHaveLength(2);
    expect(entry.frames!.map(f => f.line)).toEqual([1, 2]);
  });

  it('leaves entries without frames untouched', () => {
    const idx = new FakeIndex();
    const resolver = new LogcatStackResolver(idx as any);
    const entry = mkEntry('plain log message, no frames here');
    resolver.resolve(entry);
    expect(entry.frames).toBeUndefined();
  });
});
