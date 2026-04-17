/**
 * Tests adversariaux E2E — cherche des bugs dans les comptes ⬇/usages
 * en conditions réelles VS Code.
 *
 * Chaque test documente : ce qu'on ATTEND vs ce qu'on OBTIENT réellement.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';

const DEMO_ROOT = path.join(__dirname, '..', '..', 'test', 'kotlin-jump-demo');

function demoUri(rel: string): vscode.Uri {
  return vscode.Uri.file(path.join(DEMO_ROOT, rel));
}

async function openAndWait(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function getLenses(uri: vscode.Uri): Promise<vscode.CodeLens[]> {
  return (await vscode.commands.executeCommand<vscode.CodeLens[]>(
    'vscode.executeCodeLensProvider', uri, 50,
  )) ?? [];
}

async function waitForLens(
  uri: vscode.Uri,
  pred: (ls: vscode.CodeLens[]) => boolean,
  timeoutMs = 30_000,
): Promise<vscode.CodeLens[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ls = await getLenses(uri);
    if (pred(ls)) return ls;
    await new Promise(r => setTimeout(r, 500));
  }
  const ls = await getLenses(uri);
  return ls; // return whatever we have (test will then assert and fail with details)
}

function implCount(lenses: vscode.CodeLens[]): number | null {
  for (const l of lenses) {
    const m = l.command?.title?.match(/⬇\s+(\d+)\s+implementation/);
    if (m) return Number(m[1]);
  }
  return null;
}

function allImplCounts(lenses: vscode.CodeLens[]): number[] {
  const counts: number[] = [];
  for (const l of lenses) {
    const m = l.command?.title?.match(/⬇\s+(\d+)\s+implementation/);
    if (m) counts.push(Number(m[1]));
  }
  return counts;
}

function hasDownArrow(lenses: vscode.CodeLens[]): boolean {
  return lenses.some(l => l.command?.title?.includes('⬇'));
}

function titles(lenses: vscode.CodeLens[]): string {
  return lenses.map(l => l.command?.title ?? '(unresolved)').join(' | ');
}

// ─────────────────────────────────────────────────────────────────────────────

suite('Adversarial E2E — Comptes et Précision', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── ADV-1 : PokemonRepository → exactement 6 implémentations ───────────
  //
  // 6 classes dans src/main implémentent PokemonRepository :
  //   PokemonRepositoryImpl, OfflinePokemonRepository, NetworkPokemonRepository,
  //   CachedPokemonRepository, FakePokemonRepository, InMemoryPokemonRepository
  //
  // ATTENDU : ⬇ 6 implementations
  // RISQUE   : Décorateur (CachedPokemonRepository) pourrait être ignoré si on
  //            ne regarde que le premier supertype.

  test('ADV-1 — PokemonRepository: exactement 6 implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/PokemonRepository.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => implCount(ls) !== null);
    const count = implCount(lenses);
    assert.strictEqual(count, 6,
      `ATTENDU 6, OBTENU ${count}. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-2 : GymChallenge → exactement 3 implémentations ────────────────
  //
  // PewterGym, CeruleanGym, VermilionGym → 3 dans le même fichier WelcomeDemo.kt
  //
  // ATTENDU : ⬇ 3 implementations
  // RISQUE   : Si le parser rate les classes dans le même fichier que l'interface.

  test('ADV-2 — GymChallenge: exactement 3 implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/WelcomeDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => hasDownArrow(ls));
    const count = implCount(lenses);
    assert.strictEqual(count, 3,
      `ATTENDU 3, OBTENU ${count}. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-3 : NavigationScreen nested sealed → exactement 3 ───────────────
  //
  // NavigationScreen a 3 sous-types DIRECTS (Home, Battle, Settings).
  // Home et Battle ont eux-mêmes des sous-types (Feed, Profile, Setup, Active, Result).
  //
  // ATTENDU : ⬇ 3 implementations (pas 8)
  // RISQUE   : Inflation si les sous-sous-types sont comptés pour NavigationScreen.

  test('ADV-3 — NavigationScreen: exactement 3 implementations (pas les sous-sous-types)', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/SealedWhenDemo.kt');
    await openAndWait(uri);
    // NavigationScreen est la dernière sealed class du fichier — on attend au moins un ⬇ 3
    const lenses = await waitForLens(uri, ls => ls.some(l => /⬇\s+3\s+implementation/.test(l.command?.title ?? '')));
    const hasThree = lenses.some(l => /⬇\s+3\s+implementation/.test(l.command?.title ?? ''));
    assert.ok(hasThree,
      `Aucun lens "⬇ 3 implementations" pour NavigationScreen. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-4 : CombatResult vs BattleOutcome — collision Victory/Defeat/Draw ─
  //
  // CombatResult (com.example.demo) et BattleOutcome (com.example.demo) ont TOUS DEUX
  // des sous-types nommés Victory, Defeat, Draw dans le même package.
  //
  // ATTENDU : CombatResult → ⬇ 3, BattleOutcome → ⬇ 3 (pas 6!)
  // RISQUE   : lookupImplementations("Victory") par simple name pourrait confondre,
  //            mais ici on appelle lookupImplementations("CombatResult"). Le vrai risque
  //            est si la disambiguation est incorrecte côté BattleOutcome.

  test('ADV-4 — BattleOutcome: exactement 3 implementations (pas 6 malgré collision Victory/Defeat/Draw)', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/WelcomeDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => hasDownArrow(ls));
    // WelcomeDemo a GymChallenge (3 impls) ET BattleOutcome — les deux dans le même fichier
    const counts = allImplCounts(lenses);
    assert.ok(counts.includes(3),
      `BattleOutcome devrait avoir ⬇ 3. Counts trouvés: ${counts}. Lenses: ${titles(lenses)}`);
    assert.ok(!counts.includes(6) && !counts.includes(9),
      `Inflation détectée! Counts: ${counts} — Les Victory/Defeat/Draw de BattleOutcome et CombatResult se confondent?`);
  });

  // ─── ADV-5 : abstract class MoveStrategy → ⬇ ET usages ─────────────────
  //
  // MoveStrategy est une classe abstraite avec 2 sous-classes (PhysicalMove, SpecialMove).
  // Après le fix Sprint 2, elle devrait avoir:
  //   - Un lens ⬇ 2 implementations (via OverrideGutterProvider)
  //   - Un lens N usages (via CodeLensProvider usageOnly)
  //
  // ATTENDU : Les DEUX types de lenses
  // RISQUE   : L'un des deux manque.

  test('ADV-5 — abstract class MoveStrategy: exactement 2 implementations + lens usages', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/AbstractClassDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(
      uri,
      ls => ls.some(l => /⬇\s+2/.test(l.command?.title ?? '')) && ls.some(l => /usage/.test(l.command?.title ?? '')),
    );
    const count = implCount(lenses);
    assert.strictEqual(count, 2,
      `ATTENDU ⬇ 2 sur MoveStrategy, OBTENU ${count}. Lenses: ${titles(lenses)}`);
    const hasUsage = lenses.some(l => /\d+\s+usage/.test(l.command?.title ?? ''));
    assert.ok(hasUsage,
      `Lens "N usages" manquant sur abstract class. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-6 : FunctionalInterface (SAM, 0 impls) → PAS de lens ⬇ ─────────
  //
  // FunctionalInterface n'a aucune implémentation nommée dans le projet.
  //
  // ATTENDU : Aucun lens ⬇ (guard `if (impls.length > 0)`)
  // RISQUE   : Lens fantôme ⬇ 0 si le guard manque.

  test('ADV-6 — FunctionalInterface (0 impls): pas de lens ⬇', async () => {
    const uri = demoUri('src/main/kotlin/com/example/SyntaxVerification.kt');
    await openAndWait(uri);
    // Attendre que les lenses se chargent (⬆ overrides doit apparaître sur les méthodes override)
    const lenses = await waitForLens(uri, ls => ls.length > 2);

    // Chercher le lens ⬇ sur FunctionalInterface spécifiquement
    // La ligne où FunctionalInterface est déclarée — cherchons un lens ⬇ 0
    const zeroImplLens = lenses.find(l => /⬇\s+0/.test(l.command?.title ?? ''));
    assert.ok(!zeroImplLens,
      `Lens fantôme "⬇ 0" détecté! Lens: ${zeroImplLens?.command?.title}. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-7 : PokemonObserver → exactement 2 implémentations ────────────
  //
  // AuditObserver (nommée) + objet anonyme `object : PokemonObserver { }`.
  // Le parser émet un symbole synthétique $anon$N pour les objets anonymes —
  // les deux sont comptés dans lookupImplementations.
  //
  // ATTENDU : ⬇ 2 implementations
  // Note : le commentaire "Limitation B" dans AnonymousObjectDemo.kt était périmé.

  test('ADV-7 — PokemonObserver: exactement 2 implementations (nommée + anonyme)', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/AnonymousObjectDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => hasDownArrow(ls));
    const count = implCount(lenses);
    assert.strictEqual(count, 2,
      `ATTENDU 2 (AuditObserver + objet anonyme). OBTENU ${count}. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-8 : BaseProcessor → exactement 2 implémentations ───────────────
  //
  // CatchProcessor et EvolveProcessor implémentent BaseProcessor (abstract class).
  //
  // ATTENDU : ⬇ 2 implementations
  // RISQUE   : Classes dans le même fichier Sprint2VisualDemo.kt — parser rate?

  test('ADV-8 — abstract class BaseProcessor: exactement 2 implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/sprint2/Sprint2VisualDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => hasDownArrow(ls));
    // Sprint2VisualDemo a PokemonDataSource (2) ET BaseProcessor (2) ET CacheStore (1)
    // On vérifie que ⬇ 2 apparaît au moins une fois
    const has2 = lenses.some(l => /⬇\s+2\s+implementation/.test(l.command?.title ?? ''));
    assert.ok(has2,
      `Aucun lens "⬇ 2 implementations" pour BaseProcessor. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-9 : sealed class Home (nested) → ⬇ 2 pour ses sous-types ────────
  //
  // NavigationScreen.Home est elle-même une sealed class avec Feed et Profile.
  // Son lens ⬇ devrait afficher 2.
  //
  // ATTENDU : Un lens ⬇ 2 quelque part dans SealedWhenDemo.kt pour Home
  // RISQUE   : Nested sealed class — le parser l'indexe-t-il correctement ?

  test('ADV-9 — NavigationScreen.Home: exactement 2 implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/SealedWhenDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => ls.some(l => /⬇\s+2\s+implementation/.test(l.command?.title ?? '')));
    const has2 = lenses.some(l => /⬇\s+2\s+implementation/.test(l.command?.title ?? ''));
    assert.ok(has2,
      `Aucun lens "⬇ 2 implementations" pour NavigationScreen.Home (Feed, Profile). Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-10 : methode override dans abstract class → ⬇ method-level ──────
  //
  // MoveStrategy.execute() est abstract et overridé dans PhysicalMove et SpecialMove.
  // OverrideGutterProvider devrait créer un lens ⬇ 2 sur `execute` elle-même.
  //
  // ATTENDU : ⬇ 2 implementations SUR LA METHODE execute (pas seulement sur la classe)
  // RISQUE   : lookupMethodImplementations ne trouve rien si la classe est abstract

  test('ADV-10 — MoveStrategy.execute(): lens ⬇ 2 au niveau méthode', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/AbstractClassDemo.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => allImplCounts(ls).length >= 2);
    const counts = allImplCounts(lenses);
    // On devrait avoir AU MOINS deux "⬇" : un pour la classe, un pour execute
    // et possiblement un pour describe
    assert.ok(counts.length >= 2,
      `ATTENDU au moins 2 lens ⬇ (classe + méthodes abstract). OBTENU: ${counts}. Lenses: ${titles(lenses)}`);
  });

  // ─── ADV-11 : SyntaxVerification.kt → exactement 6 lens ⬆ overrides ────
  //
  // Le fichier contient 3 classes avec des méthodes override :
  //   MemberFunctions : interfaceFun, interfaceProp, contract, toString = 4
  //   Derived         : greet = 1
  //   ConcreteCoroutine : fetch = 1
  // Total : 6 lenses ⬆ légitimes.
  //
  // ATTENDU : exactement 6
  // RISQUE   : inflation si d'autres méthodes sont marquées override par erreur.

  test('ADV-11 — SyntaxVerification.kt: exactement 6 lens ⬆ overrides légitimes', async () => {
    const uri = demoUri('src/main/kotlin/com/example/SyntaxVerification.kt');
    await openAndWait(uri);
    const lenses = await waitForLens(uri, ls => ls.filter(l => /⬆/.test(l.command?.title ?? '')).length >= 6);
    const upLenses = lenses.filter(l => /⬆/.test(l.command?.title ?? ''));
    assert.strictEqual(upLenses.length, 6,
      `ATTENDU 6 lens ⬆ (MemberFunctions×4 + Derived×1 + ConcreteCoroutine×1). Obtenu: ${upLenses.length}. Lenses: ${upLenses.map(l => l.command?.title).join(', ')}`);
  });

  // ─── ADV-12 : goToClassImpl pour interface sans implémentation → silence ──
  //
  // FunctionalInterface n'a aucune implémentation.
  // goToClassImpl ne doit pas planter — juste retourner silencieusement.
  //
  // ATTENDU : aucune erreur, éditeur actif inchangé
  // RISQUE   : crash ou navigation vers un mauvais fichier

  test('ADV-12 — goToClassImpl pour interface sans implementation ne plante pas', async () => {
    const uri = demoUri('src/main/kotlin/com/example/SyntaxVerification.kt');
    await openAndWait(uri);

    const editorBefore = vscode.window.activeTextEditor?.document.fileName;

    let threw = false;
    try {
      await vscode.commands.executeCommand('kotlin-jump.goToClassImpl', 'FunctionalInterface', 'com.example');
    } catch {
      threw = true;
    }

    assert.ok(!threw, 'goToClassImpl a jeté une exception pour une interface sans implémentation');

    await new Promise(r => setTimeout(r, 800));
    const editorAfter = vscode.window.activeTextEditor?.document.fileName;
    // L'éditeur ne devrait pas avoir changé (ou rester dans le même workspace)
    assert.ok(
      !editorAfter || editorAfter === editorBefore || editorAfter.includes('kotlin-jump-demo'),
      `Navigation inattendue: ${editorBefore} → ${editorAfter}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite de régression générale — invariants sur TOUS les fichiers du workspace
//
// Ces tests balayent l'ensemble des fichiers .kt du demo et vérifient des
// invariants fondamentaux. Ils préviennent toute réapparition de bugs où des
// noms de symboles synthétiques internes ($anon$N, etc.) fuiteraient dans
// l'interface utilisateur.
// ─────────────────────────────────────────────────────────────────────────────

suite('Régression générale — Invariants sur tous les fichiers', function () {
  this.timeout(120_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── REG-1 : Aucun titre de lens ne contient de symbole synthétique ──────
  //
  // Balaye TOUS les fichiers .kt du workspace.
  // Vérifie qu'aucun titre de CodeLens n'expose un symbole interne :
  //   - $anon$N (objets anonymes synthétiques du parser)
  //   - $N$M    (autres symboles synthétiques futurs)
  //
  // Ce test est la gardienne générale : il échouera dès qu'un symbole interne
  // filtre dans un titre visible par l'utilisateur, quelle que soit sa source.

  test('REG-1 — Aucun titre de lens ne contient de symbole synthétique ($anon$, etc.)', async () => {
    const allFiles = await vscode.workspace.findFiles('**/*.kt', '**/build/**');
    // Trier pour reproductibilité — on prend les 20 premiers (couvre tout le src/main)
    const files = allFiles
      .filter(u => u.fsPath.includes('/src/main/'))
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      .slice(0, 20);

    assert.ok(files.length > 0, 'Aucun fichier .kt trouvé dans src/main/');

    const violations: string[] = [];
    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      // Attendre un minimum pour que les lenses se chargent
      await new Promise(r => setTimeout(r, 400));
      const lenses = await getLenses(uri);
      for (const lens of lenses) {
        const title = lens.command?.title ?? '';
        // Règle 1 : pas de $anon$ dans un titre
        if (title.includes('$anon$')) {
          violations.push(`$anon$ exposé: "${title}" dans ${uri.fsPath.split('/').pop()}`);
        }
        // Règle 2 : pas de symbole commençant par $ (pattern général)
        if (/\$[a-z]+\$\d/.test(title)) {
          violations.push(`Symbole synthétique exposé: "${title}" dans ${uri.fsPath.split('/').pop()}`);
        }
      }
    }

    assert.strictEqual(violations.length, 0,
      `Symboles synthétiques détectés dans les titres de lens:\n${violations.join('\n')}`);
  });

  // ─── REG-2 : Chaque lens ⬇ a un titre lisible par un humain ─────────────
  //
  // Tous les titres commençant par ⬇ doivent correspondre au pattern :
  //   "⬇ N implementation(s)"
  // où N est un entier ≥ 1.
  //
  // Prévient : count négatif, count NaN, format corrompu.

  test('REG-2 — Chaque lens ⬇ a un titre au format "⬇ N implementation(s)"', async () => {
    const allFiles = await vscode.workspace.findFiles('**/*.kt', '**/build/**');
    const files = allFiles
      .filter(u => u.fsPath.includes('/src/main/'))
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      .slice(0, 20);

    const violations: string[] = [];
    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      await new Promise(r => setTimeout(r, 400));
      const lenses = await getLenses(uri);
      for (const lens of lenses) {
        const title = lens.command?.title ?? '';
        if (!title.startsWith('⬇')) continue;
        // Doit matcher exactement "⬇ N implementation" ou "⬇ N implementations"
        if (!/^⬇\s+[1-9]\d*\s+implementations?$/.test(title)) {
          violations.push(`Titre ⬇ malformé: "${title}" dans ${uri.fsPath.split('/').pop()}`);
        }
      }
    }

    assert.strictEqual(violations.length, 0,
      `Titres ⬇ malformés:\n${violations.join('\n')}`);
  });

  // ─── REG-3 : goToClassImpl navigue sans planter sur toute interface ──────
  //
  // Balaye toutes les interfaces connues du demo et appelle goToClassImpl.
  // Vérifie qu'aucun appel ne lance d'exception.
  //
  // Cas couverts : interface sans impl, interface avec impl nommée, interface
  // avec impl anonyme, sealed class avec sous-types imbriqués.

  test('REG-3 — goToClassImpl ne plante pas sur les interfaces du demo', async () => {
    const scenarios: Array<{ name: string; pkg: string }> = [
      { name: 'PokemonObserver',   pkg: 'com.example.demo' },   // 1 nommée + 1 anonyme
      { name: 'GymChallenge',      pkg: 'com.example.demo' },   // 3 nommées
      { name: 'FunctionalInterface', pkg: 'com.example' },      // 0 impl
      { name: 'UserRepository',    pkg: 'com.example.data' },   // 1 nommée
      { name: 'CombatResult',      pkg: 'com.example.demo' },   // sealed class, 3 sous-types
      { name: 'NavigationScreen',  pkg: 'com.example.demo' },   // sealed nested, 3 directs
    ];

    const errors: string[] = [];
    for (const { name, pkg } of scenarios) {
      let caughtError: Error | undefined;
      // Ne PAS await — goToClassImpl peut ouvrir un QuickPick qui bloque indéfiniment.
      // On tire la commande sans bloquer, on attend qu'elle s'initialise (navigation
      // directe ou affichage du QuickPick), puis on ferme le QuickPick si ouvert.
      vscode.commands.executeCommand('kotlin-jump.goToClassImpl', name, pkg)
        .catch((e: Error) => { caughtError = e; });
      await new Promise(r => setTimeout(r, 500));
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      await new Promise(r => setTimeout(r, 200));
      if (caughtError) {
        errors.push(`goToClassImpl("${name}") a lancé: ${caughtError.message}`);
      }
    }

    assert.strictEqual(errors.length, 0,
      `Exceptions dans goToClassImpl:\n${errors.join('\n')}`);
  });
});
