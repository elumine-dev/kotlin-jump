/**
 * DeprecationHoverProvider — message @Deprecated + ReplaceWith au hover
 *
 * Vecteurs :
 *   DH-1  Symbole déprécié avec message une ligne → hover message + ReplaceWith
 *   DH-2  Annotation multi-ligne (message et ReplaceWith sur leurs lignes) → extraits
 *   DH-3  Symbole non déprécié → null
 *   DH-4  Homonymes dont un seul déprécié, sans import → null (pas de faux banner)
 *   DH-5  Fichier de déclaration illisible → hover minimal (flag seul)
 *   DH-6  Message avec quotes échappées → déséchappé
 *   DH-7  @Deprecated sans message → hover minimal
 *   DH-8  Named args : message = "...", replaceWith = ReplaceWith("...")
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { DeprecationHoverProvider } from '../../src/providers/DeprecationHoverProvider';

const DECL_URI = 'file:///src/main/kotlin/com/example/Api.kt';
const CALL_URI = 'file:///src/main/kotlin/com/example/Caller.kt';

let declLines: string[] = [];
const realOpen = (vscode.workspace as any).openTextDocument;

beforeEach(() => {
  (vscode.workspace as any).openTextDocument = async (uri: any) => {
    if (String(uri) !== DECL_URI) return null;
    return {
      lineCount: declLines.length,
      lineAt: (n: number) => ({ text: declLines[n] }),
    };
  };
});
afterEach(() => { (vscode.workspace as any).openTextDocument = realOpen; });

let docVersion = 0;

function makeCallerDoc(code: string): vscode.TextDocument {
  const lines = code.split('\n');
  return {
    uri: vscode.Uri.parse(CALL_URI),
    languageId: 'kotlin',
    // ImportResolver caches per (uri, version) — real VS Code bumps version
    // on every edit, so each fake doc gets a fresh one.
    version: ++docVersion,
    lineCount: lines.length,
    getText: (range?: any) => range
      ? lines[range.start.line].slice(range.start.character, range.end.character)
      : code,
    lineAt: (n: number) => ({ text: lines[n] }),
    getWordRangeAtPosition: (pos: any) => {
      const text = lines[pos.line];
      let s = pos.character, e = pos.character;
      while (s > 0 && /\w/.test(text[s - 1])) s--;
      while (e < text.length && /\w/.test(text[e])) e++;
      if (s === e) return undefined;
      return new vscode.Range(pos.line, s, pos.line, e);
    },
  } as unknown as vscode.TextDocument;
}

function setup(declSource: string): { index: SymbolIndex; provider: DeprecationHoverProvider } {
  declLines = declSource.split('\n');
  const index = new SymbolIndex();
  index.add(parse(DECL_URI, declSource));
  return { index, provider: new DeprecationHoverProvider(index) };
}

async function hover(
  provider: DeprecationHoverProvider,
  callerCode: string,
  word: string,
): Promise<string> {
  const doc = makeCallerDoc(callerCode);
  const line = callerCode.split('\n').findIndex(l => l.includes(word));
  const ch = callerCode.split('\n')[line].indexOf(word) + 1;
  const h = await provider.provideHover(doc, new vscode.Position(line, ch) as any);
  if (!h) return '';
  const md = h.contents as any;
  return Array.isArray(md) ? md.map(m => m.value ?? m).join('') : (md.value ?? String(md));
}

const CALLER = 'import com.example.fetch\n\nfun main() { fetch(7) }';

describe('DH-1 — annotation une ligne', () => {
  it('message et ReplaceWith extraits', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated("Use fetchV2", ReplaceWith("fetchV2(id)"))',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Deprecated');
    expect(text).toContain('Use fetchV2');
    expect(text).toContain('fetchV2(id)');
  });
});

describe('DH-2 — annotation multi-ligne', () => {
  it('les arguments répartis sur plusieurs lignes sont extraits', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated(',
      '    message = "Use fetchV2 instead",',
      '    replaceWith = ReplaceWith("fetchV2(id)")',
      ')',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Use fetchV2 instead');
    expect(text).toContain('fetchV2(id)');
  });
});

describe('DH-3 — non déprécié', () => {
  it('hover null', async () => {
    const { provider } = setup('package com.example\nfun fetch(id: Int) {}');
    expect(await hover(provider, CALLER, 'fetch')).toBe('');
  });
});

describe('DH-4 — homonymes ambigus', () => {
  it('deux fetch sans import discriminant → null', async () => {
    declLines = 'package com.example\n@Deprecated("old")\nfun fetch(id: Int) {}'.split('\n');
    const index = new SymbolIndex();
    index.add(parse(DECL_URI, declLines.join('\n')));
    index.add(parse('file:///other/Util.kt', 'package com.other\nfun fetch(x: Int) {}'));
    const provider = new DeprecationHoverProvider(index);
    // Caller sans import : résolution ambiguë
    expect(await hover(provider, 'fun main() { fetch(7) }', 'fetch')).toBe('');
  });
});

describe('DH-5 — fichier illisible', () => {
  it('hover minimal avec le flag seul', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated("Use fetchV2")',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    (vscode.workspace as any).openTextDocument = async () => { throw new Error('gone'); };
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Deprecated');
    expect(text).not.toContain('Use fetchV2');
  });
});

describe('DH-6 — quotes échappées', () => {
  it('le message est déséchappé', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated("Use \\"fetchV2\\" now")',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Use "fetchV2" now');
  });
});

describe('DH-7 — @Deprecated nu', () => {
  it('hover minimal sans message', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Deprecated');
    expect(text).toContain('fetch');
  });
});

describe('DH-8 — arguments nommés', () => {
  it('message = et replaceWith = reconnus', async () => {
    const { provider } = setup([
      'package com.example',
      '@Deprecated(message = "Old API", replaceWith = ReplaceWith("newApi()"))',
      'fun fetch(id: Int) {}',
    ].join('\n'));
    const text = await hover(provider, CALLER, 'fetch');
    expect(text).toContain('Old API');
    expect(text).toContain('newApi()');
  });
});
