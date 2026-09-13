import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
// @ts-expect-error: plain ESM script without types
import { releaseContext } from '../../.github/scripts/release-context.mjs';

/**
 * Le contexte des notes de version, celui qui dit POURQUOI chaque changement
 * a ete fait.
 *
 * La premiere version, en bash dans `.publish`, avait deux defauts. Un
 * `git diff | head -600` sous `set -euo pipefail` : des que le patch depassait
 * le tampon d un pipe, git mourait de SIGPIPE et le script s arretait avec le
 * code 141, sans un mot, avant meme d ecrire le prompt. Une base de 70 versions
 * suffisait. Et pour un test deja existant, elle recopiait son premier bloc de
 * commentaire, qui raconte le correctif d une version PRECEDENTE, pendant que
 * la raison du changement en cours, ecrite dans les blocs ajoutes, n etait
 * jamais lue.
 */

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const ecrit = (path: string, text: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const commit = (msg: string) => { git('add', '-A'); git('commit', '-q', '-m', msg); };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'kj-release-context-'));
  git('init', '-q');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  ecrit('src/a.ts', 'export const a = 1;\n');
  ecrit('test/unit/Ancien.test.ts',
    "import { it } from 'vitest';\n\n/**\n * ANCIEN correctif, deja livre.\n */\nit('x', () => {});\n");
  commit('base');
  git('tag', 'v1');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('le pourquoi d un test deja existant vient de ce qui lui est ajoute', () => {
  it('l en tete du correctif precedent n est pas repris', () => {
    ecrit('test/unit/Ancien.test.ts', readFileSync(join(repo, 'test/unit/Ancien.test.ts'), 'utf8')
      + "\n/**\n * NOUVEAU cas, la raison de cette version.\n */\nit('y', () => {});\n");
    commit('ajout');
    const ctx = releaseContext({ cwd: repo, base: 'v1' });
    expect(ctx).toContain('NOUVEAU cas, la raison de cette version.');
    expect(ctx).not.toContain('ANCIEN correctif');
  });

  it('un test modifie sans nouveau bloc de commentaire ne produit rien', () => {
    ecrit('test/unit/Ancien.test.ts', readFileSync(join(repo, 'test/unit/Ancien.test.ts'), 'utf8') + "it('z', () => {});\n");
    commit('sans commentaire');
    const ctx = releaseContext({ cwd: repo, base: 'v1' });
    expect(ctx).not.toContain('Ancien.test.ts');
    expect(ctx).not.toContain('ANCIEN correctif');
  });
});

describe('un test nouveau donne son en tete', () => {
  it('commite dans la plage', () => {
    ecrit('test/unit/Neuf.test.ts', "import { it } from 'vitest';\n\n/**\n * Le defaut que ce test prouve.\n */\nit('x', () => {});\n");
    commit('neuf');
    expect(releaseContext({ cwd: repo, base: 'v1' })).toContain('Le defaut que ce test prouve.');
  });

  it('pas encore suivi par git, comme pendant --notes-only', () => {
    ecrit('test/unit/Neuf.test.ts', "/**\n * Encore dans l arbre de travail.\n */\n");
    expect(releaseContext({ cwd: repo, base: 'HEAD' })).toContain('Encore dans l arbre de travail.');
  });

  it('seul son premier bloc compte, pas les commentaires de ses helpers', () => {
    ecrit('test/unit/Neuf.test.ts', "/**\n * En tete.\n */\n\n/** Un helper. */\nconst h = 1;\n");
    const ctx = releaseContext({ cwd: repo, base: 'HEAD' });
    expect(ctx).toContain('En tete.');
    expect(ctx).not.toContain('Un helper.');
  });

  it('un test supprime ne fait pas echouer la collecte', () => {
    unlinkSync(join(repo, 'test/unit/Ancien.test.ts'));
    expect(() => releaseContext({ cwd: repo, base: 'HEAD' })).not.toThrow();
  });
});

describe('le patch du code livre', () => {
  it('au dela du tampon d un pipe, la collecte aboutit et le dit tronque', () => {
    // 3000 lignes de 60 caracteres : bien plus que les 64 Ko d un pipe, la
    // taille qui faisait mourir `git diff | head` de SIGPIPE.
    ecrit('src/a.ts', Array.from({ length: 3000 }, (_, i) => `export const ligne${i} = '${'x'.repeat(40)}';`).join('\n') + '\n');
    commit('gros');
    const ctx = releaseContext({ cwd: repo, base: 'v1', maxSrcLines: 600 });
    expect(ctx).toMatch(/first 600 of \d{4} lines/);
    expect(ctx.split('\n').filter((l: string) => l.startsWith('+export const ligne')).length).toBeLessThanOrEqual(600);
  });

  it('le travail pas encore commite compte aussi', () => {
    ecrit('src/a.ts', 'export const a = 2;\n');
    expect(releaseContext({ cwd: repo, base: 'HEAD' })).toContain('+export const a = 2;');
  });
});

describe('.publish ne relit plus git a travers un pipe', () => {
  it('la collecte passe par le script Node et aucun git diff ne se deverse dans head', () => {
    const publish = readFileSync(join(__dirname, '../../.publish'), 'utf8');
    expect(publish).toContain('.github/scripts/release-context.mjs');
    // La forme exacte qui tuait le script sous pipefail.
    expect(publish).not.toMatch(/git (?:diff|log|show)[^\n|]*\|[^\n]*\bhead\b/);
  });
});
