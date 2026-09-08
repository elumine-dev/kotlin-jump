import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWorkspaceRoots, preferByImports, INDEXABLE_RE, canonicalUri, openTextByPath, pathToUri } from '../../src/server/utils';
import { indexFile, scanWorkspace, MAX_SCANNED_FILES } from '../../src/server/scanner';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { handleGetFileSymbols, FILE_SYMBOLS_LIMIT } from '../../src/server/mcp';
import { lookupPermission } from '../../src/data/permissionDescriptions';
import { lookupSuppression } from '../../src/data/suppressDescriptions';

// Audit 28 : le serveur LSP autonome, utilisé hors VS Code (Neovim, Helix, Zed).

describe('Racines du workspace', () => {
  it('workspaceFolders prime, et rien ne retombe sur le répertoire courant', () => {
    expect(resolveWorkspaceRoots({ rootUri: null, workspaceFolders: [{ uri: 'file:///proj/a' }, { uri: 'file:///proj/b' }] }))
      .toEqual(['/proj/a', '/proj/b']);
    expect(resolveWorkspaceRoots({ rootUri: 'file:///proj/a' })).toEqual(['/proj/a']);
    expect(resolveWorkspaceRoots({ rootPath: '/proj/a' })).toEqual(['/proj/a']);
    // Aucune racine annoncée : on n'indexe rien plutôt que le dossier personnel.
    expect(resolveWorkspaceRoots({})).toEqual([]);
    expect(resolveWorkspaceRoots({ rootUri: null, rootPath: null, workspaceFolders: [] })).toEqual([]);
  });

  it('décode une racine dont le chemin contient des espaces', () => {
    expect(resolveWorkspaceRoots({ rootUri: 'file:///Users/kevin/My%20Projects/app' }))
      .toEqual(['/Users/kevin/My Projects/app']);
  });
});

describe('Go to Definition guidé par les imports', () => {
  const decls = [
    { fqn: 'com.app.domain.User', packageName: 'com.app.domain' },
    { fqn: 'com.app.network.User', packageName: 'com.app.network' },
    { fqn: 'com.app.db.User', packageName: 'com.app.db' },
  ];

  it('un import explicite désigne une seule destination', () => {
    const text = 'package com.app.ui\n\nimport com.app.network.User\n\nfun f(u: User) {}';
    expect(preferByImports(text, decls).map(d => d.fqn)).toEqual(['com.app.network.User']);
  });

  it('un import joker restreint au package importé', () => {
    const text = 'package com.app.ui\n\nimport com.app.db.*\n\nfun f(u: User) {}';
    expect(preferByImports(text, decls).map(d => d.fqn)).toEqual(['com.app.db.User']);
  });

  it('sans import, la déclaration du package du fichier gagne', () => {
    const text = 'package com.app.domain\n\nfun f(u: User) {}';
    expect(preferByImports(text, decls).map(d => d.fqn)).toEqual(['com.app.domain.User']);
  });

  it('un import aliasé compte pour son chemin d\'origine', () => {
    const text = 'package com.app.ui\n\nimport com.app.db.User as DbUser\n\nfun f(u: DbUser) {}';
    expect(preferByImports(text, decls).map(d => d.fqn)).toEqual(['com.app.db.User']);
  });

  it('sans indice, toutes les destinations sont conservées', () => {
    expect(preferByImports('package other\n\nfun f(u: User) {}', decls).length).toBe(3);
    expect(preferByImports('', [decls[0]]).length).toBe(1);
  });
});

describe('Indexation du serveur', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a28-'));

  it('un fichier non source n\'entre pas dans l\'index', async () => {
    expect(INDEXABLE_RE.test('/p/A.kt')).toBe(true);
    expect(INDEXABLE_RE.test('/p/B.java')).toBe(true);
    expect(INDEXABLE_RE.test('/p/README.md')).toBe(false);
    const index = new SymbolIndex();
    const readme = path.join(tmp, 'README.md');
    fs.writeFileSync(readme, 'class GhostFromReadme');
    await indexFile(readme, index);
    expect(index.lookup('GhostFromReadme')).toEqual([]);
  });

  it('un lien symbolique ne fait pas sortir le scan de la racine', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a28root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'a28out-'));
    fs.writeFileSync(path.join(root, 'Inside.kt'), 'package p\nclass Inside');
    fs.writeFileSync(path.join(outside, 'Outsider.kt'), 'package p\nclass Outsider');
    try { fs.symlinkSync(outside, path.join(root, 'linked')); } catch { return; }
    const index = new SymbolIndex();
    await scanWorkspace(root, index);
    expect(index.lookup('Inside').length).toBe(1);
    expect(index.lookup('Outsider')).toEqual([]);
  });

  it('le plafond de fichiers existe et reste raisonnable', () => {
    expect(MAX_SCANNED_FILES).toBeGreaterThanOrEqual(5000);
    expect(MAX_SCANNED_FILES).toBeLessThanOrEqual(100000);
  });
});

describe('Dictionnaires de survol', () => {
  it('SET_ALARM est reconnue sous son vrai nom, com.android.alarm.permission.SET_ALARM', () => {
    expect(lookupPermission('com.android.alarm.permission.SET_ALARM')?.description).toContain('alarm');
    expect(lookupPermission('android.permission.CAMERA')).toBeDefined();
    expect(lookupPermission('CAMERA')).toBeDefined();
  });

  it('un nom hérité d\'Object ne produit pas de survol', () => {
    expect(lookupPermission('android.permission.constructor')).toBeUndefined();
    expect(lookupPermission('toString')).toBeUndefined();
    expect(lookupSuppression('constructor')).toBeUndefined();
    expect(lookupSuppression('hasOwnProperty')).toBeUndefined();
  });

  it('une permission inconnue reste sans survol', () => {
    expect(lookupPermission('com.acme.permission.WHATEVER')).toBeUndefined();
  });
});

describe('Encodage des URI entre client et serveur', () => {
  // Un client encode selon le RFC 3986, le serveur encodait chaque segment
  // avec encodeURIComponent. Les deux divergent sur , & + $ : la suppression
  // ne trouvait pas sa clé, et le tampon ouvert retombait sur le disque.
  const clientUri = (p: string) =>
    'file://' + p.split('/').map(encodeURIComponent).join('/')
      .replace(/%2C/g, ',').replace(/%26/g, '&').replace(/%2B/g, '+');

  it('canonicalUri ramène l\'URI du client à la forme de l\'index', () => {
    for (const p of ['/proj/app/Main.kt', '/proj/My Projects/Main.kt', '/proj/a,b/Main.kt', '/proj/Q&A/Main.kt', '/proj/c++/Main.kt']) {
      expect(canonicalUri(clientUri(p)), p).toBe(pathToUri(p));
    }
  });

  it('un tampon ouvert est retrouvé par son chemin, quel que soit l\'encodage reçu', () => {
    const docs = [
      { uri: clientUri('/proj/a,b/Main.kt'), getText: () => 'contenu non sauvegardé' },
      { uri: clientUri('/proj/app/Other.kt'), getText: () => 'autre' },
    ];
    const open = openTextByPath(docs);
    expect(open.get('/proj/a,b/Main.kt')).toBe('contenu non sauvegardé');
    expect(open.get('/proj/app/Other.kt')).toBe('autre');
    expect(open.get('/proj/absent.kt')).toBeUndefined();
  });
});

describe('Réponses du serveur MCP', () => {
  it('get_file_symbols est borné comme les autres handlers', () => {
    const index = new SymbolIndex();
    const uri = 'file:///proj/Big.kt';
    const body = Array.from({ length: FILE_SYMBOLS_LIMIT + 200 }, (_, i) => `fun f${i}() {}`).join('\n');
    index.add(parse(uri, 'package p\n' + body));
    // Sans borne, une seule réponse d'outil pouvait atteindre 1,79 Mo.
    expect(handleGetFileSymbols(index, uri).length).toBe(FILE_SYMBOLS_LIMIT);
    expect(handleGetFileSymbols(index, 'file:///proj/Absent.kt')).toEqual([]);
  });
});
