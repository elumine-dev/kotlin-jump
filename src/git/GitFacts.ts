import { execFile } from 'child_process';
import type { Cause } from '../cleanup/planner';

/**
 * What git knows about a dead name, for the cleanup plan.
 *
 * The last commit that made the number of occurrences of a name go DOWN is
 * the one that removed its last caller: the orphan has a cause, with a ticket,
 * a pull request, an author and a date in that commit's subject. A name only
 * one commit ever touched was born dead. Everything else, a move, a rename, a
 * late re-add, stays unattributed: a wrong cause is worth less than none.
 *
 * Read only, on demand, `--first-parent` so that a squash or a merge names
 * the pull request rather than a commit inside it, restricted to the paths of
 * the batch. Measured on a 9816 commit history: 0.44 s per name with six in
 * flight. Results are cached per HEAD for the life of the instance.
 *
 * The user's own git configuration is neutralised on every call:
 * `diff.mnemonicprefix` would turn `a/` and `b/` into `c/` and `w/`, a pager
 * would colour the output, and either one breaks a parser.
 */

export interface DemandeDeCause {
  cle: string;
  nom: string;
  /** Paths, relative to the repository, the pickaxe may look in. */
  chemins: readonly string[];
}

const NOM_RE = /^[A-Za-z_][\w]*$/;
const NOM_MIN = 4;
/** `TK-123`, not `SHA-256` or `UTF-8`: a few technical prefixes are never a ticket. */
const TICKET_RE = /\b(?!(?:SHA|UTF|MD|ISO|RFC|TLS|SSL|HTTP|HTTPS|API|SDK|JDK|AGP|CVE|IPV)-)([A-Z][A-Z0-9]+-\d+)\b/;
const PR_RE = /pull request #(\d+)|\(#(\d+)\)/;
const SEP = '\u001f';
const DELAI_MS = 15000;
const PARALLELISME = 6;

export class GitFacts {
  private readonly cache = new Map<string, Cause | undefined>();
  private headConnu: string | undefined;

  constructor(private readonly root: string, private readonly gitPath = 'git') {}

  static async disponible(root: string, gitPath = 'git'): Promise<boolean> {
    try {
      const out = await run(gitPath, root, ['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    } catch { return false; }
  }

  get tailleDuCache(): number { return this.cache.size; }

  /** HEAD is read again on the next call: for a caller that knows a commit was made. */
  oublieLaHead(): void { this.headConnu = undefined; }

  /** The instance's own root is a git work tree. */
  disponibleIci(): Promise<boolean> { return GitFacts.disponible(this.root, this.gitPath); }

  async branche(): Promise<string | undefined> {
    try { return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || undefined; } catch { return undefined; }
  }

  async head(): Promise<string | undefined> {
    if (this.headConnu) return this.headConnu;
    try { this.headConnu = (await this.git(['rev-parse', 'HEAD'])).trim(); } catch { this.headConnu = undefined; }
    return this.headConnu;
  }

  /** The cause of one name's death, or undefined when git cannot say. */
  async causeDe(nom: string, chemins: readonly string[]): Promise<Cause | undefined> {
    if (!NOM_RE.test(nom) || nom.length < NOM_MIN) return undefined;
    const head = await this.head();
    if (head === undefined) return undefined;
    const cle = `${head}\0${nom}\0${chemins.join(',')}`;
    if (this.cache.has(cle)) return this.cache.get(cle);
    let cause: Cause | undefined;
    try { cause = await this.chercher(nom, chemins); } catch { cause = undefined; }
    this.cache.set(cle, cause);
    return cause;
  }

  /** Several names at once, a few in flight, cancellable between two. */
  async causesPour(
    demandes: readonly DemandeDeCause[],
    options: { parallelisme?: number; progres?: (fait: number, total: number) => void; estAnnule?: () => boolean } = {},
  ): Promise<Map<string, Cause>> {
    const out = new Map<string, Cause>();
    let i = 0;
    let fait = 0;
    const travailleur = async () => {
      while (i < demandes.length && !options.estAnnule?.()) {
        const d = demandes[i++];
        const cause = await this.causeDe(d.nom, d.chemins);
        if (cause) out.set(d.cle, cause);
        options.progres?.(++fait, demandes.length);
      }
    };
    await Promise.all(Array.from({ length: options.parallelisme ?? PARALLELISME }, travailleur));
    return out;
  }

  private async chercher(nom: string, chemins: readonly string[]): Promise<Cause | undefined> {
    const cibles = chemins.length > 0 ? chemins : ['.'];
    // The whole word: `-S` alone is a substring match, and `Item` would count
    // every change to `ItemView`. POSIX extended regex has no `\b`, so the
    // boundary is spelled out; it works on the BSD and the GNU engines alike.
    const motEntier = `(^|[^A-Za-z0-9_])${nom}([^A-Za-z0-9_]|$)`;
    const log = await this.git(['log', '--first-parent', '--pickaxe-regex', `-S${motEntier}`, `--format=%H${SEP}%P${SEP}%ad${SEP}%an${SEP}%s`, '--date=short', '--', ...cibles]);
    const hits = log.split('\n').filter(Boolean).map(l => {
      const [commit, parents, date, author, ...reste] = l.split(SEP);
      return { commit, parents: parents.trim() === '' ? [] : parents.trim().split(' '), date, author, subject: reste.join(SEP) };
    });
    if (hits.length === 0) return undefined;
    // A revert moves the count too; the cause is the commit before it.
    const premier = hits.find(h => !/^Revert\b/.test(h.subject)) ?? hits[0];
    const plusAncien = hits[hits.length - 1];
    const { retire, ajoute } = await this.compte(premier.commit, premier.parents, nom, cibles);
    const commit = premier.commit.slice(0, 10);
    const { ticket, pr } = reference(premier.subject);
    const base = { commit, author: premier.author, date: premier.date, ...(ticket ? { ticket } : {}), ...(pr ? { pr } : {}) };
    if (retire > 0 && ajoute === 0 && premier !== plusAncien) {
      return { kind: 'orphan', ...base, label: libelleDe(premier.subject, commit, premier.date, false) };
    }
    if (retire === 0 && ajoute > 0 && premier === plusAncien) {
      // Born where the history cannot see further: the root commit, which
      // imports a code base more often than it writes one; or a junction, a
      // merge of two histories with no common ancestor. An ordinary pull
      // request merge has a common ancestor and is a birth inside the history.
      const tronque = premier.parents.length === 0 ? 'racine' as const
        : premier.parents.length > 1 && await this.estUneJonction(premier.parents) ? 'jonction' as const : false;
      return { kind: 'born', ...base, truncated: tronque !== false, label: libelleDe(premier.subject, commit, premier.date, tronque) };
    }
    return { kind: 'unattributed', ...base, label: 'moved, renamed or re-added' };
  }

  /** Two parents with no common ancestor: the merge joined an unrelated history. */
  private async estUneJonction(parents: readonly string[]): Promise<boolean> {
    try {
      await this.git(['merge-base', parents[0], parents[1]]);
      return false;
    } catch { return true; }
  }

  /** Lines removed and added that name the symbol, in one commit's diff against its first parent. */
  private async compte(commit: string, parents: readonly string[], nom: string, cibles: readonly string[]): Promise<{ retire: number; ajoute: number }> {
    const diff = parents.length > 0
      ? await this.git(['diff', '--no-ext-diff', `${commit}^1`, commit, '--', ...cibles])
      : await this.git(['show', '--no-ext-diff', '--format=', commit, '--', ...cibles]);
    const re = new RegExp(`\\b${nom}\\b`);
    let retire = 0, ajoute = 0;
    for (const l of diff.split('\n')) {
      if (l.startsWith('---') || l.startsWith('+++')) continue;
      if (l[0] === '-' && re.test(l)) retire++;
      else if (l[0] === '+' && re.test(l)) ajoute++;
    }
    return { retire, ajoute };
  }

  private git(args: readonly string[]): Promise<string> {
    return run(this.gitPath, this.root, args);
  }
}

/** Ticket and pull request read from a commit subject. */
export function reference(subject: string): { ticket?: string; pr?: string } {
  const ticket = TICKET_RE.exec(subject)?.[1];
  const prm = PR_RE.exec(subject);
  const pr = prm?.[1] ?? prm?.[2];
  return { ...(ticket ? { ticket } : {}), ...(pr ? { pr } : {}) };
}

/**
 * What a batch title can say about a cause: the ticket and the pull request
 * when the subject carries them, the commit and its date otherwise. Never the
 * raw subject, which a merge writes for its own purposes.
 */
export function libelleDe(subject: string, commit: string, date: string, tronque: false | 'jonction' | 'racine'): string {
  if (tronque === 'jonction') return `older than the history (${date})`;
  if (tronque === 'racine') return `as old as the history (${date})`;
  const { ticket, pr } = reference(subject);
  if (ticket && pr) return `${ticket} (pull request #${pr})`;
  if (ticket) return ticket;
  if (pr) return `pull request #${pr}`;
  return `commit ${commit} (${date})`;
}

function run(gitPath: string, cwd: string, args: readonly string[]): Promise<string> {
  // Inside a git hook, git exports GIT_DIR, GIT_INDEX_FILE and the author
  // variables to its children; a read of another repository must not inherit
  // them.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    execFile(
      gitPath,
      ['--no-pager', '-c', 'color.ui=never', '-c', 'diff.mnemonicprefix=false', '-c', 'core.quotepath=false', ...args],
      { cwd, env, timeout: DELAI_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}
