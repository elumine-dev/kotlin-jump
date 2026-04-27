/**
 * Tests for DrawableXmlInlinePreviewProvider — inline hover preview of
 * `<vector>` drawables when their source XML is open.
 */
import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './__mocks__/vscode';
import { DrawableXmlInlinePreviewProvider } from '../../src/providers/DrawableXmlInlinePreviewProvider';
import { DrawableXmlPreviewLensProvider } from '../../src/providers/DrawableXmlPreviewPanel';
import { Position } from './__mocks__/vscode';

// The provider needs a storage dir + a few VS Code event listeners.
// Stub them so the constructor runs cleanly inside vitest.
const STORAGE_URI = { fsPath: path.join(os.tmpdir(), 'kj-vector-xml-preview-test') };
vi.spyOn(vscodeMock.window as any, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: () => {} });
vi.spyOn(vscodeMock.window as any, 'onDidChangeVisibleTextEditors').mockReturnValue({ dispose: () => {} });
vi.spyOn(vscodeMock.workspace as any, 'onDidChangeTextDocument').mockReturnValue({ dispose: () => {} });
Object.defineProperty(vscodeMock.window as any, 'visibleTextEditors', { configurable: true, get: () => [] });

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

describe('DrawableXmlInlinePreviewProvider', () => {
  const provider = new DrawableXmlInlinePreviewProvider(STORAGE_URI as any);

  it('shows an SVG preview when hovering the `<vector>` tag line', () => {
    const doc = makeDoc(VECTOR_XML);
    // `<vector` starts on line 1. Hover on line 1.
    const hover = provider.provideHover(doc, new Position(1, 5));
    expect(hover).toBeDefined();
    const md = (hover!.contents as any[])[0].value as string;
    expect(md).toContain('data:image/svg+xml;base64,');
    expect(md).toContain('width="256"');
    expect(md).toContain('ic_banner.xml');
  });

  it('returns undefined for hover on a non-vector line (e.g. <path>)', () => {
    const doc = makeDoc(VECTOR_XML);
    // <path> sits on line 6.
    const hover = provider.provideHover(doc, new Position(6, 5));
    expect(hover).toBeUndefined();
  });

  it('returns undefined for non-vector drawable XML (selector)', () => {
    const doc = makeDoc(NON_VECTOR_XML);
    const hover = provider.provideHover(doc, new Position(1, 5));
    expect(hover).toBeUndefined();
  });

  it('returns undefined for files outside `res/drawable*/`', () => {
    const doc = makeDoc(VECTOR_XML, { path: '/project/build.xml' });
    const hover = provider.provideHover(doc, new Position(1, 5));
    expect(hover).toBeUndefined();
  });

  it('returns undefined for non-XML language', () => {
    const doc = makeDoc(VECTOR_XML, { lang: 'kotlin' });
    const hover = provider.provideHover(doc, new Position(1, 5));
    expect(hover).toBeUndefined();
  });

  it('drawable-v24 / drawable-night / mipmap-xxhdpi all match the path filter', () => {
    for (const dir of ['drawable-v24', 'drawable-night', 'drawable-xxhdpi']) {
      const doc = makeDoc(VECTOR_XML, { path: `/project/res/${dir}/ic.xml` });
      const hover = provider.provideHover(doc, new Position(1, 5));
      expect(hover, `expected match for ${dir}`).toBeDefined();
    }
  });
});

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

  it('resolveCodeLens with 0 references → unclickable "No references" lens', async () => {
    const doc = makeDoc(VECTOR_XML);
    const [, placeholder] = lens.provideCodeLenses(doc) as any[];
    const resolved = await lens.resolveCodeLens(
      placeholder,
      { isCancellationRequested: false } as any,
    );
    expect(resolved).toBeDefined();
    expect(resolved!.command!.title).toBe('No references');
    // Empty command id → VS Code renders the lens as static text.
    expect(resolved!.command!.command).toBe('');
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
    expect(resolved!.command!.command).toBe('editor.action.showReferences');
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
