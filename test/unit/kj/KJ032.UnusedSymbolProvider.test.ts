import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { importOrNull } from './harness';

/**
 * KJ-032 — la coquille VS Code : ce qui atterrit dans le panneau Problems.
 *
 * Deux règles qui ne vont pas de soi :
 *   - un fichier qu'on OUVRE garde ses trouvailles (contrairement à KJ-030),
 *     parce qu'aucun provider live ne peut recalculer une affirmation
 *     cross-fichier depuis un seul buffer ;
 *   - une trouvaille test-only n'est jamais grisée, parce que du code que les
 *     tests exercent n'est pas du code inutile.
 */

const mod: any = await importOrNull('src/providers/UnusedSymbolProvider');

const finding = (over: Record<string, unknown> = {}) => ({
  name: 'Ghost',
  kind: 'class',
  verdict: 'unreferenced',
  path: '/w/app/Ghost.kt',
  line: 2,
  character: 6,
  removeStart: 10,
  removeEnd: 30,
  testMentions: 0,
  isDeprecated: false,
  isLibraryModule: false,
  staleImports: [],
  fileBecomesEmpty: false,
  ...over,
});

const published = (p: any) =>
  (p as unknown as { collection: { _entries: Map<string, any[]> } }).collection._entries;

describe.skipIf(!mod)('UnusedSymbolProvider', () => {
  beforeEach(() => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  });

  it('publie un diagnostic par trouvaille, sur le token du nom', () => {
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding()]);
    const diags = published(p).get('/w/app/Ghost.kt');
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(2);
    expect(diags[0].range.start.character).toBe(6);
    expect(diags[0].range.end.character).toBe(6 + 'Ghost'.length);
    p.dispose();
  });

  it('unreferenced est un Warning grisé', () => {
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding()]);
    const d = published(p).get('/w/app/Ghost.kt')[0];
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(d.tags).toEqual([vscode.DiagnosticTag.Unnecessary]);
    expect(d.code).toBe('unused-symbol');
    p.dispose();
  });

  it('testOnly est une Information JAMAIS grisée', () => {
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding({ verdict: 'testOnly', testMentions: 3 })]);
    const d = published(p).get('/w/app/Ghost.kt')[0];
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Information);
    expect(d.tags).toBeUndefined();
    expect(d.code).toBe('test-only-symbol');
    expect(d.message).toContain('used only from tests');
    p.dispose();
  });

  it('les trouvailles persistent même si le fichier est ouvert', () => {
    // divergence assumée avec KJ-030 : rien ne peut les recalculer localement
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [
      { uri: vscode.Uri.file('/w/app/Ghost.kt') },
    ];
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding()]);
    expect(published(p).has('/w/app/Ghost.kt')).toBe(true);
    p.dispose();
  });

  it('un nouveau scan remplace le précédent', () => {
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding({ path: '/w/app/Old.kt' })]);
    p.setFindings([finding({ path: '/w/app/New.kt' })]);
    expect(published(p).has('/w/app/Old.kt')).toBe(false);
    expect(published(p).has('/w/app/New.kt')).toBe(true);
    p.dispose();
  });

  it('clear vide le panneau et la mémoire', () => {
    const p = new mod.UnusedSymbolProvider();
    p.setFindings([finding()]);
    p.clear();
    expect(published(p).size).toBe(0);
    expect(p.findingsFor('/w/app/Ghost.kt')).toBeUndefined();
    p.dispose();
  });

  it('le message dit le nombre de variantes de test et la nature du module', () => {
    expect(mod.messageFor(finding({ verdict: 'testOnly', testMentions: 1 })))
      .toContain('(1 reference)');
    expect(mod.messageFor(finding({ isLibraryModule: true })))
      .toContain('an external consumer may use it');
  });
});
