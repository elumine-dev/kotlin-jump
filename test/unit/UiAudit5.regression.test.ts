// Regression tests for the last items of the third display audit (2026-09-08).
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_TEST_SEGS } from '../../src/testing/TestAnnotations';
import { normalizeJUnitName } from '../../src/testing/GradleTestRunner';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';
import { literalAtPosition, extractTemplateArgs, buildReplacement } from '../../src/providers/ExtractStringResourceProvider';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Test discovery — source sets (was: androidUnitTest/ and sharedTest/ classes got a ▶ lens and "test not found in index")', () => {
  it('counts AGP unit-test, shared and KMP target source sets as test files', () => {
    for (const seg of ['androidUnitTest/', 'sharedTest/', 'iosTest/', 'jsTest/']) expect(DEFAULT_TEST_SEGS).toContain(seg);
    expect(DEFAULT_TEST_SEGS).toContain('test/kotlin/');
  });
});

describe('JUnit XML name normalisation (was: a backtick name ending with ")" was cut to nothing the index knew, so the test showed as skipped)', () => {
  it('strips only the trailing parameter list or "()" and the parameterized index', () => {
    expect(normalizeJUnitName('myTest()')).toBe('myTest');
    expect(normalizeJUnitName('myTest(String)[1] - val')).toBe('myTest');
    expect(normalizeJUnitName('myTest[1]')).toBe('myTest');
    expect(normalizeJUnitName('returns 404 (not found)()')).toBe('returns 404 (not found)');
    expect(normalizeJUnitName('handles empty list (edge case)(String)[2] - x')).toBe('handles empty list (edge case)');
  });
});

describe('DrawableResourceIndex — same name in two modules (was: the first module indexed won everywhere)', () => {
  const uri = (p: string) => ({ path: p, toString: () => `file://${p}` });
  it('puts the referencing file\'s own module first, then the default density', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/ws/feature/src/main/res/drawable-hdpi/ic_logo.png'));
    idx.addFile(uri('/ws/feature/src/main/res/drawable/ic_logo.png'));
    idx.addFile(uri('/ws/app/src/main/res/drawable/ic_logo.xml'));
    const fromFeature = idx.get('ic_logo', '/ws/feature/src/main/java/com/x/Screen.kt')!;
    expect(fromFeature.variants[0]!.uri.path).toBe('/ws/feature/src/main/res/drawable/ic_logo.png');
    const fromApp = idx.get('ic_logo', '/ws/app/src/main/java/com/x/Main.kt')!;
    expect(fromApp.variants[0]!.uri.path).toBe('/ws/app/src/main/res/drawable/ic_logo.xml');
    expect(idx.get('ic_logo')!.variants).toHaveLength(3);
  });
});

describe('Extract string resource — raw strings and escaped dollars', () => {
  it('takes the whole """…""" literal (was: only the middle "Hello", leaving ""stringResource(…)"")', () => {
    const line = 'Text("""Hello""")';
    const hit = literalAtPosition(line, line.indexOf('Hello'))!;
    expect(hit).toMatchObject({ literal: 'Hello', start: 5, length: 11, raw: true });
    expect(line.slice(0, hit.start) + buildReplacement(hit.literal, 'hello', 'composable') + line.slice(hit.start + hit.length))
      .toBe('Text(stringResource(R.string.hello))');
  });
  it('keeps a plain literal working and picks the one under the cursor', () => {
    const line = 'log("a", "b")';
    expect(literalAtPosition(line, line.indexOf('"b"') + 1)).toMatchObject({ literal: 'b', start: 9, length: 3 });
  });
  it('treats \\$ as a literal dollar, not a template (was: "Price: \\$100" became "%1$s" with a bogus argument)', () => {
    expect(extractTemplateArgs('Price: \\$100')).toEqual({ xmlValue: 'Price: $100', args: [] });
    expect(extractTemplateArgs('Hi $name, total \\$${total}')).toEqual({ xmlValue: 'Hi %1$s, total $%2$s', args: ['name', 'total'] });
  });
});
