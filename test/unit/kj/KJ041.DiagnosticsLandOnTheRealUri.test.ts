import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { UnusedGradleDependencyProvider } from '../../../src/providers/UnusedGradleDependencyProvider';
import { rememberCorpusUri } from '../../../src/util/corpusUri';

/**
 * Un diagnostic se pose sur l URI du fichier, pas sur un `file:` refabrique.
 *
 * Le corpus indexe ses sources par `fsPath`. Sur vscode.dev un fichier est un
 * `vscode-vfs://github/owner/repo/...` dont le `fsPath` est un simple
 * `/owner/repo/...` : reconstruire l URI avec `vscode.Uri.file(chemin)` pose le
 * diagnostic sur un `file:///owner/repo/...` qu aucun editeur ne montre. Le
 * panneau Problemes liste des chemins fantomes et le correctif rapide lit un
 * fichier qui n existe pas.
 *
 * `corpusUri` existe depuis la 1.42.12 pour ca, et onze fournisseurs l
 * utilisent. Celui de KJ-041 avait ete oublie.
 */

const CHEMIN = '/owner/repo/gradle/libs.versions.toml';

const alias = (path: string) => ({
  path, name: 'androidx.core', line: 3, character: 2,
  kind: 'library', version: undefined,
}) as any;

afterEach(() => vi.restoreAllMocks());

describe('KJ-041 le diagnostic atterrit sur le vrai fichier', () => {
  it('sur l hote navigateur, il garde le schema vscode-vfs', () => {
    const uri = vscodeMock.Uri.parse(`vscode-vfs://github${CHEMIN}`);
    rememberCorpusUri(uri);
    const p = new UnusedGradleDependencyProvider();
    p.setFindings([alias(CHEMIN)]);
    const pose = ((p as any).collection._uris as Map<string, any>).get(CHEMIN);
    expect(pose).toBeDefined();
    expect(pose.scheme).toBe('vscode-vfs');
  });

  it('temoin : sur disque, il reste un file:', () => {
    const chemin = '/w/gradle/libs.versions.toml';
    rememberCorpusUri(vscodeMock.Uri.file(chemin));
    const p = new UnusedGradleDependencyProvider();
    p.setFindings([alias(chemin)]);
    expect(((p as any).collection._uris as Map<string, any>).get(chemin).scheme).toBe('file');
  });

  it('temoin : un chemin que le corpus n a jamais vu retombe sur file:', () => {
    const chemin = '/jamais/vu/libs.versions.toml';
    const p = new UnusedGradleDependencyProvider();
    p.setFindings([alias(chemin)]);
    expect(((p as any).collection._uris as Map<string, any>).get(chemin).scheme).toBe('file');
  });

  it('oublier un fichier retire bien son entree', () => {
    const uri = vscodeMock.Uri.parse(`vscode-vfs://github${CHEMIN}`);
    rememberCorpusUri(uri);
    const p = new UnusedGradleDependencyProvider();
    p.setFindings([alias(CHEMIN)]);
    (p as any).forget(CHEMIN);
    expect(((p as any).collection._entries as Map<string, any>).has(CHEMIN)).toBe(false);
  });
});

/**
 * Et personne d autre ne refabrique un `file:` pour poser un diagnostic.
 *
 * La regle est etroite a dessein : elle ne dit rien des autres usages de
 * `Uri.file`, dont certains sont justes (un cache local sur disque n existe
 * que sur le poste de travail). Elle dit seulement qu une collection de
 * diagnostics ne se cle pas sur une URI refabriquee.
 */
describe('aucune collection de diagnostics ne refabrique son URI', () => {
  it('dans tout src', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const depot = path.resolve(__dirname, '..', '..', '..');
    const coupables: string[] = [];
    const walk = (dir: string): void => {
      for (const nom of fs.readdirSync(dir)) {
        const complet = path.join(dir, nom);
        if (fs.statSync(complet).isDirectory()) { walk(complet); continue; }
        if (!nom.endsWith('.ts')) continue;
        fs.readFileSync(complet, 'utf8').split('\n').forEach((l, i) => {
          if (!/\.(set|delete)\s*\(\s*vscode\.Uri\.file\(/.test(l)) return;
          coupables.push(`${path.relative(depot, complet)}:${i + 1} ${l.trim().slice(0, 70)}`);
        });
      }
    };
    walk(path.join(depot, 'src'));
    expect(coupables, 'passer par corpusUri, voir src/util/corpusUri.ts').toEqual([]);
  });
});
