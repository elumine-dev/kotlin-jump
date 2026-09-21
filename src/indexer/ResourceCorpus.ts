import * as vscode from 'vscode';
import { DEFAULT_EXCLUDE_PATTERNS } from '../util/pathExclusion';
import { mapBatched } from '../util/batched';
import { rememberCorpusUri } from '../util/corpusUri';
import { makeExclusionMatcher } from '../util/pathExclusion';
import { FileResourceIndex } from './FileResourceIndex';
import { ResourceSource } from '../providers/UnusedResourceProvider';
import { excludeGlob } from '../util/pathExclusion';

/**
 * The workspace corpus KJ-029 reasons over: every source that could reference
 * a resource, plus the index of resource files themselves.
 *
 * Nothing scans at activation. Reads go through `mapBatched` rather than the
 * serial loop the older badge providers use, and a scan that hits the file cap
 * is reported as `truncated` — the detector then produces nothing at all,
 * because an incomplete corpus cannot prove absence.
 */

// NEVER add `.txt` here: R8 writes every resource and class name of the
// build into seeds/usage/mapping.txt, and reading one marks the whole
// project alive. KJ-031 and KJ-032 both depend on that absence.
const SOURCE_GLOB = '**/*.{kt,kts,java,xml,gradle,pro,properties,toml}';
// ServiceLoader entries have no extension and the SPI name IS the file name.
// Two files that name code without being code: a ServiceLoader entry, and a
// Nitro `nitro.json`, whose `autolinking` block names the Kotlin class behind
// each hybrid object. One glob, one read: the corpus witness counts reads.
const SERVICES_GLOB = '**/{META-INF/services/*,nitro.json}';
const RES_GLOB = '**/res/*/*.*';
/**
 * KJ-081 : `assets/` est le SECOND endroit ou un projet Android range des
 * fichiers, et il n'avait aucune representation. 121 fichiers sur le projet de
 * reference, dont des `.json` d'animation et des `.otf`.
 *
 * Lus comme des SOURCES et non comme un index, parce qu'un asset en cite
 * souvent un autre : `assets/css/fonts.css` nomme a lui seul les soixante
 * polices du dossier voisin, et sans son texte elles paraitraient toutes
 * mortes.
 *
 * Mais seuls les assets TEXTUELS portent leur contenu. Les 55 Mo d'assets du
 * projet de reference sont pour l'essentiel des `.otf` ; les decoder en UTF-8
 * et les donner a la recolte de mentions coute plus que tout le reste du scan
 * reuni, pour un gain nul, un binaire ne citant personne. Ils entrent donc
 * avec un texte VIDE : presents comme candidats, muets comme citants.
 */
const ASSETS_GLOB = '**/src/*/assets/**';
/** Les extensions d'assets dont le contenu peut nommer un autre asset. */
const ASSET_TEXTE_RE = /\.(json|css|js|xml|txt|properties|html|htm|svg|md|csv)$/i;
const CACHE_MS = 60_000;
export const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
/** A module other projects consume: maven-publish under every spelling, or a KMP export. */
export const PUBLISHED_MODULE_RE = /maven-publish|mavenPublish|\.publish(?:ing)?\b|\bpublishing\s*\{|cocoapods\s*\{|XCFramework/;

/**
 * `apply false` / `apply(false)` / `.apply(false)`, sur sa ligne ou sur la
 * suivante, plus la ligne entierement commentee.
 *
 * Le filtre ne lisait que `apply false`, la forme Groovy et la forme infixe de
 * Kotlin. `.apply(false)`, la forme d appel du Kotlin DSL, lui echappait : sur
 * le projet de reference, la racine etait comptee parmi les 45 modules
 * bibliotheque a cause de sa ligne
 * `alias(libs.plugins.android.library).apply(false)`.
 */
const NON_APPLIQUE_RE = /\bapply\s*\(\s*false\s*\)|\bapply\s+false\b/;
const COMMENTAIRE_ENTIER_RE = /^\s*\/\//;
/** Une ligne qui COMMENCE par un point est la suite de la precedente. */
const SUITE_DE_CHAINE_RE = /^\s*\./;

/**
 * The ROOT build file lists every plugin of the project with `apply false`:
 * it declares them without applying them. Counting those marked the root as a
 * published module, so the whole workspace read as public API and the dead
 * symbol detector went silent everywhere.
 *
 * Le cout mesure du trou etait cosmetique, `isLibraryModule` ne changeant que
 * le texte des messages. Ce qu il POUVAIT couter ne l etait pas :
 * `PUBLISHED_MODULE_RE` passe par le meme filtre, et `publishedModules` ecarte
 * le candidat. Un projet qui ecrit `alias(libs.plugins.mavenPublish).apply(false)`
 * a sa racine eteignait son detecteur de symboles morts partout, sans un
 * message pour le dire.
 */
export function withoutUnappliedPlugins(gradleText: string): string {
  const lignes = gradleText.split('\n');
  const retirees = new Set<number>();

  for (let i = 0; i < lignes.length; i++) {
    if (COMMENTAIRE_ENTIER_RE.test(lignes[i])) { retirees.add(i); continue; }
    if (!NON_APPLIQUE_RE.test(lignes[i])) continue;
    retirees.add(i);
    // Le formateur Kotlin coupe volontiers les chaines longues :
    //     alias(libs.plugins.android.library)
    //         .apply(false)
    // Le plugin est nomme sur la ligne PRECEDENTE, et c est elle qu il faut
    // retirer. On remonte au dernier maillon qui n est pas lui meme une suite.
    if (!SUITE_DE_CHAINE_RE.test(lignes[i])) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (lignes[j].trim() === '' || COMMENTAIRE_ENTIER_RE.test(lignes[j])) continue;
      retirees.add(j);
      if (!SUITE_DE_CHAINE_RE.test(lignes[j])) break;
    }
  }

  return lignes.filter((_, i) => !retirees.has(i)).join('\n');
}
export const declaresLibraryPlugin = (text: string): boolean => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(text));
export const declaresPublishing   = (text: string): boolean => PUBLISHED_MODULE_RE.test(withoutUnappliedPlugins(text));

export interface Corpus {
  sources: ResourceSource[];
  index: FileResourceIndex;
  modulesWithCode: string[];
  libraryModules: string[];
  /** OR of every cap and read failure. Kept for existing consumers. */
  truncated: boolean;
  /**
   * Only the SOURCE side: the file cap or a read failure, never the `res/`
   * cap. A project with 12000 files under `res/*​/` would otherwise disable
   * KJ-032 for a reason that has nothing to do with Kotlin symbols.
   */
  sourcesTruncated: boolean;
  /**
   * KJ-081 : les fichiers de `src/main/assets/`, hors de `sources`.
   *
   * Un asset est souvent un bloc de donnees ; son texte donne a la recolte
   * generale garderait en vie toute declaration dont le nom y figure par
   * hasard. Il ne sert qu'a decider de la vie d'un AUTRE asset.
   */
  assets: ResourceSource[];
  /** Module directories, for callers that need the module layout. */
  moduleDirs: string[];
}

export class ResourceCorpus {
  private cache: { at: number; corpus: Corpus } | undefined;
  private refreshing = false;
  /**
   * Bumped by every invalidation, captured by every scan.
   *
   * Emptying the cache was not enough: a scan already in flight writes its
   * result when it resolves, and that result was read BEFORE the change. The
   * write undid the invalidation and re-stamped a fresh `at`, so the
   * pre-change corpus was served for a further CACHE_MS with no disk read at
   * all. The window is the whole scan, which on a real project is half a
   * second of reads for 6340 files, and every dead code command opens it.
   * A verdict computed there says a live key is unused, and "Remove All"
   * applies the deletion: the offsets are re-checked before writing, the
   * VERDICT never is.
   */
  private generation = 0;

  invalidate(): void {
    this.cache = undefined;
    this.generation++;
  }

  /**
   * An open editor edited since the scan: the cached offsets no longer match
   * its text, and a quick fix computed on them deleted the wrong lines.
   */
  private cacheIsStale(corpus: Corpus): boolean {
    for (const d of vscode.workspace.textDocuments) {
      if (!d.isDirty) continue;
      const src = corpus.sources.find(s => s.path === d.uri.fsPath);
      if (src && src.text !== d.getText()) return true;
    }
    return false;
  }

  /** Serves a stale corpus immediately while refreshing behind it. */
  async get(token?: vscode.CancellationToken): Promise<Corpus> {
    if (this.cache && this.cacheIsStale(this.cache.corpus)) this.cache = undefined;
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.corpus;
    if (this.cache && !this.refreshing) {
      this.refreshing = true;
      const nee = this.generation;
      void this.scan()
        .then(c => { if (nee === this.generation) this.cache = { at: Date.now(), corpus: c }; })
        .finally(() => { this.refreshing = false; });
      return this.cache.corpus;
    }
    // A scan cut short by Cancel skipped files without marking anything:
    // cached, it served "unreferenced" verdicts for symbols the unread files
    // use, and "Remove All" deleted live code on the next click.
    //
    // And a scan whose generation moved read the disk BEFORE the change.
    // Refusing to cache that one is only half the answer: the caller waiting
    // on this very scan is the command about to delete, and handing it a
    // corpus this class has just judged unfit to keep is the dangerous half.
    // The text of each file is checked again before writing, so a file that
    // moved is skipped; the VERDICT never is. A save that adds a use of the
    // symbol SOMEWHERE ELSE leaves the declaring file untouched, its cut
    // passes the text check, and something live goes.
    //
    // So it reads again. Bounded, because a build writing files can keep
    // invalidating with no pause: after three tries the freshest read we have
    // is returned, still without caching it. A scan is half a second of disk
    // on a real project, and this only happens when a change lands inside
    // that window.
    const ESSAIS_MAX = 3;
    let corpus!: Corpus;
    for (let essai = 0; essai < ESSAIS_MAX; essai++) {
      const nee = this.generation;
      corpus = await this.scan(token);
      if (token?.isCancellationRequested) return corpus;
      if (nee === this.generation) {
        this.cache = { at: Date.now(), corpus };
        return corpus;
      }
    }
    return corpus;
  }

  private async scan(token?: vscode.CancellationToken): Promise<Corpus> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const maxFiles = cfg.get<number>('maxIndexedFiles', 10000);
    const patterns = cfg.get<string[]>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);
    // Belt for what the glob cannot express (picomatch is stricter than the
    // VS Code glob), applied on the already-narrowed result.
    const isExcluded = makeExclusionMatcher(patterns, (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.path));

    // The cap MUST be applied after exclusion, not before. Passing no exclude
    // here let VS Code fill the 10000 slots with `build/` output on a project
    // that has been built, hit the cap, and report a truncated corpus, which
    // silently disables every detector that reasons over absence.
    const motifExclu = excludeGlob(patterns);

    const [sourceUris, resUris, buildUris, serviceUris, assetUris] = await Promise.all([
      vscode.workspace.findFiles(SOURCE_GLOB, motifExclu, maxFiles),
      vscode.workspace.findFiles(RES_GLOB, motifExclu, maxFiles),
      vscode.workspace.findFiles('**/build.gradle{,.kts}', motifExclu, 500),
      vscode.workspace.findFiles(SERVICES_GLOB, motifExclu, 200),
      vscode.workspace.findFiles(ASSETS_GLOB, motifExclu, 2000),
    ]);

    // Hitting the cap means we may have missed the one reference that matters.
    const sourcesCapped = sourceUris.length >= maxFiles;
    const truncated = sourcesCapped || resUris.length >= maxFiles;

    const keptSources = [...sourceUris, ...serviceUris].filter(u => !isExcluded(u.fsPath));
    // KJ-081 : `src/main/assets/` SEULEMENT, et dans son propre champ. Un
    // autre source set n'est pas forcement construit par la variante courante,
    // et son texte n'a rien a faire dans la recolte generale.
    const keptAssets = assetUris.filter(
      u => !isExcluded(u.fsPath) && /[\\/]src[\\/]main[\\/]assets[\\/]/.test(u.fsPath));
    const keptRes = resUris.filter(u => !isExcluded(u.fsPath));

    const moduleDirs = buildUris
      .filter(u => !isExcluded(u.fsPath))
      .map(u => u.fsPath.replace(/[\\/]build\.gradle(\.kts)?$/, ''));

    const decoder = new TextDecoder();
    let readFailed = false;
    const sources: ResourceSource[] = [];
    // Offsets from the disk copy were applied to open documents with unsaved
    // edits, and a deletion landed a few characters off, leaving a fragment
    // that did not compile. The editor's text is the truth for open files.
    const open = new Map<string, string>();
    for (const d of vscode.workspace.textDocuments) {
      if (d.isDirty) open.set(d.uri.fsPath, d.getText());
    }
    await mapBatched(keptSources, async uri => {
      if (token?.isCancellationRequested) { readFailed = true; return; }
      try {
        const fromEditor = open.get(uri.fsPath);
        sources.push({ path: rememberCorpusUri(uri), text: fromEditor ?? decoder.decode(await vscode.workspace.fs.readFile(uri)) });
      } catch {
        // one unreadable file is enough to void the "nothing references it" claim
        readFailed = true;
      }
    });

    // Un asset BINAIRE entre par son chemin seul : il ne cite personne, et le
    // decoder coute 55 Mo de texte sur le projet de reference.
    const assets: ResourceSource[] = [];
    await mapBatched(keptAssets, async uri => {
      if (!ASSET_TEXTE_RE.test(uri.fsPath)) {
        assets.push({ path: rememberCorpusUri(uri), text: '' });
        return;
      }
      try {
        assets.push({ path: rememberCorpusUri(uri), text: decoder.decode(await vscode.workspace.fs.readFile(uri)) });
      } catch {
        assets.push({ path: rememberCorpusUri(uri), text: '' });
      }
    });

    const index = new FileResourceIndex();
    for (const uri of keptRes) index.addFile(rememberCorpusUri(uri), moduleDirs);

    const modulesWithCode = moduleDirs.filter(dir =>
      sources.some(s => s.path.startsWith(`${dir}/`) && /\.(kt|java)$/.test(s.path)),
    );
    const libraryModules = moduleDirs.filter(dir =>
      // `alias(libs.plugins.android.library)` and convention plugins spell the
      // plugin without `com.android.library`.
      sources.some(s => s.path.startsWith(`${dir}/build.gradle`) && declaresLibraryPlugin(s.text)),
    );

    return {
      sources, assets, index, modulesWithCode, libraryModules, moduleDirs,
      truncated: truncated || readFailed,
      sourcesTruncated: sourcesCapped || readFailed,
    };
  }
}
