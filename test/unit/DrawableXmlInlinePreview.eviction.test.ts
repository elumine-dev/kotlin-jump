import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DrawableXmlInlinePreviewProvider } from '../../src/providers/DrawableXmlInlinePreviewProvider';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const VECTOR = (fill: string) => `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:pathData="M0,0h24v24H0z" android:fillColor="${fill}"/>
</vector>`;

function fakeEditor(text: string) {
  const lines = text.split('\n');
  return {
    document: {
      languageId: 'xml',
      uri: vscode.Uri.parse('file:///work/app/src/main/res/drawable/ic_test.xml'),
      getText: () => text,
      positionAt: (offset: number) => {
        let line = 0, rest = offset;
        while (line < lines.length && rest > lines[line]!.length) { rest -= lines[line]!.length + 1; line++; }
        return new vscode.Position(line, rest);
      },
    },
    setDecorations: () => {},
  } as unknown as vscode.TextEditor;
}

describe('DrawableXmlInlinePreviewProvider — decoration types are released (was: one TextEditorDecorationType and one cache file per keystroke, for the whole session)', () => {
  const originalVisible = (vscode.window as any).visibleTextEditors;
  const created: { disposed: boolean }[] = [];
  const originalCreate = (vscode.window as any).createTextEditorDecorationType;
  (vscode.window as any).createTextEditorDecorationType = () => {
    const t = { disposed: false, dispose() { t.disposed = true; } };
    created.push(t);
    return t;
  };
  afterEach(() => {
    (vscode.window as any).visibleTextEditors = originalVisible;
    (vscode.window as any).createTextEditorDecorationType = originalCreate;
  });

  it('keeps one type per SVG still on screen and disposes the rest, cache files included', async () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-inline-'));
    const provider = new DrawableXmlInlinePreviewProvider(vscode.Uri.file(storage));
    const cacheDir = path.join(storage, 'vector-xml-preview');

    for (const fill of ['#F00', '#0F0', '#00F', '#FF0']) {
      (vscode.window as any).visibleTextEditors = [fakeEditor(VECTOR(fill))];
      await provider._flushNow();
    }
    expect(provider._liveTypeCount()).toBe(1);
    expect(created.filter(t => t.disposed)).toHaveLength(3);
    expect(fs.readdirSync(cacheDir)).toHaveLength(1);

    (vscode.window as any).visibleTextEditors = [];
    await provider._flushNow();
    expect(provider._liveTypeCount()).toBe(0);
    expect(fs.readdirSync(cacheDir)).toHaveLength(0);
    provider.dispose();
  });
});
