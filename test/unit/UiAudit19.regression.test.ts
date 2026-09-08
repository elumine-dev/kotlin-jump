import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { Position } from './__mocks__/vscode';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinHoverProvider } from '../../src/providers/HoverProvider';
import { onlineDocsUrl } from '../../src/providers/OnlineDocsFallback';
import { extractKDocFromLines, formatKDoc, readSignature } from '../../src/util/SignatureReader';
import { SourcesStatusBar } from '../../src/ui/SourcesStatusBar';
import { registerLogcat } from '../../src/logcat/index';
import { registerAndroidRunCommand } from '../../src/commands/AndroidRunCommand';
import { mockDocument, positionOf } from './helpers';
import * as fs from 'node:fs';

// Audit 19 : activation, commandes, hover, docs en ligne, lecteur de signature.

afterEach(() => vi.restoreAllMocks());
const token = { isCancellationRequested: false } as any;
let _id = 0;
const fresh = () => `file:///A19_${_id++}.kt`;

function indexOf(files: Record<string, string>) {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(files)) index.add(parse(uri, code));
  index.finalize();
  return index;
}
const hoverText = (h: any) => (h?.contents ?? []).map((c: any) => c.value).join('\n---\n');

describe('Hover', () => {
  it('liste les sous-types sealed déclarés hors du corps et dans un autre fichier', async () => {
    const a = fresh(), b = fresh();
    const codeA = 'package p\nsealed class Result {\n    data class Ok(val v: Int) : Result()\n    companion object { val TAG = "r" }\n}\ndata class Err(val e: String) : Result()\nobject Loading : Result()\nsealed interface UiState\nobject Idle : UiState\n';
    const codeB = 'package p\nclass Remote : Result()\nclass Shown : UiState\n';
    const index = indexOf({ [a]: codeA, [b]: codeB });
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockImplementation(async (u: any) => mockDocument(u.toString(), u.toString() === a ? codeA : codeB) as any);
    const doc = mockDocument(a, codeA);
    const h = await new KotlinHoverProvider(index).provideHover(doc, new Position(1, 15), token);
    const text = hoverText(h);
    expect(text).toContain('**Subtypes** *(4)*');
    for (const n of ['Ok', 'Err', 'Loading', 'Remote']) expect(text).toContain(`\`${n}\``);
    expect(text).not.toContain('Companion');
    const h2 = await new KotlinHoverProvider(index).provideHover(doc, new Position(7, 20), token);
    expect(hoverText(h2)).toContain('**Subtypes** *(2)*');
  });

  it('lit la KDoc à la ligne relocalisée quand le document est modifié', async () => {
    const uri = fresh();
    const original = 'package p\n/** Doc of A. */\nfun alpha() = 1\n/** Doc of B. */\nfun beta() = 2\n';
    const index = indexOf({ [uri]: original });
    const dirty = 'package p\nimport x.A\nimport x.B\nimport x.C\n' + original.slice('package p\n'.length);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(uri, dirty) as any);
    const call = fresh();
    const callCode = 'package p\nval r = beta()';
    index.add(parse(call, callCode));
    index.finalize();
    const h = await new KotlinHoverProvider(index).provideHover(mockDocument(call, callCode), new Position(1, 8), token);
    const text = hoverText(h);
    expect(text).toContain('fun beta()');
    expect(text).toContain('Doc of B.');
    expect(text).not.toContain('Doc of A.');
  });

  it('un import explicite vers une cible non indexée bloque le repli par nom ; une ligne d\'import ne survole rien', async () => {
    const other = fresh(), cur = fresh();
    const otherCode = 'package com.other\nfun format(x: Int) = x\nclass util\n';
    const curCode = 'package com.app\nimport com.example.util.format\nval s = format(1)\n';
    const index = indexOf({ [other]: otherCode, [cur]: curCode });
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(other, otherCode) as any);
    const doc = mockDocument(cur, curCode);
    const p = new KotlinHoverProvider(index);
    expect(await p.provideHover(doc, new Position(2, 9), token)).toBeNull();
    expect(await p.provideHover(doc, new Position(1, 20), token)).toBeNull();
  });
});

describe('Docs en ligne', () => {
  it('une fonction Dokka est une page, un type un dossier', () => {
    expect(onlineDocsUrl('kotlinx.coroutines.launch')).toBe('https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/launch.html');
    expect(onlineDocsUrl('kotlinx.coroutines.flow.map')).toBe('https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/map.html');
    expect(onlineDocsUrl('kotlinx.coroutines.flow.StateFlow')).toBe('https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/');
  });

  it('un composable appelé pointe sur l\'ancre du package, un type Compose sur sa page', () => {
    expect(onlineDocsUrl('androidx.compose.material3.Text', true)).toBe('https://developer.android.com/reference/kotlin/androidx/compose/material3/package-summary#Text');
    expect(onlineDocsUrl('androidx.compose.ui.Modifier')).toBe('https://developer.android.com/reference/kotlin/androidx/compose/ui/Modifier');
  });
});

describe('Lecteur de signature et KDoc', () => {
  it('du code commenté, un region ou un TODO ne sont pas une documentation', () => {
    expect(extractKDocFromLines(['// val old = 3', 'fun f() = 1'], 1)).toBeNull();
    expect(extractKDocFromLines(['// region Helpers', 'fun f() = 1'], 1)).toBeNull();
    expect(extractKDocFromLines(['// TODO remove', 'fun f() = 1'], 1)).toBeNull();
    expect(extractKDocFromLines(['// Adds two numbers.', 'fun f() = 1'], 1)).toBe('Adds two numbers.');
  });

  it('une annotation multi-lignes entre la KDoc et la déclaration ne cache pas la KDoc', () => {
    const lines = ['/** Loads the user. */', '@Suppress(', '    "UNCHECKED_CAST"', ')', 'fun load() = 1'];
    expect(extractKDocFromLines(lines, 4)).toBe('Loads the user.');
  });

  it('@property est rendu comme @param et un `*/` final est retiré', () => {
    expect(formatKDoc(['Holder.', '@property id The id'])).toContain('- `id`: The id');
    expect(extractKDocFromLines(['/**', ' * First', ' * bar */', 'fun f() = 1'], 3)).toBe('First\nbar');
  });

  it('la signature d\'une entrée d\'enum est son seul segment et une clause where est conservée', () => {
    const uri = fresh();
    const code = 'package p\nenum class Color { RED, GREEN(1), BLUE }\nfun <T> sort(items: List<T>): List<T>\n    where T : Comparable<T> {\n    return items\n}\n';
    const index = indexOf({ [uri]: code });
    const doc = mockDocument(uri, code);
    const entries = index.getFileSymbols(uri);
    expect(readSignature(doc, entries.find(e => e.name === 'GREEN')!)).toBe('GREEN(1)');
    expect(readSignature(doc, entries.find(e => e.name === 'RED')!)).toBe('RED');
    expect(readSignature(doc, entries.find(e => e.name === 'sort')!)).toBe('fun <T> sort(items: List<T>): List<T>\n    where T : Comparable<T>');
  });
});

describe('Activation et câblage', () => {
  it('la barre des sources démarre en état « scanning »', () => {
    expect(new SourcesStatusBar().getState().scanning).toBe(true);
  });

  it('Logcat et Android Run désactivés enregistrent quand même leurs commandes', () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (k: string, d: unknown) => (k === 'logcat.enabled' || k === 'androidRunEnabled') ? false : d,
      update: async () => undefined,
    } as any);
    const registered: string[] = [];
    vi.spyOn(vscodeMock.commands, 'registerCommand').mockImplementation(((id: string) => { registered.push(id); return { dispose() {} }; }) as any);
    const context = { subscriptions: [], workspaceState: { get: () => undefined, update: async () => undefined }, extensionUri: { toString: () => 'file:///ext' } } as any;
    const log = { info() {}, warn() {}, debug() {}, error() {} } as any;
    registerLogcat(context, log, new SymbolIndex());
    registerAndroidRunCommand(context, log);
    for (const id of ['kotlinJump.logcat.show', 'kotlinJump.logcat.pickDevice', 'kotlin-jump.runAndroid', 'kotlin-jump.pairAdbWifi', 'kotlin-jump.pickGradleProject']) {
      expect(registered).toContain(id);
    }
  });

  it('package.json : vues Logcat conditionnées, commandes internes hors palette, activation sur Java', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const views = pkg.contributes.views.kotlinJumpLogcat;
    for (const v of views) expect(v.when).toContain('kotlinJump.logcat.enabled');
    const hidden = pkg.contributes.menus.commandPalette.map((m: any) => m.command);
    for (const c of ['kotlin-jump.debugTest', 'kotlin-jump.runTest', 'kotlin-jump.findUsages.toggleTests', 'kotlin-jump.sources.downloadMissing']) expect(hidden).toContain(c);
    expect(pkg.activationEvents).toContain('onLanguage:java');
    expect(pkg.activationEvents).toContain('workspaceContains:**/*.java');
    const declared = new Set(pkg.contributes.commands.map((c: any) => c.command));
    for (const c of hidden) expect(declared.has(c)).toBe(true);
  });
});
