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
    selections: cursorLine >= 0 ? [{ active: { line: cursorLine } }] : [],
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
