import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitFacts } from '../../../src/git/GitFacts';

/**
 * T6, suite : un utilisateur qui force la couleur des diffs.
 *
 * `color.diff = always` l emporte sur `color.ui = never`, et chaque ligne du
 * diff commence alors par un echappement ANSI au lieu de `-` ou `+` : aucune
 * ligne n etait comptee, et tout symbole sortait sans attribution. Vu sur un
 * poste dont le `~/.gitconfig` porte ce reglage, ou six cas de
 * `GitFacts.test.ts` tombaient.
 *
 * Le reglage est pose dans la config LOCALE du depot temporaire : elle bat la
 * globale, donc le test dit la meme chose sur toute machine. Un cas par
 * commande, `diff` puis `show`, pour qu un correctif pose sur une seule des
 * deux ne passe pas.
 */

// A hook exports GIT_INDEX_FILE and the author variables: none may reach the fixture.
const envPropre = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: { ...envPropre, HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_DATE: '2026-03-01T10:00:00', GIT_COMMITTER_DATE: '2026-03-01T10:00:00' },
  }).trim();

let disponible = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { disponible = false; }

let repo: string;
const ecrit = (rel: string, texte: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), texte);
};
const commit = (sujet: string) => {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Ann Author', '-c', 'user.email=a@example.com', 'commit', '-q', '-m', sujet);
};
const avecColorDiff = (valeur: 'never' | 'always') => {
  git(repo, 'config', 'color.diff', valeur);
  return new GitFacts(repo);
};

beforeAll(() => {
  if (!disponible) return;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-gitfacts-color-'));
  git(repo, 'init', '-q', '-b', 'main');
  ecrit('app/src/main/kotlin/k/Helper.kt', 'package k\n\nclass Helper {\n    fun run() = 1\n}\n');
  ecrit('app/src/main/kotlin/k/Caller.kt', 'package k\n\nclass Caller {\n    fun go() = Helper().run()\n}\n');
  ecrit('app/src/main/kotlin/k/Lonely.kt', 'package k\n\nclass Lonely\n');
  commit('TK-100 first screen (pull request #7)');
  fs.rmSync(path.join(repo, 'app/src/main/kotlin/k/Caller.kt'));
  commit('TK-123 remove the old screen (pull request #9)');
});

afterAll(() => { if (repo) fs.rmSync(repo, { recursive: true, force: true }); });

describe.skipIf(!disponible)('T6, GitFacts sous un utilisateur qui force la couleur des diffs', () => {
  it('temoin : sans couleur, les lignes sont comptees', async () => {
    const faits = avecColorDiff('never');
    expect(await faits.causeDe('Helper', ['app'])).toMatchObject({ kind: 'orphan', ticket: 'TK-123', pr: '9' });
    expect(await faits.causeDe('Lonely', ['app'])).toMatchObject({ kind: 'born', truncated: true });
  });

  // `git diff` against the first parent.
  it('color.diff=always : le commit qui a retire le dernier appelant est toujours nomme', async () => {
    expect(await avecColorDiff('always').causeDe('Helper', ['app'])).toMatchObject({ kind: 'orphan', ticket: 'TK-123', pr: '9' });
  });

  // The root commit goes through `git show`, a second command to neutralise.
  it('color.diff=always : un nom ne dans le commit racine est toujours vu', async () => {
    expect(await avecColorDiff('always').causeDe('Lonely', ['app'])).toMatchObject({ kind: 'born', truncated: true });
  });
});
