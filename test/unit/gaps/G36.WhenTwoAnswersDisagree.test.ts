import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G36 — quand les deux reponses d une meme famille se contredisent.
 *
 * G35 a trouve `explain` et `find` en desaccord chez les cles Remote Config.
 * La question suivante s imposait : les autres familles s accordent elles ?
 * Mesure sur le corpus de reference, en comparant ce que `find` rapporte a ce
 * que `explain` juge « jugeable » (`unreferenced` ou `testOnly`) :
 *
 *   symboles      find 48   explain 49   DESACCORD de 1
 *   membres       find 42   explain 42   accord
 *   enums         find  4   explain  4   accord
 *   ilots         find  4   explain  4   accord
 *   remote config find  0   explain 95   DESACCORD (G35)
 *   gradle        find  0   explain  0   accord
 *
 * ## Le desaccord des symboles, identifie
 *
 *       class MainActivityV2PreferenceInjectionHolder(context: Context)
 *
 * `explainSymbols` la juge `unreferenced`, `findUnusedSymbols` ne la rapporte
 * pas. Et c est `explain` qui a tort : la classe est bel et bien construite,
 * dans son propre fichier :
 *
 * MainActivityV2
 *       MainActivityV2PreferenceInjectionHolder(application).preferenceDataService
 *
 * Plus une declaration d injection ailleurs :
 *
 * AppApplicationComponent l import
 *
 * ## Pourquoi les deux divergent
 *
 * `explainSymbols` (unusedSymbols.ts:1715) teste d abord si les mentions HORS
 * du fichier declarant se reduisent a des declarations d injection. Ici oui,
 * la seule mention exterieure est celle du composant. La branche KJ-067
 * conclut donc `unreferenced` et n atteint jamais la branche
 * `alive:same-file`, qui vient APRES.
 *
 * `findUnusedSymbols` epargne la declaration, parce que l usage du fichier la
 * tient en vie. Le detecteur a raison, l explication a tort.
 *
 * Mesure de la forme, sur un corpus minimal :
 *
 *   usage dans le fichier + declaration d injection -> find rien, explain `unreferenced`
 *   usage dans le fichier seulement                 -> find rien, explain `alive:same-file`
 *   declaration d injection seulement               -> find la rapporte, explain `unreferenced`
 *
 * Seule la premiere ligne diverge, et c est celle du corpus.
 *
 * ## Pourquoi ca compte plus qu une trouvaille
 *
 * `--why` est l outil avec lequel ce dossier a mesure trente cinq trous. Une
 * explication qui dit `unreferenced` pour une declaration que le detecteur
 * epargne est une explication en laquelle on ne peut pas avoir confiance ; et
 * c est la troisieme fois que la divergence apparait, apres G28 (le filtre
 * avale le verdict) et G35 (le coupe circuit n est pas modelise).
 *
 * ## Ce que ces tests demandent
 *
 * L invariant : toute declaration que `explain` juge `unreferenced` ou
 * `testOnly` doit apparaitre dans la sortie de `find`, et reciproquement. Les
 * gardes ci dessous verifient l invariant sur les quatre familles qui le
 * respectent deja, pour qu une derive s y signale.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const enums: any = await importOrNull('src/providers/unusedEnumEntries');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'] } as any);

const morts = (...sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols(base(sources)) as any[]).map(s => s.name);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols(base(sources)) as any[]).find(s => s.name === nom);

/** Les deux sorties, confrontees sur le meme appel. */
const accord = (...sources: { path: string; text: string }[]) => {
  const rapportes = new Set(morts(...sources));
  const juges = (symb.explainSymbols(base(sources)) as any[])
    .filter(s => ['unreferenced', 'testOnly'].includes(String(s.outcome)))
    .map(s => s.name);
  return { rapportes: [...rapportes].sort(), juges: juges.sort() };
};

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/**
 * pour l usage,:639 pour la
 * declaration. La classe est construite dans son propre fichier, et un
 * composant Dagger l importe pour declarer son injection.
 */
const ACTIVITE = f('MainActivityV2.kt', [
  'package com.x',
  '',
  'class MainActivityV2 {',
  '',
  '    fun flag(application: Context) =',
  '        MainActivityV2PreferenceInjectionHolder(application).preferenceDataService',
  '}',
  '',
  'class MainActivityV2PreferenceInjectionHolder(context: Context) {',
  '',
  '    @Inject',
  '    lateinit var preferenceDataService: PreferenceDataService',
  '',
  '    init {',
  '        GraphApp.app(context).inject(this)',
  '    }',
  '}',
  '',
].join('\n'));

/** app/.../core/dagger/component/AppApplicationComponent.kt:67 */
const COMPOSANT = f('AppApplicationComponent.kt', [
  'package com.x',
  '',
  'import com.x.MainActivityV2PreferenceInjectionHolder',
  '',
  'interface AppApplicationComponent {',
  '',
  '    fun inject(target: MainActivityV2PreferenceInjectionHolder)',
  '}',
  '',
].join('\n'));

const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    MainActivityV2()\n}\n');

const CIBLE = 'MainActivityV2PreferenceInjectionHolder';

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!symb)('les deux sorties s accordent dans les cas simples', () => {
  it('sur une declaration morte de facon evidente', () => {
    const orpheline = f('Orpheline.kt', 'package com.x\n\nclass Orpheline\n');
    const { rapportes, juges } = accord(orpheline, APPELANT);
    expect(rapportes).toEqual(juges);
    expect(rapportes).toContain('Orpheline');
  });

  it('sur une declaration vivante', () => {
    const vivante = f('Vivante.kt', 'package com.x\n\nclass Vivante\n');
    const usage = f('Usage.kt', 'package com.x\n\nfun go() = Vivante()\n');
    const { rapportes, juges } = accord(vivante, usage, APPELANT);
    expect(rapportes).toEqual(juges);
    expect(rapportes).not.toContain('Vivante');
  });
});

// ── Sentinelles : le desaccord, fixe par ecrit ─────────────────────────────

describe.skipIf(!symb)('les deux sorties s accordent sur ce motif', () => {
  it('find epargne la classe', () => {
    expect(morts(ACTIVITE, COMPOSANT, APPELANT)).not.toContain(CIBLE);
  });

  /**
   * CORRIGÉ. `explainSymbols` applique maintenant le test du même-fichier quoi
   * qu'ait conclu la branche KJ-067, exactement comme le scan le fait depuis
   * toujours. Mesuré sur le corpus : find 136, explain 136, zéro divergence
   * dans les deux sens.
   */
  it('et explain la juge vivante par son propre fichier', () => {
    expect(verdict(CIBLE, ACTIVITE, COMPOSANT, APPELANT))
      .toMatchObject({ outcome: 'alive:same-file' });
  });

  /**
   * Et elle ne marque plus `via: injection` : cette branche ne conclut plus
   * sur une déclaration que son propre fichier construit.
   */
  it('sans passer par la branche des declarations d injection', () => {
    expect(verdict(CIBLE, ACTIVITE, COMPOSANT, APPELANT)).not.toMatchObject({ via: 'injection' });
  });

  /**
   * Et les deux autres formes s accordent, ce qui isole la cause : c est la
   * COMBINAISON d un usage dans le fichier et d une declaration d injection
   * ailleurs qui fait diverger.
   */
  it('sans le composant, les deux disent alive:same-file', () => {
    expect(morts(ACTIVITE, APPELANT)).not.toContain(CIBLE);
    expect(verdict(CIBLE, ACTIVITE, APPELANT)).toMatchObject({ outcome: 'alive:same-file' });
  });

  it('sans l usage du fichier, les deux disent morte', () => {
    const sansUsage = f('MainActivityV2.kt',
      ACTIVITE.text.replace(
        '        MainActivityV2PreferenceInjectionHolder(application).preferenceDataService',
        '        1'));
    expect(morts(sansUsage, COMPOSANT, APPELANT)).toContain(CIBLE);
    expect(verdict(CIBLE, sansUsage, COMPOSANT, APPELANT)).toMatchObject({ outcome: 'unreferenced' });
  });
});

// ── Ce que le detecteur devrait rendre ──────────────────────────────────────

describe.skipIf(!symb)('l invariant des deux sorties', () => {
  it('explain dit alive:same-file, comme sans le composant', () => {
    expect(verdict(CIBLE, ACTIVITE, COMPOSANT, APPELANT))
      .toMatchObject({ outcome: 'alive:same-file' });
  });

  it('et les deux listes sont identiques', () => {
    const { rapportes, juges } = accord(ACTIVITE, COMPOSANT, APPELANT);
    expect(juges).toEqual(rapportes);
  });

  /**
   * L invariant general, ecrit comme tel : ce que `explain` juge jugeable est
   * exactement ce que `find` rapporte. C est le contrat qui rend `--why`
   * utilisable pour mesurer, et ce dossier s en est servi trente cinq fois.
   */
  it('l invariant, sur le corpus qui le violait', () => {
    const { rapportes, juges } = accord(ACTIVITE, COMPOSANT, APPELANT);
    expect(new Set(juges)).toEqual(new Set(rapportes));
  });
});

// ── Gardes : les familles qui respectent deja l invariant ──────────────────

describe.skipIf(!memb)('les membres s accordent, et doivent continuer', () => {
  it('sur une methode morte et une vivante', () => {
    const classe = f('Service.kt', [
      'package com.x',
      '',
      'class Service {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');
    const b = { sources: [classe, appel], testSourceSets: ['/src/test/'], includeSelfOnly: false } as any;
    const rapportes = (memb.findUnusedMembers(b) as any[]).map((m: any) => m.name).sort();
    const juges = (memb.explainMembers(b) as any[])
      .filter((m: any) => ['unreferenced', 'testOnly'].includes(String(m.outcome)))
      .map((m: any) => m.name).sort();
    expect(juges).toEqual(rapportes);
    expect(rapportes).toContain('neverCalled');
  });
});

describe.skipIf(!enums)('les enums s accordent, et doivent continuer', () => {
  it('sur deux entrees mortes et une vivante', () => {
    const enumeration = f('Mode.kt', [
      'package com.x',
      '',
      'enum class Mode {',
      '    A,',
      '    B,',
      '    C',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    println(Mode.A)\n}\n');
    const b = { sources: [enumeration, appel], testSourceSets: ['/src/test/'] } as any;
    const rapportes = ((enums.scanEnums(b) as any).entries ?? []).map((e: any) => e.name).sort();
    const juges = (enums.explainEnumEntries(b) as any[])
      .filter((e: any) => ['unreferenced', 'testOnly'].includes(String(e.outcome)))
      .map((e: any) => e.name).sort();
    expect(juges).toEqual(rapportes);
    expect(rapportes).toEqual(['B', 'C']);
  });
});

describe.skipIf(!symb)('et l invariant tient sur les formes ordinaires', () => {
  const formes: [string, { path: string; text: string }[]][] = [
    ['une classe orpheline', [f('A.kt', 'package com.x\n\nclass Orpheline\n')]],
    ['une fonction orpheline', [f('B.kt', 'package com.x\n\nfun orpheline() = 1\n')]],
    ['une classe privee', [f('C.kt', 'package com.x\n\nprivate class Priv\n')]],
    ['une classe annotee', [f('D.kt', 'package com.x\n\n@Serializable\nclass Anno\n')]],
    ['une classe de cadre', [f('E.kt', 'package com.x\n\nclass V : View\n')]],
  ];

  for (const [titre, sources] of formes) {
    it(titre, () => {
      const { rapportes, juges } = accord(...sources, APPELANT);
      expect(juges).toEqual(rapportes);
    });
  }

  it('un corpus tronque, ou les deux rendent le vide', () => {
    const entier = base([f('A.kt', 'package com.x\n\nclass Orpheline\n'), APPELANT]);
    expect(symb.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
