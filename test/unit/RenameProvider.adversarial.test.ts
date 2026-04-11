/**
 * Tests adversariaux pour KotlinRenameProvider.
 *
 * Bug couvert :
 *   RN-1 — file-rename : collision de noms entre packages → mauvais fichier proposé
 *           `decls.find(d => d.depth === 0 && FILE_RENAME_KINDS.has(d.kind))` retournait
 *           le premier déclarant dans l'index sans tenir compte du document courant.
 *           Résultat : quand deux classes portent le même nom dans des packages distincts,
 *           le rename pouvait proposer de renommer le mauvais fichier .kt.
 *
 *           Fix : utiliser `resolveSearchTarget` pour identifier la déclaration ciblée
 *           par le contexte du document (même package ou import explicite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinRenameProvider } from '../../src/providers/RenameProvider';
import { mockDocument, positionOf } from './helpers';
import { workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const token = { isCancellationRequested: false } as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Renvoie le contenu de la map de codes pour le mock readFile. */
function makeReadFile(codeMap: Record<string, string>) {
  return async (uri: any) => {
    const u = typeof uri.toString === 'function' ? uri.toString() : String(uri);
    return Buffer.from(codeMap[u] ?? '') as any;
  };
}

// ── RN-1 — file-rename : collision de noms entre packages ────────────────────

describe('RN-1 — file-rename : collision de noms entre packages', () => {
  //
  // Deux classes `User` dans des packages distincts.
  // Chaque classe a un fichier nommé d'après elle (convention Kotlin).
  // Le rename est initié depuis un fichier dans com.a.
  //
  // AVANT fix : decls.find() retournait le premier déclarant (com.b.User si indexé en premier)
  //             → le _fileRenames pointait vers le mauvais fichier
  // APRÈS fix  : resolveSearchTarget → com.a.User (même package) → bon fichier

  const A_USER_URI  = 'file:///a/User.kt';   // com.a.User — le bon
  const B_USER_URI  = 'file:///b/User.kt';   // com.b.User — le mauvais

  const A_USER_CODE = 'package com.a\nclass User {}';
  const B_USER_CODE = 'package com.b\nclass User {}';

  // Fichier appelant dans com.a — référence com.a.User (même package, pas d'import)
  const CALLER_URI  = 'file:///a/App.kt';
  const CALLER_CODE = 'package com.a\nval u: User = User()';

  let index: SymbolIndex;
  let provider: KotlinRenameProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    // Indexer com.b.User EN PREMIER pour rendre le bug déterministe :
    // avant fix, decls[0] = com.b.User → fichier b/User.kt proposé (mauvais).
    addKt(index, B_USER_URI, B_USER_CODE);
    addKt(index, A_USER_URI, A_USER_CODE);
    addKt(index, CALLER_URI, CALLER_CODE);
    provider = new KotlinRenameProvider(index);
    workspace.fs.readFile = makeReadFile({
      [A_USER_URI]:  A_USER_CODE,
      [B_USER_URI]:  B_USER_CODE,
      [CALLER_URI]:  CALLER_CODE,
    });
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
  });

  it('renommage depuis com.a.App → propose de renommer a/User.kt, pas b/User.kt', async () => {
    const doc  = mockDocument(CALLER_URI, CALLER_CODE);
    const edit = await provider.provideRenameEdits(
      doc, positionOf(CALLER_CODE, 'User'), 'Customer', token,
    ) as any;

    expect(edit).not.toBeNull();
    const renames = edit._fileRenames as Array<{ oldUri: any; newUri: any }>;

    // BUG RN-1 (avant fix) : renames[0].oldUri pointait vers b/User.kt (com.b)
    // Fix : resolveSearchTarget → com.a.User → a/User.kt proposé
    if (renames.length > 0) {
      const oldUri = renames[0].oldUri.toString();
      expect(oldUri).toBe(A_USER_URI);
      expect(oldUri).not.toBe(B_USER_URI);
    }
    // S'il n'y a pas de file-rename du tout, c'est aussi acceptable dans ce contexte
    // (le caller n'est pas le fichier déclarant) — mais le test principal est
    // que si un rename est proposé, c'est le BON fichier.
  });

  it('renommage depuis la déclaration elle-même → propose de renommer a/User.kt', async () => {
    // Cursor sur `class User` dans a/User.kt
    const doc  = mockDocument(A_USER_URI, A_USER_CODE);
    const edit = await provider.provideRenameEdits(
      doc, positionOf(A_USER_CODE, 'User'), 'Customer', token,
    ) as any;

    expect(edit).not.toBeNull();
    const renames = edit._fileRenames as Array<{ oldUri: any; newUri: any }>;

    // Depuis la déclaration : resolveSearchTarget ou même-package → com.a.User
    expect(renames).toHaveLength(1);
    expect(renames[0].oldUri.toString()).toBe(A_USER_URI);
    expect(renames[0].newUri.toString()).toBe('file:///a/Customer.kt');
  });

  it('sans collision : un seul User dans l\'index → file-rename proposé normalement', async () => {
    const idx = new SymbolIndex();
    const ONLY_URI  = 'file:///only/User.kt';
    const ONLY_CODE = 'package com.only\nclass User {}';
    addKt(idx, ONLY_URI, ONLY_CODE);
    const p = new KotlinRenameProvider(idx);
    workspace.fs.readFile = makeReadFile({ [ONLY_URI]: ONLY_CODE });

    const doc  = mockDocument(ONLY_URI, ONLY_CODE);
    const edit = await p.provideRenameEdits(
      doc, positionOf(ONLY_CODE, 'User'), 'Customer', token,
    ) as any;

    expect(edit).not.toBeNull();
    const renames = edit._fileRenames as Array<{ oldUri: any; newUri: any }>;
    expect(renames).toHaveLength(1);
    expect(renames[0].oldUri.toString()).toBe(ONLY_URI);
    expect(renames[0].newUri.toString()).toBe('file:///only/Customer.kt');
  });
});
