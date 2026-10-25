import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitFacts, libelleDe } from '../../../src/git/GitFacts';

/**
 * Campagne de nettoyage, T6 : ce que git sait d un symbole mort.
 *
 * Le dernier commit qui a fait BAISSER le nombre d occurrences d un nom est
 * celui qui a retire son dernier appelant : l orphelin a une cause, un ticket,
 * une PR, une date. Un nom qu un seul commit a jamais touche est ne mort. Tout
 * le reste, un deplacement, un renommage, un ajout tardif, reste sans
 * attribution : une cause fausse vaut moins qu aucune.
 *
 * Le depot est construit par le test, avec des sujets de commit neutres.
 */

// Lance sous un hook de pre-commit, le test herite de GIT_INDEX_FILE,
// GIT_AUTHOR_NAME et consorts, que git exporte vers ses hooks : le depot
// temporaire ecrirait alors dans l index du vrai depot, et l auteur de ses
// commits serait celui du commit en cours. Rien de git ne passe.
const envPropre = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...envPropre, HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_DATE: '2026-03-01T10:00:00', GIT_COMMITTER_DATE: '2026-03-01T10:00:00' } }).trim();

let disponible = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { disponible = false; }

let repo: string;
const ecrit = (rel: string, texte: string) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), texte); };
const commit = (sujet: string, auteur = 'Ann Author') => {
  git(repo, 'add', '-A');
  git(repo, '-c', `user.name=${auteur}`, '-c', 'user.email=a@example.com', 'commit', '-q', '-m', sujet);
};

beforeAll(() => {
  if (!disponible) return;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-gitfacts-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'diff.mnemonicprefix', 'true');
  git(repo, 'config', 'core.pager', 'cat');
  // 1. Everything is born: a helper, its caller, a born dead class, a class that will move.
  ecrit('app/src/main/kotlin/k/Helper.kt', 'package k\n\nclass Helper {\n    fun run() = 1\n}\n');
  ecrit('app/src/main/kotlin/k/Caller.kt', 'package k\n\nclass Caller {\n    fun go() = Helper().run()\n}\n');
  ecrit('app/src/main/kotlin/k/Lonely.kt', 'package k\n\nclass Lonely\n');
  // A name that CONTAINS Lonely: a substring pickaxe would count its changes as Lonely's.
  ecrit('app/src/main/kotlin/k/LonelyBag.kt', 'package k\n\nclass LonelyBag\n');
  ecrit('app/src/main/kotlin/k/Mover.kt', 'package k\n\nclass Mover\n');
  commit('Merged in kiosk/feature/TK-100-first-screen (pull request #7)');
  // 2. The caller goes: Helper is orphaned here. LonelyBag grows a line too.
  fs.rmSync(path.join(repo, 'app/src/main/kotlin/k/Caller.kt'));
  ecrit('app/src/main/kotlin/k/LonelyBag.kt', 'package k\n\nclass LonelyBag {\n    fun size() = 0\n}\n');
  commit('Merged in kiosk/feature/TK-123-remove-old-screen (pull request #9)', 'Bob Builder');
  // 3. A revert touches Helper's count and must not be taken for the cause.
  ecrit('app/src/main/kotlin/k/Note.kt', 'package k\n\n// Helper is kept for now\n');
  commit('Revert "Merged in kiosk/feature/TK-130-notes (pull request #11)"');
  // 4. Mover moves to another module and gains a mention: removed here, added
  // there, same commit. A pure move keeps the count and pickaxe never sees it.
  fs.rmSync(path.join(repo, 'app/src/main/kotlin/k/Mover.kt'));
  ecrit('core/src/main/kotlin/k/Mover.kt', 'package k\n\n/** Mover now lives in core. */\nclass Mover\n');
  commit('Merged in kiosk/tech/TK-140-move-mover (pull request #12)');
  // 5. A feature branch adds Branchy and is merged with a merge commit: born at
  // a pull request, inside the history, not older than it.
  git(repo, 'checkout', '-q', '-b', 'feature');
  ecrit('app/src/main/kotlin/k/Branchy.kt', 'package k\n\nclass Branchy\n');
  commit('TK-150 add branchy');
  git(repo, 'checkout', '-q', 'main');
  git(repo, '-c', 'user.name=Ann Author', '-c', 'user.email=a@example.com', 'merge', '-q', '--no-ff', '-m', 'Merged in kiosk/feature/TK-150-branchy (pull request #15)', 'feature');
  // 6. An unrelated repository is joined: Foreign was born before this history.
  git(repo, 'checkout', '-q', '--orphan', 'other');
  git(repo, 'rm', '-rfq', '.');
  ecrit('core/src/main/kotlin/f/Foreign.kt', 'package f\n\nclass Foreign\n');
  commit('Initial commit of the other repository');
  git(repo, 'checkout', '-q', 'main');
  git(repo, '-c', 'user.name=Ann Author', '-c', 'user.email=a@example.com', 'merge', '-q', '--allow-unrelated-histories', '-m', "Merge remote-tracking branch 'other/master'", 'other');
});

afterAll(() => { if (repo) fs.rmSync(repo, { recursive: true, force: true }); });

describe('T6, le libelle d une cause', () => {
  it('ticket et PR quand le sujet les porte, sinon le commit et sa date, jamais le sujet brut', () => {
    expect(libelleDe('Merged in kiosk/feature/TK-123-x (pull request #9)', 'abcdef1234', '2026-03-01', false)).toBe('TK-123 (pull request #9)');
    expect(libelleDe("Merge branch 'core43'", 'abcdef1234', '2024-09-27', false)).toBe('commit abcdef1234 (2024-09-27)');
    // SHA-256 or UTF-8 in a subject is not a ticket.
    expect(libelleDe('Use SHA-256 for the cache key', 'abcdef1234', '2024-09-27', false)).toBe('commit abcdef1234 (2024-09-27)');
    expect(libelleDe("Merge remote-tracking branch 'other/master'", 'abcdef1234', '2024-07-08', 'jonction')).toBe('older than the history (2024-07-08)');
    expect(libelleDe('Initial commit', 'abcdef1234', '2024-07-08', 'racine')).toBe('as old as the history (2024-07-08)');
  });
});

describe.skipIf(!disponible)('T6, GitFacts', () => {
  it('est disponible dans un depot git, et pas hors d un depot', async () => {
    expect(await GitFacts.disponible(repo)).toBe(true);
    expect(await GitFacts.disponible(os.tmpdir())).toBe(false);
  });

  it('un symbole dont le dernier appelant est parti : orphelin, avec ticket, PR, auteur et date', async () => {
    const g = new GitFacts(repo);
    const fait = await g.causeDe('Helper', ['app']);
    expect(fait).toMatchObject({ kind: 'orphan', ticket: 'TK-123', pr: '9', author: 'Bob Builder', date: '2026-03-01' });
    expect(fait?.label).toBe('TK-123 (pull request #9)');
  });

  it('un revert est ignore comme cause', async () => {
    // Le dernier commit qui touche « Helper » est le revert ; la cause est le commit d avant.
    const fait = await new GitFacts(repo).causeDe('Helper', ['app']);
    expect(fait?.ticket).toBe('TK-123');
  });

  it('un symbole qu un seul commit a touche est ne mort ; ne dans le premier commit, il est aussi vieux que l historique', async () => {
    const fait = await new GitFacts(repo).causeDe('Lonely', ['app']);
    expect(fait).toMatchObject({ kind: 'born', ticket: 'TK-100', pr: '7', truncated: true });
    expect(fait?.label).toBe('as old as the history (2026-03-01)');
  });

  it('le pickaxe cherche le nom entier : LonelyBag ne compte pas pour Lonely', async () => {
    const fait = await new GitFacts(repo).causeDe('Lonely', ['app']);
    expect(fait?.kind).toBe('born');
  });

  it('ne dans une PR fusionnee : born, pas plus vieux que l historique, avec le ticket de la PR', async () => {
    const fait = await new GitFacts(repo).causeDe('Branchy', ['app']);
    expect(fait).toMatchObject({ kind: 'born', ticket: 'TK-150', pr: '15', truncated: false });
    expect(fait?.label).toBe('TK-150 (pull request #15)');
  });

  it('ne a la jonction de deux historiques sans ancetre commun : plus vieux que l historique', async () => {
    const fait = await new GitFacts(repo).causeDe('Foreign', ['core']);
    expect(fait).toMatchObject({ kind: 'born', truncated: true });
    expect(fait?.label).toMatch(/^older than the history \(2026-03-01\)$/);
  });

  it('un deplacement avec ajout, retrait et ajout dans le meme commit, reste sans attribution', async () => {
    const fait = await new GitFacts(repo).causeDe('Mover', ['app', 'core']);
    expect(fait?.kind).toBe('unattributed');
  });

  it('un nom qui n est pas un identifiant, ou trop court, n a pas de fait', async () => {
    const g = new GitFacts(repo);
    expect(await g.causeDe('a.b', ['app'])).toBeUndefined();
    expect(await g.causeDe('go', ['app'])).toBeUndefined();
  });

  it('les faits sont mis en cache par HEAD, et un lot de noms se calcule en parallele', async () => {
    const g = new GitFacts(repo);
    const faits = await g.causesPour([{ cle: 'a', nom: 'Helper', chemins: ['app'] }, { cle: 'b', nom: 'Lonely', chemins: ['app'] }]);
    expect(faits.get('a')?.kind).toBe('orphan');
    expect(faits.get('b')?.kind).toBe('born');
    expect(g.tailleDuCache).toBe(2);
    await g.causesPour([{ cle: 'a', nom: 'Helper', chemins: ['app'] }]);
    expect(g.tailleDuCache).toBe(2);
  });

  it('un commit de plus invalide le cache : les faits sont relus a la nouvelle HEAD', async () => {
    const g = new GitFacts(repo);
    await g.causeDe('Helper', ['app']);
    ecrit('app/src/main/kotlin/k/Note2.kt', 'package k\n\nclass Note2\n');
    commit('TK-200 a note (pull request #20)');
    g.oublieLaHead();
    await g.causeDe('Helper', ['app']);
    expect(g.tailleDuCache).toBe(2);
  });
});
