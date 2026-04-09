import { describe, it, expect } from 'vitest';
import { Position, Range } from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { StringResourceHoverProvider } from '../../src/providers/StringResourceHoverProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlUri(path: string) {
  return { toString: () => path };
}

function makeDocument(lines: string[], languageId = 'kotlin') {
  return {
    languageId,
    lineAt: (i: number) => ({ text: lines[i] }),
  } as any;
}

function buildProvider(xmlContent: string, uriPath = 'file:///project/src/main/res/values/strings.xml') {
  const index = new StringResourceIndex();
  index.reindexFile(xmlUri(uriPath), xmlContent);
  return new StringResourceHoverProvider(index);
}

// ── Basic hover ───────────────────────────────────────────────────────────────

describe('StringResourceHoverProvider — basic', () => {
  it('returns a Hover for a known key when cursor is on the token', () => {
    const provider = buildProvider(
      `<resources><string name="app_name">My App</string></resources>`,
    );
    const line = 'val x = R.string.app_name';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.app_name') + 5);

    const hover = provider.provideHover(doc, pos);

    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toContain('My App');
  });

  it('returns undefined for an unknown key', () => {
    const provider = buildProvider(
      `<resources><string name="other">Other</string></resources>`,
    );
    const line = 'val x = R.string.missing';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.missing') + 5);

    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });

  it('returns undefined when cursor is outside the token', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const doc  = makeDocument([line]);
    // Cursor at position 0, well before R.string.foo
    const pos  = new Position(0, 0);

    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });

  it('returns undefined for non-Kotlin/Java files', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'R.string.foo';
    const doc  = makeDocument([line], 'xml');
    const pos  = new Position(0, 5);

    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });

  it('works for Java files', () => {
    const provider = buildProvider(
      `<resources><string name="label">Label</string></resources>`,
    );
    const line = 'int id = R.string.label;';
    const doc  = makeDocument([line], 'java');
    const pos  = new Position(0, line.indexOf('R.string.label') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover).toBeDefined();
  });
});

// ── Full value (no truncation) ────────────────────────────────────────────────

describe('StringResourceHoverProvider — full value', () => {
  it('shows the full value even when longer than 40 characters', () => {
    const longValue = 'This is a very long string value that exceeds forty characters easily';
    const provider  = buildProvider(
      `<resources><string name="long_text">${longValue}</string></resources>`,
    );
    const line = 'val s = R.string.long_text';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.long_text') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover!.contents[0].value).toContain(longValue);
    expect(hover!.contents[0].value).not.toContain('…');
  });
});

// ── Hover range ───────────────────────────────────────────────────────────────

describe('StringResourceHoverProvider — range', () => {
  it('range covers exactly the R.string.foo token', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.foo') + 3);

    const hover = provider.provideHover(doc, pos);
    const range: Range = hover!.range as Range;

    const tokenStart = line.indexOf('R.string.foo');
    const tokenEnd   = tokenStart + 'R.string.foo'.length;
    expect(range.start.line).toBe(0);
    expect(range.start.character).toBe(tokenStart);
    expect(range.end.character).toBe(tokenEnd);
  });
});

// ── Source file path in tooltip ───────────────────────────────────────────────

describe('StringResourceHoverProvider — source path', () => {
  it('shows res-relative path when URI contains /res/', () => {
    const provider = buildProvider(
      `<resources><string name="title">Title</string></resources>`,
      'file:///project/src/main/res/values/strings.xml',
    );
    const line = 'val t = R.string.title';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.title') + 5);

    const hover   = provider.provideHover(doc, pos);
    const mdValue = hover!.contents[0].value;

    expect(mdValue).toContain('res/values/strings.xml');
    expect(mdValue).toContain('title');
  });

  it('falls back to last two path segments when /res/ is absent', () => {
    const provider = buildProvider(
      `<resources><string name="hello">Hello</string></resources>`,
      'kotlin-jar:///some/weird/path/values/strings.xml',
    );
    const line = 'val h = R.string.hello';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.hello') + 5);

    const hover   = provider.provideHover(doc, pos);
    const mdValue = hover!.contents[0].value;

    expect(mdValue).toContain('values/strings.xml');
  });

  it('includes the 1-based line number of the XML entry', () => {
    const provider = buildProvider(`<resources>
  <string name="second">Second</string>
</resources>`);
    const line = 'val s = R.string.second';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.second') + 5);

    const hover   = provider.provideHover(doc, pos);
    const mdValue = hover!.contents[0].value;

    // "second" is on line index 1 (0-based) → displayed as :2
    expect(mdValue).toContain(':2');
  });
});

// ── Multiple tokens on the same line ─────────────────────────────────────────

describe('StringResourceHoverProvider — multiple tokens', () => {
  it('returns hover for the correct token when multiple are on the same line', () => {
    const provider = buildProvider(`<resources>
  <string name="ok">OK</string>
  <string name="cancel">Cancel</string>
</resources>`);
    const line = 'setText(R.string.ok, R.string.cancel)';
    const doc  = makeDocument([line]);

    const posOk     = new Position(0, line.indexOf('R.string.ok') + 5);
    const posCancel = new Position(0, line.indexOf('R.string.cancel') + 5);

    const hoverOk     = provider.provideHover(doc, posOk);
    const hoverCancel = provider.provideHover(doc, posCancel);

    expect(hoverOk!.contents[0].value).toContain('OK');
    expect(hoverCancel!.contents[0].value).toContain('Cancel');
  });

  it('returns hover for a known token that follows an unknown token on the same line', () => {
    const provider = buildProvider(`<resources>
  <string name="ok">OK</string>
</resources>`);
    const line = 'setText(R.string.missing, R.string.ok)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.ok') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toContain('OK');
  });
});

// ── Adversarial — range boundary ─────────────────────────────────────────────

describe('StringResourceHoverProvider — range boundary (adversarial)', () => {
  it('shows hover when cursor is at the first character of the token (start)', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const doc  = makeDocument([line]);
    const tokenStart = line.indexOf('R.string.foo');
    const pos = new Position(0, tokenStart); // exactly at start

    expect(provider.provideHover(doc, pos)).toBeDefined();
  });

  it('shows hover when cursor is at the last character of the token (end - 1)', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const doc  = makeDocument([line]);
    const tokenStart  = line.indexOf('R.string.foo');
    const tokenLength = 'R.string.foo'.length;
    const pos = new Position(0, tokenStart + tokenLength - 1); // last char

    expect(provider.provideHover(doc, pos)).toBeDefined();
  });

  it('does NOT show hover when cursor is at position end (one past the token) — BUG A', () => {
    const provider = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const doc  = makeDocument([line]);
    const tokenStart  = line.indexOf('R.string.foo');
    const tokenLength = 'R.string.foo'.length;
    const pos = new Position(0, tokenStart + tokenLength); // one past end

    // BUG A: currently returns hover (> instead of >=). Should be undefined.
    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });
});

// ── Adversarial — URI path resolution ────────────────────────────────────────

describe('StringResourceHoverProvider — URI path resolution (adversarial)', () => {
  it('uses the LAST /res/ occurrence when multiple appear in the URI — BUG B', () => {
    // Realistic: developer has a folder named 'res' earlier in the path
    const provider = buildProvider(
      `<resources><string name="title">Title</string></resources>`,
      'file:///home/user/res/myapp/src/main/res/values/strings.xml',
    );
    const line = 'val t = R.string.title';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.title') + 5);

    const hover   = provider.provideHover(doc, pos);
    const mdValue = hover!.contents[0].value;

    // BUG B: indexOf picks up the first /res/ → wrong path
    expect(mdValue).toContain('res/values/strings.xml');
    expect(mdValue).not.toContain('res/myapp/src/main/res/values/strings.xml');
  });

  it('falls back gracefully when URI has only one path segment', () => {
    const provider = buildProvider(
      `<resources><string name="x">X</string></resources>`,
      'strings.xml',
    );
    const line = 'val x = R.string.x';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.x') + 5);

    // Should not crash; fallback returns last segment(s)
    expect(() => provider.provideHover(doc, pos)).not.toThrow();
    expect(provider.provideHover(doc, pos)).toBeDefined();
  });
});

// ── Adversarial — value edge cases ───────────────────────────────────────────

describe('StringResourceHoverProvider — value edge cases (adversarial)', () => {
  it('shows hover for an empty string value without crashing', () => {
    const provider = buildProvider(
      `<resources><string name="empty"></string></resources>`,
    );
    const line = 'val e = R.string.empty';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.empty') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover).toBeDefined();
  });

  it('shows unescaped XML entities in hover (index already unescapes them)', () => {
    const provider = buildProvider(
      `<resources><string name="amp">A &amp; B</string></resources>`,
    );
    const line = 'val s = R.string.amp';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.amp') + 5);

    const hover   = provider.provideHover(doc, pos);
    const mdValue = hover!.contents[0].value;
    expect(mdValue).toContain('A & B');
    expect(mdValue).not.toContain('&amp;');
  });

  it('two successive calls produce independent results (no regex state leak)', () => {
    const provider = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
</resources>`);
    const lineA = 'val a = R.string.a';
    const lineB = 'val b = R.string.b';
    const docA  = makeDocument([lineA]);
    const docB  = makeDocument([lineB]);

    const hoverA = provider.provideHover(docA, new Position(0, lineA.indexOf('R.string.a') + 5));
    const hoverB = provider.provideHover(docB, new Position(0, lineB.indexOf('R.string.b') + 5));

    expect(hoverA!.contents[0].value).toContain('A');
    expect(hoverB!.contents[0].value).toContain('B');
  });
});
