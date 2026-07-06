/**
 * Tests for DrawableXmlPreviewLensProvider: the CodeLens above `<vector>`
 * drawables (Open Preview / N references). Hover preview tests moved to
 * test/unit/DrawableXmlHoverProvider.test.ts when that hover logic was split
 * out of DrawableXmlInlinePreviewProvider into its own zero-Node-dependency
 * class; DrawableXmlInlinePreviewProvider itself (the always-visible gutter
 * icon, desktop-only) has no test coverage change here.
 */
import { describe, it, expect } from 'vitest';
import { DrawableXmlPreviewLensProvider } from '../../src/providers/DrawableXmlPreviewPanel';
import { Position } from './__mocks__/vscode';

const VECTOR_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path android:fillColor="#FF0000" android:pathData="M12 2L2 22h20z" />
</vector>
`;

const NON_VECTOR_XML = `<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:state_pressed="true" android:drawable="@drawable/pressed" />
  <item android:drawable="@drawable/normal" />
</selector>
`;

function makeDoc(text: string, opts: { lang?: string; path?: string } = {}) {
  const lines = text.split('\n');
  return {
    languageId: opts.lang ?? 'xml',
    uri: { path: opts.path ?? '/project/res/drawable/ic_banner.xml' },
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] ?? '' }),
    getText: () => text,
    positionAt: (offset: number) => {
      let line = 0, col = 0, remaining = offset;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) { line = i; col = remaining; break; }
        remaining -= lines[i].length + 1;
      }
      return new Position(line, col);
    },
  } as any;
}

// ── CodeLens "Open Vector Preview" + "N references" ─────────────────────────
describe('DrawableXmlPreviewLensProvider', () => {
  // SymbolIndex stub: enough surface for the lens provider's
  // `findDrawableUsages` path. Real Find Usages logic is exercised
  // separately in FindUsagesEngine tests; here we just verify the
  // provider's contract (right number of lenses, right command IDs).
  const stubIndex = {
    lookup: () => [],
    getFilesContainingWord: () => null,
    fileUriStrings: () => [] as string[],
  } as any;
  const lens = new DrawableXmlPreviewLensProvider(stubIndex);

  it('returns Open Preview + a placeholder references lens above <vector>', () => {
    const doc = makeDoc(VECTOR_XML);
    const lenses = lens.provideCodeLenses(doc) as any[];
    expect(lenses).toHaveLength(2);
    expect(lenses[0].command.command).toBe('kotlinJump.vectorPreview.show');
    // Same line as <vector> opener (line 1 in the fixture).
    expect(lenses[0].range.start.line).toBe(1);
    // Second lens is unresolved (no .command yet) and tagged with the
    // drawable name + uri so resolveCodeLens can fill in the count.
    expect(lenses[1].command).toBeUndefined();
    expect(lenses[1]._kjDrawableName).toBe('ic_banner');
  });

  it('resolveCodeLens with 0 references → "No references" lens shows + clicks to empty peek', async () => {
    const doc = makeDoc(VECTOR_XML);
    const [, placeholder] = lens.provideCodeLenses(doc) as any[];
    const resolved = await lens.resolveCodeLens(
      placeholder,
      { isCancellationRequested: false } as any,
    );
    expect(resolved).toBeDefined();
    expect(resolved!.command!.title).toBe('No references');
    // Auto-close wrapper with an empty Location[] keeps the lens
    // visible (an empty command id used to hide it) and pops the
    // standard "no results" peek if the user does click — the peek
    // self-dismisses on the next editor change.
    expect(resolved!.command!.command).toBe('kotlinJump.vectorPreview.showRefsAutoClose');
    expect(resolved!.command!.arguments![2]).toEqual([]);
  });

  it('resolveCodeLens with 1 reference → "1 reference" + direct-jump command', async () => {
    // Build a fake provider whose `findDrawableUsages` returns a single
    // location. Easier than wiring the real workspace scan from a test.
    const oneRefLens = new DrawableXmlPreviewLensProvider(stubIndex);
    const fakeLoc = {
      uri: { toString: () => 'file:///app/Foo.kt' } as any,
      range: { start: { line: 4, character: 12 } } as any,
    };
    (oneRefLens as any).findDrawableUsages = async () => [fakeLoc];
    const doc = makeDoc(VECTOR_XML);
    const [, placeholder] = oneRefLens.provideCodeLenses(doc) as any[];
    const resolved = await oneRefLens.resolveCodeLens(
      placeholder,
      { isCancellationRequested: false } as any,
    );
    expect(resolved!.command!.title).toBe('1 reference');
    expect(resolved!.command!.command).toBe('kotlinJump.vectorPreview.gotoSingleRef');
    expect(resolved!.command!.arguments![0]).toBe(fakeLoc.uri);
  });

  it('resolveCodeLens with N references → "N references" + showReferences peek', async () => {
    const multiLens = new DrawableXmlPreviewLensProvider(stubIndex);
    const locs = [
      { uri: 'a' as any, range: { start: { line: 1, character: 0 } } as any },
      { uri: 'b' as any, range: { start: { line: 2, character: 0 } } as any },
      { uri: 'c' as any, range: { start: { line: 3, character: 0 } } as any },
    ];
    (multiLens as any).findDrawableUsages = async () => locs;
    const doc = makeDoc(VECTOR_XML);
    const [, placeholder] = multiLens.provideCodeLenses(doc) as any[];
    const resolved = await multiLens.resolveCodeLens(
      placeholder,
      { isCancellationRequested: false } as any,
    );
    expect(resolved!.command!.title).toBe('3 references');
    expect(resolved!.command!.command).toBe('kotlinJump.vectorPreview.showRefsAutoClose');
  });

  it('returns no lenses for non-vector drawable XML (selector)', () => {
    const doc = makeDoc(NON_VECTOR_XML);
    expect(lens.provideCodeLenses(doc)).toHaveLength(0);
  });

  it('returns no lenses outside res/drawable*/', () => {
    const doc = makeDoc(VECTOR_XML, { path: '/project/build.xml' });
    expect(lens.provideCodeLenses(doc)).toHaveLength(0);
  });

  it('returns no lenses for non-XML language', () => {
    const doc = makeDoc(VECTOR_XML, { lang: 'kotlin' });
    expect(lens.provideCodeLenses(doc)).toHaveLength(0);
  });
});
