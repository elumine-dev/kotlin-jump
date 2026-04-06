import { describe, it, expect } from 'vitest';
import { parseKotlinJarUri, KotlinJarContentProvider, KOTLIN_JAR_SCHEME } from '../../src/providers/KotlinJarContentProvider';

// ── parseKotlinJarUri — adversarial split logic ───────────────────────────────

describe('parseKotlinJarUri', () => {
  it('splits at ! — happy path baseline', () => {
    const r = parseKotlinJarUri({ path: '/abs/lib-1.0.jar!com/example/Foo.kt' } as any);
    expect(r.jarPath).toBe('/abs/lib-1.0.jar');
    expect(r.entryName).toBe('com/example/Foo.kt');
  });

  it('multiple ! — splits on FIRST only, remainder goes to entryName', () => {
    // An entry name with ! in it (unusual but valid in ZIP spec)
    const r = parseKotlinJarUri({ path: '/path/lib.jar!com/pkg/A!B.kt' } as any);
    expect(r.jarPath).toBe('/path/lib.jar');
    expect(r.entryName).toBe('com/pkg/A!B.kt');
  });

  it('no ! — both fields empty, triggers content provider early return', () => {
    const r = parseKotlinJarUri({ path: '/path/lib.jar' } as any);
    expect(r.jarPath).toBe('');
    expect(r.entryName).toBe('');
  });

  it('! at position 0 — jarPath empty (falsy), content provider returns empty string', () => {
    const r = parseKotlinJarUri({ path: '!com/Foo.kt' } as any);
    expect(r.jarPath).toBe('');          // falsy → early return in provideTextDocumentContent
    expect(r.entryName).toBe('com/Foo.kt');
  });

  it('! at last position — entryName empty (falsy), content provider returns empty string', () => {
    const r = parseKotlinJarUri({ path: '/path/lib.jar!' } as any);
    expect(r.jarPath).toBe('/path/lib.jar');
    expect(r.entryName).toBe('');        // falsy → early return
  });

  it('path with no leading slash — still splits correctly', () => {
    const r = parseKotlinJarUri({ path: 'relative/lib.jar!com/Foo.kt' } as any);
    expect(r.jarPath).toBe('relative/lib.jar');
    expect(r.entryName).toBe('com/Foo.kt');
  });

  it('deeply nested entry path — full subpath preserved', () => {
    const entry = 'androidx/compose/foundation/lazy/LazyColumn.kt';
    const r = parseKotlinJarUri({ path: `/cache/lib.jar!${entry}` } as any);
    expect(r.entryName).toBe(entry);
  });
});

// ── buildUri + parseKotlinJarUri round-trip ───────────────────────────────────

describe('KotlinJarContentProvider.buildUri', () => {
  it('round-trip: buildUri → parseKotlinJarUri recovers original jarPath and entryName', () => {
    const jarPath  = '/abs/path/to/foundation-1.5.4-sources.jar';
    const entryName = 'androidx/compose/foundation/lazy/LazyColumn.kt';
    const uri = KotlinJarContentProvider.buildUri(jarPath, entryName);
    const r   = parseKotlinJarUri(uri);
    expect(r.jarPath).toBe(jarPath);
    expect(r.entryName).toBe(entryName);
  });

  it('URI scheme is kotlin-jar', () => {
    const uri = KotlinJarContentProvider.buildUri('/p/lib.jar', 'Foo.kt');
    expect(uri.scheme).toBe(KOTLIN_JAR_SCHEME);
  });

  it('toString() contains jarPath and entryName separated by !', () => {
    const uri = KotlinJarContentProvider.buildUri('/p/lib.jar', 'com/Foo.kt');
    expect(uri.toString()).toContain('/p/lib.jar');
    expect(uri.toString()).toContain('!');
    expect(uri.toString()).toContain('com/Foo.kt');
  });

  it('two different jars produce distinct URIs', () => {
    const a = KotlinJarContentProvider.buildUri('/cache/lib-1.0.jar', 'Foo.kt');
    const b = KotlinJarContentProvider.buildUri('/cache/lib-2.0.jar', 'Foo.kt');
    expect(a.toString()).not.toBe(b.toString());
  });

  it('same jar different entries produce distinct URIs', () => {
    const a = KotlinJarContentProvider.buildUri('/lib.jar', 'com/Foo.kt');
    const b = KotlinJarContentProvider.buildUri('/lib.jar', 'com/Bar.kt');
    expect(a.toString()).not.toBe(b.toString());
    const ra = parseKotlinJarUri(a);
    const rb = parseKotlinJarUri(b);
    expect(ra.jarPath).toBe(rb.jarPath);
    expect(ra.entryName).not.toBe(rb.entryName);
  });
});

// ── Windows path handling ─────────────────────────────────────────────────────

describe('buildUri / parseKotlinJarUri — Windows path normalisation', () => {
  it('buildUri normalises backslashes to forward slashes', () => {
    const uri = KotlinJarContentProvider.buildUri(
      'C:\\Users\\Kevin\\.gradle\\caches\\lib-sources.jar',
      'com/Foo.kt',
    );
    // URI string must not contain backslashes
    expect(uri.toString()).not.toContain('\\');
    expect(uri.toString()).toContain('C:');
  });

  it('buildUri with Windows path is recoverable via parseKotlinJarUri (simulated)', () => {
    // Simulate what buildUri produces on Windows and what parseKotlinJarUri returns.
    // On macOS/Linux path.sep === '/' so the re-conversion is a no-op.
    const uri = KotlinJarContentProvider.buildUri(
      'C:/Users/Kevin/.gradle/caches/lib-sources.jar',
      'com/Foo.kt',
    );
    const r = parseKotlinJarUri(uri);
    // On non-Windows, the leading /C:/ strip branch is not triggered.
    // On Windows (CI), it would return C:\Users\... — verify forward-slash version:
    expect(r.jarPath.replace(/\\/g, '/')).toContain('C:');
    expect(r.jarPath.replace(/\\/g, '/')).toContain('.gradle/caches/lib-sources.jar');
    expect(r.entryName).toBe('com/Foo.kt');
  });

  it('buildUri with Unix path: parseKotlinJarUri recovers the original path', () => {
    const jarPath = '/home/user/.gradle/lib.jar';
    const uri = KotlinJarContentProvider.buildUri(jarPath, 'entry.kt');
    // kotlin-jar:///home/... is valid (empty authority + absolute path)
    expect(uri.scheme).toBe('kotlin-jar');
    const r = parseKotlinJarUri(uri);
    expect(r.jarPath).toBe(jarPath);
    expect(r.entryName).toBe('entry.kt');
  });
});
