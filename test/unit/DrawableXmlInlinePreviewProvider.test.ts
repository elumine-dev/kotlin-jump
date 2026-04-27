/**
 * Tests for DrawableXmlInlinePreviewProvider — inline hover preview of
 * `<vector>` drawables when their source XML is open.
 */
import { describe, it, expect } from 'vitest';
import { DrawableXmlInlinePreviewProvider } from '../../src/providers/DrawableXmlInlinePreviewProvider';
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

describe('DrawableXmlInlinePreviewProvider', () => {
  const provider = new DrawableXmlInlinePreviewProvider();

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
