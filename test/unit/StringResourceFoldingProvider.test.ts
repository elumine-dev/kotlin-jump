import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { StringResourceFoldingProvider } from '../../src/providers/StringResourceFoldingProvider';
import { NullLogger } from '../../src/util/logger';
import { Range } from './__mocks__/vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlUri(path: string) {
  return { toString: () => path };
}

const DEFAULT_XML = xmlUri('file:///res/values/strings.xml');

function makeEditor(lines: string[], languageId = 'kotlin', cursorLine = -1) {
  const setDecorations = vi.fn();
  return {
    document: {
      languageId,
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    selections: cursorLine >= 0
      ? [{ active: { line: cursorLine }, start: { line: cursorLine }, end: { line: cursorLine } }]
      : [],
    setDecorations,
  } as any;
}

function setupMocks() {
  const decorationType = { dispose: vi.fn() };
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue(decorationType as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  return { decorationType };
}

function buildProvider(xmlContent: string) {
  const { decorationType } = setupMocks();
  const index = new StringResourceIndex();
  index.reindexFile(DEFAULT_XML, xmlContent);
  const provider = new StringResourceFoldingProvider(index, new NullLogger());
  return { provider, decorationType };
}

afterEach(() => vi.restoreAllMocks());

// ── Core decoration logic ─────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — decoration', () => {
  it('decorates R.string.foo on a line without cursor', () => {
    const { provider } = buildProvider(
      `<resources><string name="app_name">My App</string></resources>`,
    );
    const editor = makeEditor(['val x = R.string.app_name'], 'kotlin', -1);

    provider.invalidateAll();
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(1);
    expect(decorations[0].renderOptions.before.contentText).toBe('"My App"');
  });

  it('skips the line when cursor is on it (cursor-reveal)', () => {
    const { provider } = buildProvider(
      `<resources><string name="title">Title</string></resources>`,
    );
    const editor = makeEditor(['val t = R.string.title'], 'kotlin', 0);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });

  it('does not decorate R.string.missing when key is absent from index', () => {
    const { provider } = buildProvider(
      `<resources><string name="other">Other</string></resources>`,
    );
    const editor = makeEditor(['val x = R.string.missing'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });

  it('decorates multiple references on the same line', () => {
    const { provider } = buildProvider(`<resources>
  <string name="ok">OK</string>
  <string name="cancel">Cancel</string>
</resources>`);
    const editor = makeEditor(['setText(R.string.ok, R.string.cancel)'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(2);
    expect(decorations[0].renderOptions.before.contentText).toBe('"OK"');
    expect(decorations[1].renderOptions.before.contentText).toBe('"Cancel"');
  });

  it('decorates R.string refs in Java files', () => {
    const { provider } = buildProvider(
      `<resources><string name="label">Label</string></resources>`,
    );
    const editor = makeEditor(['int id = R.string.label;'], 'java', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(1);
  });

  it('skips non-Kotlin/Java files', () => {
    const { provider } = buildProvider(
      `<resources><string name="label">Label</string></resources>`,
    );
    const editor = makeEditor(['R.string.label'], 'xml', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    // setDecorations should NOT have been called for xml files
    expect(editor.setDecorations).not.toHaveBeenCalled();
  });
});

// ── Value truncation ──────────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — truncation', () => {
  it('truncates values longer than MAX_LABEL_LEN (40) with ellipsis', () => {
    const longValue = 'A'.repeat(41);
    const { provider } = buildProvider(
      `<resources><string name="long">${longValue}</string></resources>`,
    );
    const editor = makeEditor(['val x = R.string.long'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations[0].renderOptions.before.contentText).toBe(`"${'A'.repeat(40)}…"`);
  });

  it('does not truncate a 40-character value', () => {
    const exactValue = 'B'.repeat(40);
    const { provider } = buildProvider(
      `<resources><string name="exact">${exactValue}</string></resources>`,
    );
    const editor = makeEditor(['val x = R.string.exact'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations[0].renderOptions.before.contentText).toBe(`"${exactValue}"`);
  });
});

// ── Setting disabled ──────────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — setting disabled', () => {
  it('clears decorations when stringResourceFolding = false', () => {
    setupMocks();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => {
        if (key === 'stringResourceFolding') return false;
        return def;
      },
    } as any);

    const index = new StringResourceIndex();
    index.reindexFile(DEFAULT_XML, `<resources><string name="x">X</string></resources>`);
    const provider = new StringResourceFoldingProvider(index, new NullLogger());

    const editor = makeEditor(['val x = R.string.x'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });
});

// ── Decoration range ──────────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — range', () => {
  it('range covers exactly R.string.foo token', () => {
    const { provider } = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const line = 'val x = R.string.foo + y';
    const editor = makeEditor([line], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    const range: Range = decorations[0].range;
    const tokenStart = line.indexOf('R.string.foo');
    const tokenEnd   = tokenStart + 'R.string.foo'.length;
    expect(range.start.line).toBe(0);
    expect(range.start.character).toBe(tokenStart);
    expect(range.end.character).toBe(tokenEnd);
  });
});

// ── Dispose ───────────────────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — dispose', () => {
  it('disposes decoration type on dispose()', () => {
    const { provider, decorationType } = buildProvider('');
    provider.dispose();
    expect(decorationType.dispose).toHaveBeenCalled();
  });
});

// ── Selection-range reveal ────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — selection-range reveal', () => {
  it('reveals all lines covered by a multi-line selection', () => {
    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
  <string name="c">C</string>
  <string name="d">D</string>
</resources>`);
    // Lines 0–2 selected → revealed; line 3 not covered → decorated
    const editor = {
      document: {
        languageId: 'kotlin',
        lineCount: 4,
        lineAt: (i: number) => ({ text: ['R.string.a', 'R.string.b', 'R.string.c', 'R.string.d'][i] }),
      },
      selections: [{ active: { line: 2 }, start: { line: 0 }, end: { line: 2 } }],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.start.line).toBe(3);
  });

  it('reveals lines for all cursors in multi-cursor mode', () => {
    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
  <string name="c">C</string>
</resources>`);
    // Cursors on lines 0 and 2 → line 1 is the only one decorated
    const editor = {
      document: {
        languageId: 'kotlin',
        lineCount: 3,
        lineAt: (i: number) => ({ text: ['R.string.a', 'R.string.b', 'R.string.c'][i] }),
      },
      selections: [
        { active: { line: 0 }, start: { line: 0 }, end: { line: 0 } },
        { active: { line: 2 }, start: { line: 2 }, end: { line: 2 } },
      ],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.start.line).toBe(1);
  });
});

// ── Adversarial — regex matching edge cases ───────────────────────────────────

describe('StringResourceFoldingProvider — regex edge cases (adversarial)', () => {
  it('does NOT decorate R.strings.foo (plural — not a valid R.string reference)', () => {
    const { provider } = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    const editor = makeEditor(['val x = R.strings.foo'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });

  it('decorates R.string._privateKey (leading underscore is valid)', () => {
    const { provider } = buildProvider(
      `<resources><string name="_private">Secret</string></resources>`,
    );
    const editor = makeEditor(['val x = R.string._private'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(1);
    expect(decorations[0].renderOptions.before.contentText).toBe('"Secret"');
  });

  it('does NOT decorate a key starting with a digit (invalid identifier start)', () => {
    const { provider } = buildProvider(
      `<resources><string name="foo">Foo</string></resources>`,
    );
    // R.string.1foo cannot be an Android resource name — regex should not match
    const editor = makeEditor(['val x = R.string.1foo'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });
});

// ── Adversarial — selection edge cases ───────────────────────────────────────

describe('StringResourceFoldingProvider — selection edge cases (adversarial)', () => {
  it('handles a reversed mock selection (start.line > end.line) via Math.min/max', () => {
    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
  <string name="c">C</string>
</resources>`);
    // Inverted selection: start=2, end=0 (bottom-to-top drag)
    const editor = {
      document: {
        languageId: 'kotlin',
        lineCount: 3,
        lineAt: (i: number) => ({ text: ['R.string.a', 'R.string.b', 'R.string.c'][i] }),
      },
      selections: [{ active: { line: 0 }, start: { line: 2 }, end: { line: 0 } }],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    // All 3 lines should be revealed (lines 0–2 via Math.min/max)
    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });

  it('reveals all lines when selection covers the entire file (0 decorations)', () => {
    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
</resources>`);
    const lines = ['R.string.a', 'R.string.b'];
    const editor = {
      document: {
        languageId: 'kotlin',
        lineCount: 2,
        lineAt: (i: number) => ({ text: lines[i] }),
      },
      selections: [{ active: { line: 1 }, start: { line: 0 }, end: { line: 1 } }],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(0);
  });
});

// ── Adversarial — invalidateAll edge cases ────────────────────────────────────

describe('StringResourceFoldingProvider — invalidateAll edge cases (adversarial)', () => {
  it('does not crash when visibleTextEditors is empty', () => {
    const { provider } = buildProvider('');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([]);

    expect(() => provider.invalidateAll()).not.toThrow();
  });

  it('decorates lines after the selected range but not those within it', () => {
    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
  <string name="c">C</string>
  <string name="d">D</string>
  <string name="e">E</string>
</resources>`);
    const lines = ['R.string.a', 'R.string.b', 'R.string.c', 'R.string.d', 'R.string.e'];
    const editor = {
      document: {
        languageId: 'kotlin',
        lineCount: 5,
        lineAt: (i: number) => ({ text: lines[i] }),
      },
      // Lines 0–2 selected, lines 3–4 free
      selections: [{ active: { line: 2 }, start: { line: 0 }, end: { line: 2 } }],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();

    const [, decorations] = editor.setDecorations.mock.lastCall!;
    expect(decorations).toHaveLength(2);
    expect(decorations[0].range.start.line).toBe(3);
    expect(decorations[1].range.start.line).toBe(4);
  });
});

// ── Status bar ────────────────────────────────────────────────────────────────

describe('StringResourceFoldingProvider — status bar', () => {
  it('shows folded count when editor is the active one', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    const { provider } = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
</resources>`);
    const editor = makeEditor(['R.string.a', 'R.string.b'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(editor);
    provider.invalidateAll();

    expect(statusBar.show).toHaveBeenCalled();
    expect(statusBar.text).toBe('$(symbol-string) 2');
  });

  it('does not update status bar for a non-active editor', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    const { provider } = buildProvider(`<resources><string name="a">A</string></resources>`);
    const editor = makeEditor(['R.string.a'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    // activeTextEditor stays undefined → editor is not the active one
    provider.invalidateAll();

    expect(statusBar.show).not.toHaveBeenCalled();
  });

  it('disposes status bar on dispose()', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    const { provider } = buildProvider('');
    provider.dispose();

    expect(statusBar.dispose).toHaveBeenCalled();
  });

  it('shows $(symbol-string) 0 for a kotlin file with no R.string references', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    const { provider } = buildProvider('');
    const editor = makeEditor(['val x = 42', 'println("hello")'], 'kotlin', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(editor);
    provider.invalidateAll();

    expect(statusBar.show).toHaveBeenCalled();
    expect(statusBar.text).toBe('$(symbol-string) 0');
  });

  it('hides status bar when all editors are closed (onDidChangeActiveTextEditor with undefined) — BUG C', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    // Set up all mocks manually (buildProvider calls setupMocks() which would override our spy)
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);

    // Capture the listener — must be set AFTER the above, BEFORE constructing the provider
    let capturedListener: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockImplementation((listener: any) => {
      capturedListener = listener;
      return { dispose: vi.fn() };
    });

    const index = new StringResourceIndex();
    index.reindexFile(DEFAULT_XML, `<resources><string name="x">X</string></resources>`);
    new StringResourceFoldingProvider(index, new NullLogger());

    // Simulate VS Code closing all editors (fires with undefined)
    capturedListener!(undefined);

    expect(statusBar.hide).toHaveBeenCalled();
  });

  it('hides status bar when active editor language is not kotlin/java', () => {
    const statusBar = { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockReturnValue(statusBar as any);

    const { provider } = buildProvider('');
    const editor = makeEditor(['R.string.a'], 'xml', -1);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(editor);
    provider.invalidateAll();

    expect(statusBar.hide).toHaveBeenCalled();
    expect(statusBar.show).not.toHaveBeenCalled();
  });
});
