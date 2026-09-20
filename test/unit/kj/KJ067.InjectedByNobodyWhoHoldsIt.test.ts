import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-067 — une declaration d injection Dagger ne tient aucune instance.
 *
 * `fun inject(target: X)` declare un PARAMETRE. Dagger y ecrit les champs d un
 * X que quelqu un d autre a construit ; la ligne elle meme n en cree jamais.
 * Le sac de noms, lui, comptait ces deux mentions comme deux usages, et sur le
 * projet de reference `TraceRouteDelegate` a survecu a la suppression de ses
 * 241 lignes : la classe restait, videe, avec son champ injecte, son
 * constructeur vide et ses quinze imports morts. Un relecteur a ecrit « ca a
 * supprime mais pas tout ».
 *
 * Le fait qui autorise la coupe est syntaxique : toute facon de TENIR un X
 * ecrit X quelque part que le corpus lit deja, un appel de constructeur, un
 * type de champ ou de parametre, un supertype, un `Provider<X>`, une methode
 * de fourniture, le manifeste, un layout, une regle proguard, une chaine de
 * reflexion. Quand il ne reste que des declarations d injection, personne ne
 * peut tenir d instance, et elles partent avec la classe.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const commande: any = await importOrNull('src/commands/RemoveEverythingUnused');

const JAVA = '/w/app/src/main/java/com/x';
const KT = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

const DELEGATE = f(`${JAVA}/TraceRouteDelegate.java`, [
  'package com.x;',
  '',
  'import javax.inject.Inject;',
  '',
  'public class TraceRouteDelegate {',
  '',
  '    @Inject ConnectivityService connectivityService;',
  '',
  '    @Inject',
  '    public TraceRouteDelegate() {',
  '    }',
  '}',
  '',
].join('\n'));

const COMPOSANT = f(`${KT}/AppComponent.kt`, [
  'package com.x',
  '',
  'import com.x.TraceRouteDelegate',
  '',
  '@Component',
  'interface AppComponent {',
  '    fun inject(target: TraceRouteDelegate)',
  '}',
  '',
].join('\n'));

const VIDE = f(`${KT}/EmptyAppComponent.kt`, [
  'package com.x',
  '',
  'import com.x.TraceRouteDelegate',
  '',
  'object EmptyAppComponent : AppComponent {',
  '    override fun inject(target: TraceRouteDelegate) {}',
  '}',
  '',
].join('\n'));

const SERVICE = f(`${JAVA}/ConnectivityService.java`,
  'package com.x;\n\npublic interface ConnectivityService {\n    boolean isConnected();\n}\n');

// Un point d entree Android tient les deux composants : sinon ils meurent eux
// memes, et leurs lignes d injection partent dans une coupe qui n est pas la
// notre. Il ne nomme PAS la classe injectee, ce qui est tout le sujet.
const APP = f(`${KT}/App.kt`, [
  'package com.x',
  '',
  'import android.app.Activity',
  '',
  'class App : Activity() {',
  '    val component: AppComponent = EmptyAppComponent',
  '}',
  '',
].join('\n'));

const scan = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({
    sources: [...sources, GRADLE], testSourceSets: ['/src/test/', '/src/androidTest/'],
  }) as any[];

const delegate = (...sources: { path: string; text: string }[]) =>
  scan(DELEGATE, COMPOSANT, VIDE, SERVICE, APP, ...sources).find(s => s.name === 'TraceRouteDelegate');

describe.skipIf(!mod)('une classe que seules des declarations d injection nomment', () => {
  it('est morte, et ses deux declarations partent avec elle', () => {
    const hit = delegate()!;
    expect(hit.verdict).toBe('unreferenced');
    expect(hit.via).toBe('injection');
    expect(hit.injectionSites.map((s: any) => s.path)).toEqual([COMPOSANT.path, VIDE.path]);

    const coupe = (source: { path: string; text: string }) => {
      const site = hit.injectionSites.find((s: any) => s.path === source.path)!;
      return source.text.slice(site.removeStart, site.removeEnd);
    };
    expect(coupe(COMPOSANT)).toBe('    fun inject(target: TraceRouteDelegate)\n');
    expect(coupe(VIDE)).toBe('    override fun inject(target: TraceRouteDelegate) {}\n');
    // Les imports du composant sont deja la trouvaille de `staleImports`.
    expect(hit.staleImports.map((s: any) => s.path)).toEqual([COMPOSANT.path, VIDE.path]);
  });

  it('la forme Java : interface et implementation, corps sur plusieurs lignes', () => {
    const classe = f(`${JAVA}/AdminAccessorBehaviour.java`,
      'package com.x;\n\npublic class AdminAccessorBehaviour {\n    void go() {}\n}\n');
    const interfaceJava = f(`${JAVA}/ShellUiComponent.java`, [
      'package com.x;',
      '',
      'public interface ShellUiComponent {',
      '    void inject(AdminAccessorBehaviour target);',
      '}',
      '',
    ].join('\n'));
    const impl = f(`${JAVA}/GraphShell.java`, [
      'package com.x;',
      '',
      'public class GraphShell implements ShellUiComponent {',
      '    @Override',
      '    public void inject(AdminAccessorBehaviour target) {',
      '    }',
      '}',
      '',
    ].join('\n'));
    const hit = scan(classe, interfaceJava, impl).find(s => s.name === 'AdminAccessorBehaviour')!;
    expect(hit.via).toBe('injection');
    const site = hit.injectionSites.find((s: any) => s.path === impl.path)!;
    // L annotation seule sur sa ligne part avec, sinon elle se rattacherait a
    // la methode suivante.
    expect(impl.text.slice(site.removeStart, site.removeEnd)).toBe(
      '    @Override\n    public void inject(AdminAccessorBehaviour target) {\n    }\n');
  });

  it('un composant de TEST ne rend pas la classe testOnly : lui non plus ne la tient pas', () => {
    const testComponent = f('/w/app/src/androidTest/java/com/x/TestComponent.kt', [
      'package com.x',
      '',
      'interface TestComponent {',
      '    fun inject(target: TraceRouteDelegate)',
      '}',
      '',
    ].join('\n'));
    const hit = delegate(testComponent)!;
    expect(hit.verdict).toBe('unreferenced');
    expect(hit.injectionSites.map((s: any) => s.path)).toContain(testComponent.path);
  });
});

describe.skipIf(!mod)('ce que la regle laisse vivre', () => {
  it('quelqu un la construit, la fournit ou la declare', () => {
    for (const tenant of [
      'class Holder { val d = TraceRouteDelegate() }',
      'class Holder { lateinit var d: TraceRouteDelegate }',
      'interface Graph { fun delegate(): TraceRouteDelegate }',
      'class Holder { fun go(p: javax.inject.Provider<TraceRouteDelegate>) = p.get() }',
    ]) {
      const h = delegate(f(`${KT}/Holder.kt`, `package com.x\n\n${tenant}\n`));
      expect(h, tenant).toBeUndefined();
    }
  });

  it('le manifeste, un layout, une regle proguard ou une chaine la gardent', () => {
    for (const source of [
      f('/w/app/src/main/AndroidManifest.xml', '<manifest><service android:name=".TraceRouteDelegate" /></manifest>\n'),
      f('/w/app/src/main/res/layout/a.xml', '<com.x.TraceRouteDelegate android:id="@+id/d" />\n'),
      f('/w/app/proguard-rules.pro', '-keep class com.x.TraceRouteDelegate { *; }\n'),
      f(`${KT}/Reflect.kt`, 'package com.x\n\nfun go() = Class.forName("com.x.TraceRouteDelegate")\n'),
    ]) {
      expect(delegate(source), source.path).toBeUndefined();
    }
  });

  it('un appel component.inject(x) n est pas une declaration', () => {
    const appelant = f(`${KT}/Caller.kt`, [
      'package com.x',
      '',
      'class Caller {',
      '    fun go(c: AppComponent, d: TraceRouteDelegate) {',
      '        c.inject(d)',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(delegate(appelant)).toBeUndefined();
  });

  it('une classe dont la classe mere vit hors du corpus est retenue', () => {
    // Le framework peut l instancier par convention, sans que rien ne l ecrive.
    const worker = f(`${KT}/SyncWorker.kt`,
      'package com.x\n\nclass SyncWorker : SomeLibraryBase() {\n    fun go() = Unit\n}\n');
    const composant = f(`${KT}/WorkerComponent.kt`, [
      'package com.x',
      '',
      'interface WorkerComponent {',
      '    fun inject(target: SyncWorker)',
      '}',
      '',
    ].join('\n'));
    expect(scan(worker, composant).find(s => s.name === 'SyncWorker')).toBeUndefined();
  });

  it('un parametre generique ou une cible annotee ne sont pas la forme reconnue', () => {
    for (const ligne of [
      '    fun inject(target: TraceRouteDelegate<T>)',
      '    fun <T> inject(target: T)',
      '    fun inject(@Named("x") target: TraceRouteDelegate)',
    ]) {
      const composant = f(`${KT}/Odd.kt`,
        `package com.x\n\ninterface Odd {\n${ligne}\n}\n`);
      const trouve = scan(DELEGATE, composant, SERVICE).find(s => s.name === 'TraceRouteDelegate');
      // Soit la classe reste vivante (mention ordinaire), soit elle est morte
      // sans passer par l injection. Jamais une coupe qui laisserait la ligne.
      expect(trouve?.via, ligne).not.toBe('injection');
    }
  });

  it('une interface ou un object ne sont pas des cibles d injection de membres', () => {
    const cible = f(`${KT}/Cible.kt`, 'package com.x\n\ninterface Cible {\n    fun go()\n}\n');
    const composant = f(`${KT}/C.kt`, 'package com.x\n\ninterface C {\n    fun inject(target: Cible)\n}\n');
    expect(scan(cible, composant).find(s => s.name === 'Cible')?.via).not.toBe('injection');
  });
});

describe.skipIf(!commande)('par la commande de masse', () => {
  it('la classe, ses deux declarations et ses deux imports partent ensemble', () => {
    const { parFichier } = commande.collecterUnePasse(
      [DELEGATE, COMPOSANT, VIDE, SERVICE, APP, GRADLE], ['/src/test/']);
    const familles = (p: string) => ((parFichier.get(p) ?? []) as any[]).map(c => c.famille).sort();
    expect(familles(DELEGATE.path)).toEqual(['symboles']);
    expect(familles(COMPOSANT.path)).toEqual(['balayage', 'injections']);
    expect(familles(VIDE.path)).toEqual(['balayage', 'injections']);

    for (const source of [COMPOSANT, VIDE]) {
      const coupes = ((parFichier.get(source.path) ?? []) as any[]).sort((a, b) => b.start - a.start);
      let apres = source.text;
      for (const c of coupes) apres = apres.slice(0, c.start) + c.texte + apres.slice(c.end);
      expect(apres, source.path).not.toContain('TraceRouteDelegate');
    }

    const tally = commande.compteLesFamilles(parFichier);
    expect(tally.injections).toBe(2);
    expect(commande.resumeDesFamilles(tally)).toContain('2 injection methods of a removed class');
  });
});
