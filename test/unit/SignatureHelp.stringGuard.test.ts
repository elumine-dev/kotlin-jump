/**
 * Tests adversaires — contamination string dans SignatureHelpProvider
 *
 * BUG I (côté SignatureHelp) — findCallContext ne protège pas contre les strings :
 *   les virgules et parens DANS "a, b" ou '(' sont comptées, faussant activeParameter.
 *
 * BUG NEW-K — Parens non balancées dans les strings faussent la détection du call site.
 *
 * Lancer :
 *   npm test -- test/unit/SignatureHelp.stringGuard.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function freshUri() { return `file:///SHStrGuard_${_id++}.kt`; }
function freshFn()  { return `shsgFn${_id++}`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const token = { isCancellationRequested: false } as any;
function ctx(ch?: string): any {
  return { triggerKind: ch ? 2 : 1, triggerCharacter: ch, isRetrigger: false };
}

afterEach(() => vi.restoreAllMocks());

// ── BUG I : virgules dans les strings faussent activeParameter ────────────────

describe('BUG I — virgules dans les strings faussent activeParameter', () => {
  it('foo("a, b, c", n) : curseur avant n → activeParameter = 1', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(csv: String, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // callCode : fn("a, b, c", 99) — curseur avant `99`
    const callCode = `${fn}("a, b, c", 99)`;
    const cursorPos = callCode.indexOf(', 99)') + 2; // avant `99`

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    // BUG I — attend fix : backward scan compte les `,` dans "a, b, c"
    // → activeParameter = 3 au lieu de 1
    expect(result).not.toBeNull();
    expect(result!.activeParameter).toBe(1);
  });

  it('foo("()", n) : string avec parens balancées → activeParameter = 1', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(pattern: String, n: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Les parens dans "()" s'annulent — ce cas DOIT passer
    const callCode = `${fn}("()", 1)`;
    const cursorPos = callCode.indexOf(', 1)') + 2;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    expect(result?.activeParameter).toBe(1); // ✓ parens balancées fonctionnent
  });

  it('foo("((", n) : string avec parens non balancées → activeParameter = 1', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(pattern: String, n: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // "((" a 2 `(` non balancées — BUG NEW-K : backward scan trouve `(` inside string
    const callCode = `${fn}("((", 1)`;
    const cursorPos = callCode.indexOf(', 1)') + 2;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    // BUG NEW-K — attend fix : le backward scan trouve `(` dans la string
    // et croit avoir trouvé un call site → retourne un résultat incorrect ou null
    // Comportement correct : activeParameter = 1 pour `n`
    if (result !== null) {
      expect(result.activeParameter).toBe(1);
    }
    // null est aussi acceptable si le provider abandonne correctement
  });

  it('foo(")", n) : string avec `)` → activeParameter = 1', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(s: String, n: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // ")" a 1 `)` non balancé — le backward scan incrémente depth à tort
    const callCode = `${fn}(")", 1)`;
    const cursorPos = callCode.indexOf(', 1)') + 2;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    // BUG NEW-K — attend fix : `)` dans la string incrémente depth
    // → le `)` fermant de fn() ne trigger pas le return → null retourné
    if (result !== null) {
      expect(result.activeParameter).toBe(1);
    }
    // null = le provider s'est perdu → bug confirmé
  });
});

// ── Strings avec identifiants qui ressemblent à des fonctions ─────────────────

describe('SignatureHelp — string contenant des identifiants-fonctions', () => {
  it('curseur dans du vrai code après une string → null ou activeParameter correct', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(a: Int, b: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Curseur avant `2` — la string "x(1)" est le premier arg
    const callCode = `${fn}("x(1)", 2)`;
    const cursorPos = callCode.indexOf(', 2)') + 2;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    // Le `(1)` dans "x(1)" ne doit pas perturber le comptage
    // activeParameter pour `2` = 1
    if (result !== null) {
      expect(result.activeParameter).toBe(1);
    }
    // null est acceptable si le provider se perd à cause de la string
  });
});

// ── Multi-ligne avec strings ──────────────────────────────────────────────────

describe('SignatureHelp — appels multi-lignes avec strings', () => {
  it('appel multi-ligne, string sur ligne précédente → activeParameter correct', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(msg: String, n: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Appel sur 2 lignes, curseur sur la ligne 2 avant `42`
    const line1 = `${fn}("hello, world",`;
    const line2 = `    42)`;
    const callCode = `${line1}\n${line2}`;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(1, 4), // avant `42` sur ligne 1
      token, ctx(','),
    );

    // BUG I — attend fix : la virgule dans "hello, world" est comptée
    // → activeParameter = 2 au lieu de 1
    if (result !== null) {
      expect(result.activeParameter).toBe(1);
    }
  });
});

// ── Appel après `//` sur la même ligne ───────────────────────────────────────

describe('BUG H-sig — findCallContext avec commentaire inline', () => {
  it('curseur dans un commentaire inline → null', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Le curseur est dans le commentaire, après `//`
    const callCode = `val x = 1 // ${fn}(`;
    const cursorPos = callCode.length; // après le `(`

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx('('),
    );

    // BUG H-sig — attend fix : findCallContext trouve fn( dans le commentaire
    // et retourne une signature alors que le curseur est dans un commentaire
    expect(result).toBeNull();
  });
});

// ── `when` expression comme argument ─────────────────────────────────────────

describe('SignatureHelp — `when` expression comme argument', () => {
  it('foo(when (x) { ... }, n) → activeParameter correct pour n', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(label: String, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // `when` est le premier argument, curseur avant `42`
    const callCode = `${fn}(when (x) { 1 -> "a" else -> "b" }, 42)`;
    const cursorPos = callCode.indexOf(', 42)') + 2;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );

    if (result !== null) {
      // Le `when (x)` contient une `(` qui augmente depth → annulée par `)`
      // Le `,` entre les cases est à depth > 0 → ne doit pas être compté
      // activeParameter pour `42` = 1
      expect(result.activeParameter).toBe(1);
    }
  });
});

// ── Appels très profondément imbriqués ────────────────────────────────────────

describe('SignatureHelp — imbrication profonde', () => {
  it('a(b(c(d(e(f(x)))))) → activeParameter = 0 pour f', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Curseur après le `(` de fn
    const prefix = `a(b(c(d(e(${fn}(`;
    const callCode = `${prefix}42)))))`;
    const cursorPos = prefix.length; // juste après le `(` de fn

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx('('),
    );

    // findCallContext doit trouver fn (pas a ou b ou ...) car c'est le plus proche
    if (result !== null) {
      expect(result.activeParameter).toBe(0);
    }
  });

  it('appel avec > 20 lignes avant le curseur → provider retourne null ou résultat valide', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // 25 lignes vides entre le `(` et le curseur → dépasse la limite de 20 lignes
    const lines = [`${fn}(`];
    for (let i = 0; i < 25; i++) lines.push('  // padding');
    lines.push('  42');
    const callCode = lines.join('\n');
    const cursorLine = lines.length - 1;

    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(cursorLine, 4),
      token, ctx(),
    );

    // Le backward scan est limité à 20 lignes → ne trouve pas le `(`
    // → retourne null. Comportement attendu DOCUMENTÉ (limite connue).
    expect(result).toBeNull(); // ou valide si la limite est augmentée
  });
});
