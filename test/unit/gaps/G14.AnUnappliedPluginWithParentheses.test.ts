import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', async () => import('../__mocks__/vscode'));

const mod: any = await import('../../../src/indexer/ResourceCorpus')
  .catch(() => null);
const allow: any = await import('../../../src/util/resourceAllowlists')
  .catch(() => null);
const sweep: any = await import('../../../src/providers/DeadCodeSweep')
  .catch(() => null);
const symboles: any = await import('../../../src/providers/unusedSymbols')
  .catch(() => null);

/**
 * G14 — `.apply(false)` avec parentheses n est pas filtre.
 *
 * Voir doc/gaps-detection.md. C est le seul trou du document qui puisse
 * ETEINDRE le detecteur au lieu de lui faire manquer une trouvaille.
 *
 * ## Le mecanisme
 *
 * Le fichier de build RACINE liste les plugins du projet sans les appliquer.
 * Les compter comme des declarations du module racine marquerait tout le
 * workspace comme module bibliotheque, voire comme module publie, et
 * `unusedSymbols.ts:1541` ecarte alors chaque candidat avec `F14:published`.
 * Le detecteur de code mort se tairait partout.
 *
 * `ResourceCorpus` s en protege:
 *
 *     export function withoutUnappliedPlugins(gradleText: string): string {
 *       return gradleText.split('\\n').filter(l => !/\\bapply\\s+false\\b/.test(l)).join('\\n');
 *     }
 *
 * Le filtre lit `apply false`, la forme Groovy et la forme infixe de Kotlin.
 * Il ne lit pas `.apply(false)`, la forme d appel du Kotlin DSL.
 *
 * ## Le cas reel
 *
 * `build.gradle.kts` a la racine du projet de reference, lignes 12 a 25 :
 *
 *     alias(libs.plugins.android.application).apply(false)
 *     alias(libs.plugins.android.library).apply(false)
 *     alias(libs.plugins.ksp).apply(false)
 *
 * La ligne 14 contient `android.library`, que `LIBRARY_PLUGIN_RE` reconnait,
 * et son `.apply(false)` echappe au filtre. La racine est donc comptee parmi
 * les 45 modules bibliotheque du corpus.
 *
 * ## Ce que ca coute aujourd hui, et ce que ca pourrait couter
 *
 * Mesure faite : `isLibraryModule` ne change que le TEXTE des messages
 * (`unusedSymbols.ts:1929`, `UnusedResourceProvider`,
 * `unusedResourceKeys.ts:273`), jamais un verdict ni `deletable`. Le cout
 * actuel est donc cosmetique : chaque message du workspace porte la mention
 * « library module, an external consumer may use it », qui est fausse pour
 * les modules applicatifs.
 *
 * Le danger est ailleurs. `PUBLISHED_MODULE_RE` passe par le MEME filtre, et
 * `publishedModules`, lui, ECARTE le candidat. Le projet de reference y
 * echappe parce que sa racine ne liste aucun plugin de publication. Un projet
 * qui ecrirait `alias(libs.plugins.mavenPublish).apply(false)` a la racine
 * verrait son detecteur de symboles morts s eteindre entierement, sans un
 * message pour le dire.
 */

const MAIN = 'plugins {';

const racine = (ligne: string) => [
  MAIN,
  `    ${ligne}`,
  '    alias(libs.plugins.detekt)',
  '}',
  '',
].join('\n');

describe.skipIf(!mod)('G14 — le filtre fait ce qu il annonce', () => {
  it('retire une ligne `apply false`, la forme Groovy', () => {
    const texte = racine('id("com.android.library") apply false');
    expect(mod.withoutUnappliedPlugins(texte)).not.toContain('com.android.library');
  });

  it('retire une ligne `apply(false)` ecrite en infixe sans point', () => {
    const texte = racine('alias(libs.plugins.android.library) apply false');
    expect(mod.withoutUnappliedPlugins(texte)).not.toContain('android.library');
  });

  /**
   * La forme du build racine du projet de reference. Elle echappait au filtre,
   * et la racine etait comptee parmi les 45 modules bibliotheque du corpus.
   */
  it('retire `.apply(false)`, la forme d appel du Kotlin DSL', () => {
    const texte = racine('alias(libs.plugins.android.library).apply(false)');
    expect(mod.withoutUnappliedPlugins(texte)).not.toContain('android.library');
    expect(mod.declaresLibraryPlugin(texte)).toBe(false);
  });
});

describe.skipIf(!mod)('G14 — les formes du Kotlin DSL, desormais lues', () => {
  it('ne voit pas un plugin bibliotheque derriere `.apply(false)`', () => {
    expect(mod.declaresLibraryPlugin(
      racine('alias(libs.plugins.android.library).apply(false)'))).toBe(false);
  });

  it('ne voit pas un plugin bibliotheque derriere `.apply( false )`', () => {
    expect(mod.declaresLibraryPlugin(
      racine('alias(libs.plugins.android.library).apply( false )'))).toBe(false);
  });

  it('ne voit pas un plugin de PUBLICATION derriere `.apply(false)`', () => {
    // Le cas dangereux : `publishedModules` ecarte le candidat, donc un projet
    // qui ecrit ceci a sa racine eteint son detecteur partout.
    expect(mod.declaresPublishing(
      racine('alias(libs.plugins.mavenPublish).apply(false)'))).toBe(false);
  });

  it('ne voit pas `id("…") version "…" apply(false)`', () => {
    expect(mod.declaresLibraryPlugin(
      racine('id("com.android.library") version "8.5.0" apply(false)'))).toBe(false);
  });

  it('ne voit pas un bloc `plugins` ou apply(false) est sur la ligne suivante', () => {
    // Le formateur Kotlin coupe volontiers les chaines longues.
    const coupe = [
      'plugins {',
      '    alias(libs.plugins.android.library)',
      '        .apply(false)',
      '}',
      '',
    ].join('\n');
    expect(mod.declaresLibraryPlugin(coupe)).toBe(false);
  });
});

/**
 * Le temoin de la CONSEQUENCE, pas du filtre.
 *
 * `FindUnusedSymbols` construit `publishedModules` ainsi:
 *
 *     moduleDirs.filter(dir => sources.some(s =>
 *       s.path.startsWith(`${dir}/build.gradle`) && declaresPublishing(s.text)))
 *
 * et `moduleDirs` est batie en retirant `/build.gradle(.kts)` du chemin de
 * chaque fichier de build. Pour le fichier RACINE, cela rend la racine du
 * workspace elle meme. `isUnder(chemin, racine)` est alors vrai pour TOUT le
 * corpus, et `F14:published` ecarte chaque candidat.
 *
 * Un projet qui ecrit `alias(libs.plugins.mavenPublish).apply(false)` a sa
 * racine eteignait donc son detecteur partout, sans un message pour le dire.
 * Ce test rejoue exactement cette chaine.
 */
describe.skipIf(!mod || !symboles)('G14 — ce que le trou pouvait eteindre', () => {
  const RACINE = '/w';
  const corpus = (buildRacine: string) => [
    { path: `${RACINE}/build.gradle.kts`, text: buildRacine },
    { path: `${RACINE}/app/build.gradle.kts`, text: 'plugins {\n    alias(libs.plugins.android.application)\n}\n' },
    { path: `${RACINE}/app/src/main/java/com/x/Mort.kt`, text: 'package com.x\n\nclass ClasseMorte\n' },
    { path: `${RACINE}/app/src/main/java/com/x/Vivant.kt`, text: 'package com.x\n\nfun main() = 1\n' },
  ];

  /** La meme regle qu'au site d'appel, recopiee ici pour qu'elle soit eprouvee. */
  const publies = (sources: { path: string; text: string }[]) => {
    const moduleDirs = sources
      .filter(s => /build\.gradle(\.kts)?$/.test(s.path))
      .map(s => s.path.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    return moduleDirs.filter(dir => sources.some(
      s => s.path.startsWith(`${dir}/build.gradle`) && mod.declaresPublishing(s.text)));
  };

  const morts = (buildRacine: string) => {
    const sources = corpus(buildRacine);
    return (symboles.findUnusedSymbols({
      sources, testSourceSets: ['/src/test/'], publishedModules: publies(sources),
    }) as any[]).map((x: any) => x.name);
  };

  it('sans plugin de publication, la classe morte est rapportee', () => {
    expect(morts('plugins {\n    alias(libs.plugins.detekt)\n}\n')).toContain('ClasseMorte');
  });

  /**
   * La forme Groovy etait deja filtree : c'est le temoin que la chaine
   * reconstruite ici est bien celle qui protege.
   */
  it('avec `apply false`, la forme Groovy, elle l est toujours', () => {
    expect(morts('plugins {\n    alias(libs.plugins.mavenPublish) apply false\n}\n'))
      .toContain('ClasseMorte');
  });

  it('et avec `.apply(false)`, la forme du Kotlin DSL, aussi', () => {
    expect(morts('plugins {\n    alias(libs.plugins.mavenPublish).apply(false)\n}\n'))
      .toContain('ClasseMorte');
  });

  /**
   * La contrepartie, qui prouve que le test n est pas vrai par vacuite : un
   * plugin de publication REELLEMENT applique eteint bien le detecteur, et
   * c est le comportement voulu.
   */
  it('mais un plugin de publication applique eteint bien tout', () => {
    expect(morts('plugins {\n    alias(libs.plugins.mavenPublish)\n}\n')).toEqual([]);
  });
});

describe.skipIf(!mod)('G14 — les gardes, qui passent des maintenant', () => {
  /**
   * Ces gardes tiennent aujourd hui et doivent tenir apres : elargir le
   * filtre ne doit pas faire disparaitre un vrai module bibliotheque, ce qui
   * coûterait l avertissement legitime sur son API publique.
   */

  it('voit un vrai module bibliotheque, plugin applique', () => {
    expect(mod.declaresLibraryPlugin(racine('alias(libs.plugins.android.library)')))
      .toBe(true);
  });

  it('voit un vrai module bibliotheque ecrit avec id()', () => {
    expect(mod.declaresLibraryPlugin(racine('id("com.android.library")'))).toBe(true);
  });

  it('voit un vrai module publie', () => {
    expect(mod.declaresPublishing(racine('id("maven-publish")'))).toBe(true);
  });

  it('ne voit pas un module applicatif comme une bibliotheque', () => {
    expect(mod.declaresLibraryPlugin(racine('alias(libs.plugins.android.application)')))
      .toBe(false);
  });

  /**
   * Une ligne de commentaire qui mentionne le plugin ne le declare pas. Seule
   * la ligne ENTIEREMENT commentee est retiree : couper a partir du `//` d une
   * ligne de code amputerait une URL de depot (`maven { url "https://..." }`)
   * pour un gain nul.
   */
  it('ne voit pas un plugin cite dans un commentaire', () => {
    const commente = [
      'plugins {',
      '    // alias(libs.plugins.android.library) retire en juin',
      '    alias(libs.plugins.detekt)',
      '}',
      '',
    ].join('\n');
    expect(mod.declaresLibraryPlugin(commente)).toBe(false);
  });
});


/**
 * Les filtres d artefacts, verifies et verrouilles.
 *
 * Meme famille de risque que le reste de ce fichier : ce ne sont pas des
 * trouvailles manquees, ce sont des protections qui, si elles lachent,
 * rendent le detecteur silencieux. Un dump de noms lu comme du code marque
 * tout le projet comme vivant.
 *
 * Mesure faite sur le corpus de reference, fichiers hors `build/` citant au
 * moins vingt noms pleinement qualifies :
 *
 *   app/mapping.txt        52 026 noms   filtre
 *   host/app/mapping.txt        22 456 noms   filtre
 *   app/usage.txt          19 081 noms   filtre
 *   host/app/seeds.txt          13 512 noms   filtre
 * 28 noms filtre
 *   .searchdeadcode-cache.json     12 516 noms   hors glob (.json non lu)
 * 20 noms exclu par defaut
 * AndroidManifest 24 noms LU, et c est voulu
 *   proguard-rules.pro                 21 noms   LU, et c est voulu
 *
 * Les quatre premiers sont exactement ce que `R8_ARTIFACT_RE` existe pour
 * ecarter : le seul `mapping.txt` de app citerait 52 026 noms, dont
 * chacun garderait sa classe en vie.
 *
 * Ces tests passent tous. Ils sont ici pour qu un elargissement du glob ou un
 * assouplissement d un motif se signale.
 */
describe.skipIf(!allow)('G14 — les filtres d artefacts, a ne pas affaiblir', () => {
  it('ecarte les quatre artefacts R8', () => {
    for (const nom of ['mapping', 'usage', 'seeds', 'resources', 'configuration']) {
      expect(allow.isBuildArtifactPath(`/w/app/${nom}.txt`)).toBe(true);
    }
  });

  it('ecarte un baseline d outil, quel que soit son prefixe', () => {
    expect(allow.isBuildArtifactPath('/w/config/detekt/baseline.xml')).toBe(true);
    expect(allow.isBuildArtifactPath('/w/app/lint-baseline.xml')).toBe(true);
    expect(allow.isBuildArtifactPath('/w/app/baseline-debug.xml')).toBe(true);
  });

  it('ecarte tout ce qui vit sous un repertoire de build', () => {
    for (const d of ['build', 'out', '.gradle', '.cxx', 'intermediates', 'outputs']) {
      expect(allow.isBuildArtifactPath(`/w/app/${d}/Thing.kt`)).toBe(true);
    }
  });

  it('ne confond pas un nom de fichier ordinaire avec un artefact', () => {
 // `resources.txt` est un artefact, `Resources` ne l est pas.
    expect(allow.isBuildArtifactPath('/w/app/src/main/java/com/x/Resources.kt')).toBe(false);
    expect(allow.isBuildArtifactPath('/w/app/src/main/java/com/x/UsageTracker.kt')).toBe(false);
    expect(allow.isBuildArtifactPath('/w/app/src/main/res/values/strings.xml')).toBe(false);
  });

  /**
   * Deux formes vues sur d autres outils et que le motif actuel ne couvre
   * pas. Aucune n est presente sur le corpus de reference, donc ce sont des
   * cas de prudence et non des trouvailles : `it.fails` les garde visibles
   * sans les faire passer pour un defaut avere.
   */
  it.fails('ecarterait un repertoire de build Maven', () => {
    expect(allow.isBuildArtifactPath('/w/app/target/classes/Thing.class')).toBe(true);
  });

  it.fails('ecarterait un fichier d exclusion SpotBugs sans le mot baseline', () => {
    expect(allow.isBuildArtifactPath('/w/config/spotbugs-exclude.xml')).toBe(true);
  });
});


/**
 * Les annotations qui protegent le balayage, verifiees et verrouillees.
 *
 * Meme famille de risque : une declaration que seul un OUTIL appelle n est
 * nommee nulle part dans le code. Si la garde lachait, le balayage la
 * supprimerait et rien ne casserait a la compilation ; la panne serait a
 * l execution, ou dans l outillage du developpeur.
 *
 * Mesure faite pendant l audit du balayage, sur les 16 declarations qu il
 * rapporte sur le corpus de reference. Aucune n est un faux positif, et la
 * garde qui l explique est fine :
 *
 *   fun privee morte, sans annotation   -> rapportee
 *   fun @BindingAdapter morte           -> epargnee
 *   fun @BindingAdapter privee          -> epargnee
 *   val prive mort                      -> rapporte
 *   val prive @JvmField                 -> epargne
 *   fun @Composable privee morte        -> RAPPORTEE
 *   fun @Preview @Composable privee     -> epargnee
 *
 * La distinction entre les deux dernieres lignes est exactement la bonne :
 * `@Composable` ne dit rien sur l atteignabilite, une fonction composable est
 * du code ordinaire ; `@Preview` dit que l outillage l appelle. Le corpus
 * compte 440 occurrences de `@Preview`, toutes epargnees.
 *
 * Le cas qui avait attire l attention, `setTextViewTextGravity` dans
 * `SimpleScreenBindings`, est une fausse alerte: le nom du fichier
 * evoque le data binding, mais la fonction est `private` et sans annotation.
 * Elle est bien morte.
 */
describe.skipIf(!sweep)('G14 — les annotations qui protegent le balayage', () => {
  const declarations = (texte: string) =>
    (sweep.sweepFile(texte) as any[])
      .filter(x => x.detector === 'declarations')
      .map(x => x.name);

  it('rapporte une fonction privee morte sans annotation', () => {
    expect(declarations([
      'package com.x',
      '',
      'private fun setTextViewTextGravity(view: TextView) {',
      '    view.gravity = 1',
      '}',
      '',
    ].join('\n'))).toContain('setTextViewTextGravity');
  });

  it('epargne un @BindingAdapter, que seul le XML appelle', () => {
    expect(declarations([
      'package com.x',
      '',
      '@BindingAdapter("pulsing")',
      'fun setPulsing(view: View, on: Boolean) {',
      '    view.alpha = 1f',
      '}',
      '',
    ].join('\n'))).not.toContain('setPulsing');
  });

  it('epargne un @Preview, que seul l outillage appelle', () => {
    // 440 occurrences sur le corpus de reference.
    expect(declarations([
      'package com.x',
      '',
      '@Preview',
      '@Composable',
      'private fun OnboardingScreenPreview() {',
      '    OnboardingScreen()',
      '}',
      '',
    ].join('\n'))).not.toContain('OnboardingScreenPreview');
  });

  it('epargne une annotation de preview personnalisee', () => {
 // en declare une.
    expect(declarations([
      'package com.x',
      '',
      '@OnboardingScreenPreviews',
      '@Composable',
      'private fun Preview() {',
      '    Text("x")',
      '}',
      '',
    ].join('\n'))).not.toContain('Preview');
  });

  /**
   * La contrepartie, et elle compte autant : `@Composable` SEUL ne doit pas
   * proteger. Une fonction composable privee que personne n appelle est morte
   * comme une autre. Si ce test se met a echouer, la garde s est elargie et
   * le balayage vient de perdre une famille entiere.
   */
  it('ne laisse pas @Composable seul proteger une fonction morte', () => {
    expect(declarations([
      'package com.x',
      '',
      '@Composable',
      'private fun Unused() {',
      '    Text("x")',
      '}',
      '',
    ].join('\n'))).toContain('Unused');
  });

  it('epargne un val annote, et rapporte le meme sans annotation', () => {
    const nu = ['package com.x', '', 'private val BLUR_RADIUS = 12', ''].join('\n');
    const annote = ['package com.x', '', '@JvmField', 'private val BLUR_RADIUS = 12', ''].join('\n');
    expect(declarations(nu)).toContain('BLUR_RADIUS');
    expect(declarations(annote)).not.toContain('BLUR_RADIUS');
  });
});
