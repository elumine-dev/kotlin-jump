/**
 * Applies ONE removal, the one you name, and nothing else.
 *
 *   npx vite-node scripts/apply-one-removal.ts <project-root> --name=X|--names=X,Y [--path=sub]
 *       [--family=symboles] [--apply] [--build=:app:assembleDebug] [--restore]
 *
 * Why this exists next to `apply-kj-removals.ts`. That script applies the whole
 * plan and loops to the fixed point: it is the audit, and it rewrites hundreds
 * of files. To find out whether ONE fix produces a compiling workspace, that is
 * the wrong instrument — a Gradle failure after 400 cuts says nothing about
 * which cut broke it, and undoing means restoring the whole tree.
 *
 * This one collects the SAME plan, through the same `collecterUnePasse`, then
 * keeps only the cuts that name your target. What it writes is a subset of what
 * the command would write, so a build that fails here is a real defect of that
 * cut, and a build that passes is real evidence for it.
 *
 * The import cascade comes along, because it must: removing a declaration and
 * leaving the import that names it does not compile, and that is exactly the
 * kind of error this script exists to catch.
 *
 * ## The loop it is built for
 *
 *   --name=Foo                 see the cut, nothing written
 *   --name=Foo --apply         write it
 *   --name=Foo --apply --build=:app:assembleDebug
 *   --restore                  put the workspace back
 *
 * ## Use it on a worktree, never on the tree you work in
 *
 * `--restore` runs `git checkout --` on the files it touched. On a tree with
 * uncommitted work that would destroy it, so the script refuses to write when
 * the target files already carry local changes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import { collecterUnePasse, coupesRetenues, plagesDuFichier } from '../src/commands/RemoveEverythingUnused';
import { planCascade } from '../src/providers/removalCascade';
import { FileResourceIndex } from '../src/indexer/FileResourceIndex';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$|[\\/]nitro\.json$/;
const RES_RE = /\.(xml|png|webp|svg|jpg|jpeg|gif|bmp|json|txt|mp3|mp4|ogg|wav|ttf|otf|lottie)$/i;
const EXCLUDED_DIRS = new Set(['.git', 'build', '.gradle', 'node_modules', '.idea', 'out', 'dist']);

const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
const withoutUnappliedPlugins = (t: string) => t.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');
const declaresLibraryPlugin = (t: string) => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(t));

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) walk(full, hit); }
    else hit(full);
  }
}

const ASSET_TEXTE_RE = /\.(json|css|js|xml|txt|properties|html|htm|svg|md|csv)$/i;

function readCorpus(root: string) {
  const sources: { path: string; text: string }[] = [];
  const assets: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  const index = new FileResourceIndex();
  const resFiles: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    if (RES_RE.test(file)) resFiles.push(file);
    // KJ-081 : `src/main/assets/` dans son propre canal, jamais dans `sources`.
    if (/[\\/]src[\\/]main[\\/]assets[\\/]/.test(file)) {
      if (!ASSET_TEXTE_RE.test(file)) assets.push({ path: file, text: '' });
      else { try { assets.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { assets.push({ path: file, text: '' }); } }
    } else if (SOURCE_RE.test(file) || /[\\/]META-INF[\\/]services[\\/]/.test(file)) {
      try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
    }
  });
  for (const file of resFiles) index.addFile(file, moduleDirs);
  return {
    sources,
    assets,
    moduleDirs,
    modulesWithCode: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path))),
    libraryModules: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && declaresLibraryPlugin(s.text))),
    resourceEntries: index.entries(),
  };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
const offsetOf = (starts: readonly number[], line: number, character: number) =>
  (starts[line] ?? starts[starts.length - 1] ?? 0) + character;
const lineOf = (starts: readonly number[], offset: number) => {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo;
};

/** The files git already sees as changed: writing over them loses work. */
function dejaModifies(root: string): Set<string> {
  try {
    const out = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
    return new Set(out.split('\n').filter(Boolean).map(l => path.join(root, l.slice(3).trim())));
  } catch { return new Set(); }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  const arg = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  // `--names=a,b` : un îlot est collecté comme des coupes INDÉPENDANTES, une
  // par membre. N'en retirer qu'une laisse l'autre appeler ce qui vient de
  // partir, donc une erreur de compilation qui n'apprend rien sur le correctif.
  // Nommer le groupe entier est le seul moyen honnête de tester un îlot.
  const noms = (arg('names') ?? arg('name') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const name = noms.join(',');
  const sousChemin = arg('path');
  const famille = arg('family');
  const doApply = args.includes('--apply');
  const build = arg('build');
  const restore = args.includes('--restore');

  if (!root) {
    console.error('usage: apply-one-removal.ts <project-root> --name=X [--path=sub] [--family=f] [--apply] [--build=task] [--restore]');
    process.exit(2);
  }

  if (restore) {
    const manifeste = path.join(root, '.kj-one-removal.json');
    if (!fs.existsSync(manifeste)) { console.error('rien à restaurer : pas de .kj-one-removal.json'); process.exit(1); }
    const { touches } = JSON.parse(fs.readFileSync(manifeste, 'utf8')) as { touches: string[] };
    if (touches.length > 0) {
      execFileSync('git', ['-C', root, 'checkout', '--', ...touches], { stdio: 'inherit' });
    }
    fs.rmSync(manifeste, { force: true });
    console.log(`restauré : ${touches.length} fichier(s)`);
    return;
  }

  if (noms.length === 0 && arg('file') === undefined) {
    console.error('--name=X (ou --names=X,Y), ou --file=<fragment> pour un fichier supprime en entier');
    process.exit(2);
  }

  const segs = DEFAULT_TEST_SEGMENTS as readonly string[];
  const corpus = readCorpus(root);
  console.log(`sources ${corpus.sources.length}  modules ${corpus.modulesWithCode.length}  ressources ${corpus.resourceEntries.length}`);

  const { parFichier, fichiersMorts, tally } = collecterUnePasse(corpus.sources, segs, {
    modulesWithCode: corpus.modulesWithCode,
    libraryModules: corpus.libraryModules,
    moduleDirs: corpus.moduleDirs,
    resourceEntries: corpus.resourceEntries,
    assets: corpus.assets,
  });

  // KJ-081 : une cible peut aussi etre un FICHIER que le plan supprime en
  // entier, ce que `--name` ne sait pas designer : un asset mort ou une
  // ressource morte sortent par `fichiersMorts`, pas par une coupe nommee.
  // `--file=<fragment>` en supprime UN, et un seul.
  const fragment = arg('file');
  if (fragment !== undefined) {
    const cibles = [...fichiersMorts].filter(f => f.includes(fragment));
    if (cibles.length === 0) {
      console.log(`AUCUN fichier mort dont le chemin contient « ${fragment} ».`);
      console.log(`le plan en compte ${fichiersMorts.size}`);
      return;
    }
    console.log(`\n${cibles.length} fichier(s) mort(s) correspondant a « ${fragment} » :`);
    for (const f of cibles) console.log(`   ${path.relative(root, f)}`);
    if (!doApply) { console.log('\nessai a blanc : rien ecrit. Ajouter --apply.'); return; }

    const relatifs = cibles.map(f => path.relative(root, f));
    const dejaTouches = dejaModifies(root);
    const collisions = cibles.filter(f => dejaTouches.has(f));
    if (collisions.length > 0) {
      console.error('\nREFUS : du travail non commite touche deja ces fichiers.');
      for (const f of collisions) console.error(`   ${path.relative(root, f)}`);
      process.exit(1);
    }
    for (const f of cibles) fs.rmSync(f, { force: true });
    fs.writeFileSync(path.join(root, '.kj-one-removal.json'),
      JSON.stringify({ name: fragment, touches: relatifs }, null, 2));
    console.log(`\nsupprime : ${cibles.length} fichier(s). --restore pour revenir en arriere.`);
    compiler(root, build);
    return;
  }

  // La cible, et rien d'autre. `quoi` porte le nom de la déclaration coupée.
  const garde = new Map<string, any[]>();
  let vus = 0;
  for (const [p, list] of parFichier) {
    if (sousChemin && !p.includes(sousChemin)) continue;
    const kept = list.filter(c => {
      if (!noms.includes(c.quoi)) return false;
      if (famille && c.famille !== famille) return false;
      return true;
    });
    vus += kept.length;
    if (kept.length > 0) garde.set(p, kept);
  }

  if (vus === 0) {
    const proches = [...parFichier.values()].flat().filter((c: any) => noms.some(n => c.quoi?.includes(n))).slice(0, 8);
    console.log(`\nAUCUNE coupe nommée « ${name} » dans le plan.`);
    console.log(`le plan entier compte ${Object.values(tally).reduce((a, b) => a + b, 0)} coupes`);
    if (proches.length > 0) {
      console.log('noms proches trouvés :');
      for (const c of proches as any[]) console.log(`   ${c.famille}: ${c.quoi}`);
    }
    process.exit(1);
  }

  console.log(`\n${vus} coupe(s) nommée(s) « ${name} », dans ${garde.size} fichier(s) :`);
  for (const [p, list] of garde) {
    const starts = lineStarts(corpus.sources.find(s => s.path === p)!.text);
    for (const c of list) {
      console.log(`   ${c.famille.padEnd(12)} ${path.relative(root, p)}:${lineOf(starts, c.start) + 1}`);
    }
  }

  const textes = new Map(corpus.sources.map(s => [s.path, s.text]));
  const { retenu } = coupesRetenues(garde as any, textes);
  if (retenu.size === 0) { console.log('\naucune coupe retenue (le texte a bougé sur le disque)'); process.exit(1); }

  // La cascade des imports vient avec : retirer la déclaration et laisser
  // l'import qui la nomme ne compile pas, et c'est précisément l'erreur que ce
  // script existe pour attraper.
  const cascade = planCascade(
    new Map([...retenu].map(([p, l]) => [p, l.map((c: any) => ({ start: c.start, end: c.end }))])),
    textes,
    new Set<string>(),
  );

  // Le refus de travail non commité vient AVANT la moindre écriture. Écrire
  // puis refuser laisse le fichier coupé sur le disque, ce que la première
  // version faisait : le garde-fou arrivait après la boucle d'écriture.
  const modifies = doApply ? dejaModifies(root) : new Set<string>();

  const touches: string[] = [];
  const apercu: string[] = [];
  const aEcrire: { p: string; out: string }[] = [];
  const aSupprimer: string[] = [];
  for (const p of new Set([...retenu.keys(), ...cascade.imports.keys()])) {
    if (cascade.deleteFiles.has(p)) continue;
    const texte = textes.get(p);
    if (texte === undefined) continue;
    const plages = plagesDuFichier(p, texte, (retenu.get(p) ?? []) as any, cascade.imports.get(p));
    if (plages === undefined) continue;
    const starts = lineStarts(texte);
    const spans = plages
      .map(r => ({
        start: offsetOf(starts, r.start.line, r.start.character),
        end: offsetOf(starts, r.end.line, r.end.character),
        texte: r.texte,
        quoi: (r as any).quoi,
      }))
      .sort((a, b) => a.start - b.start);
    let out = texte;
    for (const s of [...spans].reverse()) out = out.slice(0, s.start) + s.texte + out.slice(s.end);
    if (out === texte) continue;
    touches.push(path.relative(root, p));
    aEcrire.push({ p, out });
    const perdues = texte.split('\n').length - out.split('\n').length;
    apercu.push(`   ${path.relative(root, p)}  ${spans.length} coupe(s), ${perdues} ligne(s)`);
    for (const s of spans.slice(0, 3)) {
      const extrait = texte.slice(s.start, Math.min(s.end, s.start + 90)).split('\n')[0];
      apercu.push(`      ligne ${lineOf(starts, s.start) + 1} : ${extrait.trim()}${s.end - s.start > 90 ? ' …' : ''}`);
    }
  }

  for (const p of cascade.deleteFiles) {
    touches.push(path.relative(root, p));
    aSupprimer.push(p);
    apercu.push(`   ${path.relative(root, p)}  FICHIER SUPPRIMÉ`);
  }

  console.log('\nce que ça touche :');
  for (const l of apercu) console.log(l);

  if (fichiersMorts.size > 0) {
    console.log(`\n(${fichiersMorts.size} fichier(s) de ressource morts dans le plan complet : ignorés ici)`);
  }

  if (!doApply) { console.log('\nessai à blanc : rien écrit. Ajouter --apply.'); return; }

  const collisions = touches.map(t => path.join(root, t)).filter(f => modifies.has(f));
  if (collisions.length > 0) {
    console.error('\nREFUS : ces fichiers portent déjà des modifications locales, rien n\'a été écrit :');
    for (const c of collisions) console.error(`   ${path.relative(root, c)}`);
    console.error('utiliser un worktree propre.');
    process.exit(1);
  }

  for (const { p, out } of aEcrire) fs.writeFileSync(p, out);
  for (const p of aSupprimer) fs.rmSync(p, { force: true });

  fs.writeFileSync(path.join(root, '.kj-one-removal.json'), JSON.stringify({ name, touches }, null, 2));
  console.log(`\nécrit : ${touches.length} fichier(s). --restore pour revenir en arrière.`);

  compiler(root, build);
}

/**
 * La compilation, et son REJEU.
 *
 * Extraite pour servir aux deux cibles : une coupe nommee et un fichier que le
 * plan supprime en entier.
 */
function compiler(root: string, build: string | undefined): void {
  if (!build) return;
    // Plusieurs tâches, séparées par des virgules : le dépôt porte DEUX
    // applications, et une coupe dans l'une ne recompile rien si on ne
    // demande que l'autre. Le premier essai a rendu « COMPILE en 2 s »
    // pour un fichier que la tâche ne touchait pas.
    const taches = build.split(',').map(s => s.trim()).filter(Boolean);
    console.log(`\ncompilation : ${taches.join(' ')}`);

    // DEUX essais, et le second n'est pas de la complaisance.
    //
    // Trois fois sur cette serie, une tache `kspDebugKotlin` a rendu
    // PROCESSING_ERROR sur un type Dagger genere juste apres un `--restore`,
    // puis a compile la MEME coupe au tour suivant. Le cache incremental de
    // KSP voit un etat intermediaire ; la coupe, elle, ne touchait qu'une
    // valeur de ressource ou un membre que rien n'appelle.
    //
    // Le rejouer ici plutot qu'a la main evite la seule erreur qui compte :
    // prendre un echec de cache pour un echec du correctif, ou l'inverse. Les
    // deux essais sont rapportes, et un vert au second l'annonce comme tel.
    const essai = (): { ok: boolean; secondes: number } => {
      const debut = Date.now();
      try {
        execFileSync('./gradlew', [...taches, '--quiet'], { cwd: root, stdio: 'inherit', timeout: 60 * 60 * 1000 });
        return { ok: true, secondes: Math.round((Date.now() - debut) / 1000) };
      } catch {
        return { ok: false, secondes: Math.round((Date.now() - debut) / 1000) };
      }
    };

    const premier = essai();
    if (premier.ok) {
      console.log(`\nCOMPILE ✅  (${premier.secondes} s)`);
      return;
    }
    console.error(`\npremier essai en echec (${premier.secondes} s) — on rejoue a l'identique`);
    const second = essai();
    if (second.ok) {
      console.log(`\nCOMPILE ✅  (${second.secondes} s, vert au SECOND essai :`
        + ` le premier echec vient de l'etat du cache, pas de la coupe)`);
      return;
    }
    console.error(`\nÉCHEC DE COMPILATION ❌  (deux essais : ${premier.secondes} s puis ${second.secondes} s)`);
    process.exit(1);
}

main();
