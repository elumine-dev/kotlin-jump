import * as vscode from 'vscode';
import { FileScanner } from '../indexer/FileScanner';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { evict } from '../util/ImportResolver';
import { Logger } from '../util/logger';

/**
 * Above this many files in one quiet-window, the flush switches from
 * per-file parallel handling to sequential batch mode. A human edits a
 * handful of files; a git checkout / rebase / stash pop changes hundreds
 * at once, and handling those in parallel starves the extension host —
 * including VS Code's own git extension, which shares it.
 */
const BURST_THRESHOLD = 8;

const SOURCE_EXT_RE = /\.(?:kt|kts|java)$/;

export class FileWatcher implements vscode.Disposable {
  private readonly ktWatcher:   vscode.FileSystemWatcher;
  private readonly javaWatcher: vscode.FileSystemWatcher;
  private readonly treeWatcher: vscode.FileSystemWatcher;
  private readonly pendingScan = new Set<string>();
  /**
   * Les URIs dont un scan tourne EN CE MOMENT. `removeTree` a besoin de
   * celles là, pas de tout l'historique : parcourir `epoque` coûtait 406 ms
   * pour 200 suppressions de dossier une fois 50 000 fichiers vus, alors que
   * cet ensemble tient dans la poignée de scans concurrents.
   */
  private readonly enVol = new Set<string>();

  /**
   * URIs actuellement supprimees. Le compteur d'epoques disait seulement
   * « quelque chose est arrive », et un scan declare perime retirait l'entree
   * de l'index sans savoir quoi. Quand deux scans du meme fichier se
   * chevauchent, ce que des sauvegardes rapprochees produisent, chacun ajoute
   * le fichier puis les perimes le retirent, y compris l'ajout qu'un scan
   * valide venait d'ecrire : le fichier disparaissait alors qu'il etait la.
   * Ici la question est exacte, « ce fichier est il supprime en ce moment »,
   * et une recreation efface la marque.
   */
  private readonly supprimes = new Set<string>();

  /**
   * Dossiers supprimes pendant un balayage, repris en une passe a la fin,
   * chacun avec le rang de sa suppression. Sans ce rang la reprise effacait un
   * fichier RECREE depuis : elle travaille sur des prefixes captures plus tot
   * et ne pouvait pas savoir qu'il etait revenu entre temps.
   */
  private aRejouer = new Map<string, number>();
  private rejeuArme = false;
  /** Rang de la derniere remise en file, tenu seulement pendant une reprise. */
  private recrees = new Map<string, number>();
  private rang = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly scanner: FileScanner,
    private readonly index: SymbolIndex,
    private readonly onFileIndexed?: (uri: vscode.Uri) => void,
    private readonly log?: Logger,
    // Called ONCE after a burst-sized batch instead of onFileIndexed per
    // file: per-file test-tree refreshes are O(tests) each, so N of them
    // during a checkout is O(N × tests) for a result one discovery pass
    // gets in O(tests).
    private readonly onBurstIndexed?: (uris: vscode.Uri[]) => void,
    // Matches the same excludePatterns the initial findFiles scan used
    // (build/, .gradle/). Without it, a Gradle build's regenerated sources
    // storm the watcher even though we never index them.
    private readonly isExcluded: (path: string) => boolean = () => false,
  ) {
    this.ktWatcher = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts}');
    this.ktWatcher.onDidCreate(uri => this.queue(uri));
    this.ktWatcher.onDidChange(uri => this.queue(uri));
    this.ktWatcher.onDidDelete(uri => this.onDeleted(uri));

    this.javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
    this.javaWatcher.onDidCreate(uri => this.queue(uri));
    this.javaWatcher.onDidChange(uri => this.queue(uri));
    this.javaWatcher.onDidDelete(uri => this.onDeleted(uri));

    // A folder deleted outside VS Code (rm -rf, a checkout) is one event for
    // the folder path, which `**/*.kt` never matches: its files stayed
    // indexed, Cmd+T still listed them and Cmd+Click opened "file not found".
    this.treeWatcher = vscode.workspace.createFileSystemWatcher('**', true, true, false);
    // Without the exclusion filter, every `.class` removed by a `gradlew
    // clean` triggered a full sweep of the index.
    this.treeWatcher.onDidDelete(uri => {
      if (SOURCE_EXT_RE.test(uri.path) || this.isExcluded(uri.path)) return;
      this.removeTree(uri);
    });
  }

  /** Drops every indexed file under `folder` (a deleted or renamed folder, a removed workspace folder). */
  removeTree(folder: vscode.Uri): vscode.Uri[] {
    if (SOURCE_EXT_RE.test(folder.path)) return [];
    const prefix = folder.toString().replace(/\/$/, '') + '/';
    const dansIndex = this.index.fileUriStrings().filter(k => k.startsWith(prefix));
    // Deux familles échappent à l'index. Un fichier dont le scan est EN VOL en
    // a été retiré par `flush` juste avant le lancement du scan, et son ajout
    // tardif ressusciterait un fichier d'un dossier effacé. Un fichier ENCORE
    // EN FILE n'y est jamais entré : tout neuf, sa fenêtre d'anti rebond court
    // toujours, et sans le sortir de la file le flush le scanne après coup.
    // Les deux ensembles sont petits, contrairement à l'historique complet des
    // fichiers vus, dont la relecture coûtait 406 ms par vague de suppressions.
    const connus = [...this.enVol].filter(k => k.startsWith(prefix));
    const enAttente = [...this.pendingScan].filter(k => k.startsWith(prefix));
    for (const cle of new Set([...dansIndex, ...connus, ...enAttente])) {
      this.noterSuppression(vscode.Uri.parse(cle));
      this.pendingScan.delete(cle);
    }
    // Programme AVANT le retour anticipe : au moment ou le dossier disparait,
    // un fichier que le balayage initial est en train de parser n'est pas
    // encore dans l'index, donc `gone` est vide et ce retour sautait le rejeu.
    this.rejouerApresBalayage(folder);
    const gone = dansIndex.map(k => vscode.Uri.parse(k));
    if (gone.length === 0) return gone;
    this.log?.info(`[watcher] folder gone: ${fileName(folder)} — ${gone.length} file(s) dropped`);
    for (const uri of gone) {
      evict(uri);
      this.index.remove(uri);
    }
    this.notify(gone);
    return gone;
  }

  /**
   * Le balayage initial ne passe pas par le veilleur : ses fichiers ne sont ni
   * indexes, ni en file, ni dans `enVol`. Ceux dont les octets sont deja lus
   * quand le dossier disparait sont ajoutes juste apres. On rejoue donc la
   * suppression une fois le balayage fini, ce qui ne coute rien tant qu'aucun
   * balayage ne tourne. Un seul rappel : au second passage le scanner est au
   * repos, donc rien ne se reprogramme.
   */
  private rejouerApresBalayage(folder: vscode.Uri): void {
    const s = this.scanner as { busy?: () => boolean; whenIdle?: () => Promise<void> };
    if (s.busy?.() !== true || s.whenIdle === undefined) return;
    this.aRejouer.set(folder.toString().replace(/\/$/, '') + '/', ++this.rang);
    if (this.rejeuArme) return;   // une seule reprise pour toute la vague
    this.rejeuArme = true;
    void s.whenIdle().then(() => {
      this.rejeuArme = false;
      const prefixes = this.aRejouer;
      this.aRejouer = new Map();
      this.purger(prefixes);
    });
  }

  /**
   * Reprend en UNE passe tous les dossiers supprimes pendant un balayage.
   * Un rejeu par dossier rappelait `removeTree`, qui relit tout l'index a
   * chaque fois : une vague de 200 suppressions doublait de 433 a 853 ms sur
   * 50 000 fichiers. L'appartenance est testee en remontant les parents du
   * chemin, une poignee de lectures dans un ensemble, au lieu d'un
   * `startsWith` par dossier supprime.
   */
  private purger(prefixes: ReadonlyMap<string, number>): void {
    if (prefixes.size === 0) { this.recrees.clear(); return; }
    const gone: vscode.Uri[] = [];
    for (const cle of this.index.fileUriStrings()) {
      let i = cle.lastIndexOf('/');
      let rangSuppression: number | undefined;
      while (i > 0) {
        const r = prefixes.get(cle.slice(0, i + 1));
        if (r !== undefined) { rangSuppression = r; break; }
        i = cle.lastIndexOf('/', i - 1);
      }
      if (rangSuppression === undefined) continue;
      // Remis en file APRES la suppression : il est revenu, on n'y touche pas.
      if ((this.recrees.get(cle) ?? -1) > rangSuppression) continue;
      const uri = vscode.Uri.parse(cle);
      this.noterSuppression(uri);
      this.pendingScan.delete(cle);
      evict(uri);
      this.index.remove(uri);
      gone.push(uri);
    }
    this.recrees.clear();
    if (gone.length > 0) {
      this.log?.info(`[watcher] ${gone.length} file(s) dropped after the scan settled`);
      this.notify(gone);
    }
  }

  /** Indexes every source file under a folder that appeared (rename target, added workspace folder). */
  async addTree(folder: vscode.Uri): Promise<vscode.Uri[]> {
    if (SOURCE_EXT_RE.test(folder.path)) return [];
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*.{kt,kts,java}'),
      `{${excludeList.join(',')}}`,
      cfg.get<number>('maxIndexedFiles') ?? 10000,
    );
    const uris = found.filter(u => !this.isExcluded(u.path));
    if (uris.length === 0) return uris;
    this.log?.info(`[watcher] folder added: ${fileName(folder)} — ${uris.length} file(s)`);
    for (const uri of uris) { evict(uri); this.index.remove(uri); this.enVol.add(uri.toString()); }
    try { await this.scanner.scanFiles(uris); }
    finally { for (const uri of uris) this.enVol.delete(uri.toString()); }
    // Un dossier supprimé pendant le scan de son remplaçant laissait ses
    // fichiers indexés, par le même chemin que le cas fichier par fichier.
    // Une seule passe : `vivants.includes(u)` dans une boucle sur `uris` était
    // quadratique, et rien ne bouge dans le cas courant, donc le cas courant
    // était le pire cas. 12 ms au plafond de 10 000 fichiers, 66 ms à 24 000.
    const vivants: vscode.Uri[] = [];
    for (const u of uris) {
      const cle = u.toString();
      if (!this.supprimes.has(cle)) vivants.push(u);
      else this.index.remove(u);
    }
    this.notify(vivants);
    return uris;
  }

  private notify(uris: vscode.Uri[]): void {
    if (uris.length > BURST_THRESHOLD && this.onBurstIndexed) this.onBurstIndexed(uris);
    else for (const uri of uris) this.onFileIndexed?.(uri);
  }

  /**
   * Create and change events share one queue with a GLOBAL quiet-window
   * timer: every new event pushes the flush back, so a checkout's whole
   * event storm lands in a single batch once the storm goes quiet. The
   * old per-file debounce turned a 500-file checkout into 500 timers
   * expiring simultaneously.
   */
  /** Une SUPPRESSION périme les scans déjà en vol pour ce fichier. */
  private noterSuppression(uri: vscode.Uri): void {
    this.supprimes.add(uri.toString());
  }

  /** Scanne, puis jette le résultat si un événement l'a dépassé entre temps. */
  private async scanEncoreValide(uri: vscode.Uri): Promise<boolean> {
    const cle = uri.toString();
    this.enVol.add(cle);
    try { await this.scanner.scanFile(uri); } catch { /* illisible en plein checkout */ }
    finally { this.enVol.delete(cle); }
    // Le fichier est il supprime MAINTENANT ? Une modification survenue
    // pendant le scan n'a pas besoin de ce filet : le scan suivant reecrit
    // l'entree, et la retirer ici effacerait son travail.
    const perime = this.supprimes.has(cle);
    if (perime) this.index.remove(uri);
    // Borne l'ensemble sur les DEUX sorties : ne le vider qu'en cas de succes
    // le laissait grossir tant qu'un scan perime terminait en dernier.
    if (this.enVol.size === 0) this.supprimes.clear();
    return !perime;
  }

  private queue(uri: vscode.Uri): void {
    // Drop build/ and .gradle/ churn before it ever enters the batch.
    if (this.isExcluded(uri.path)) return;
    // Une recreation pendant qu'une reprise est en attente doit survivre a
    // cette reprise : on note son rang pour la departager de la suppression.
    if (this.aRejouer.size > 0) this.recrees.set(uri.toString(), ++this.rang);
    this.supprimes.delete(uri.toString());
    this.pendingScan.add(uri.toString());
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const debounceMs = vscode.workspace.getConfiguration('kotlinJump').get<number>('watcherDebounceMs', 150);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.pendingScan.size === 0) return;
    const uris = [...this.pendingScan].map(s => vscode.Uri.parse(s));
    this.pendingScan.clear();

    if (uris.length <= BURST_THRESHOLD) {
      // Normal editing: parallel scans, per-file notification (existing behavior).
      for (const uri of uris) {
        this.log?.debug(`[watcher] changed: ${fileName(uri)} — re-indexing`);
        evict(uri);
        this.index.remove(uri);
        void this.scanEncoreValide(uri).then(valide => { if (valide) this.onFileIndexed?.(uri); });
      }
      return;
    }

    // Burst mode: sequential with an event-loop yield between files, so the
    // extension host stays responsive while git churns the working tree.
    this.log?.info(`[watcher] burst of ${uris.length} files (checkout/rebase?) — sequential scan, single refresh`);
    for (const uri of uris) {
      evict(uri);
      this.index.remove(uri);
      await this.scanEncoreValide(uri);
      await new Promise<void>(r => setTimeout(r, 0));
    }
    if (this.onBurstIndexed) this.onBurstIndexed(uris);
    else for (const uri of uris) this.onFileIndexed?.(uri);
  }

  private onDeleted(uri: vscode.Uri): void {
    this.log?.info(`[watcher] deleted: ${fileName(uri)}`);
    this.noterSuppression(uri);
    this.pendingScan.delete(uri.toString());
    evict(uri);
    this.index.remove(uri);
    // The same listeners as after a scan: without them a deleted sealed
    // subtype kept its "missing branch" lens, a deleted class kept its
    // colour in open editors and its "N usages" kept counting.
    this.onFileIndexed?.(uri);
  }

  dispose(): void {
    this.ktWatcher.dispose();
    this.javaWatcher.dispose();
    this.treeWatcher.dispose();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pendingScan.clear();
    this.enVol.clear();
    this.supprimes.clear();
    this.aRejouer.clear();
    this.recrees.clear();
  }
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}
