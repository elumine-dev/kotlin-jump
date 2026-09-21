import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G41 — la seconde regle, derriere trois trous.
 *
 * G40 a ecrit la premiere des deux regles que le recensement a fait
 * apparaitre. Voici la seconde, et ses trois sites :
 *
 *   G28  le filtre ecrase le verdict qu aurait donne le comptage
 *   G35  le coupe circuit n est pas modelise par l explication
 *   G36  une branche conclut avant qu une autre ait parle
 *
 * ## La regle
 *
 * `explain` et `find` doivent dire la meme chose du meme corpus. Ce que l une
 * juge rapportable, l autre le rapporte ; ce que l une epargne, l autre
 * l epargne.
 *
 * Ce n est pas une elegance. `--why` est l outil avec lequel ce dossier a
 * mesure trente neuf trous, et trois fois il a fallu s apercevoir qu il
 * mentait avant de croire un chiffre. Une explication qui ne suit pas le
 * detecteur ne permet pas de mesurer les gardes, ce qui est precisement ce
 * que G28 demandait.
 *
 * ## Les trois formes de divergence, mesurees
 *
 * **G28, le filtre ecrase.** `explainSymbols` applique `rejectionReason` avant
 * de regarder les mentions (unusedSymbols.ts:1709). Une interface `F8` reste
 * `F8` qu un consommateur existe ou non ; seul `mainMentions` bouge, et il ne
 * suffit pas a reconstruire le verdict puisqu il compte aussi les mentions du
 * fichier declarant. Aucun champ ne dit ce que le comptage aurait donne.
 *
 * **G35, le coupe circuit invisible.** `findUnusedRemoteConfigKeys` sort par
 * `return []` des qu un fichier lit `remoteConfig.all`
 * (unusedRemoteConfigKeys.ts:197). `explainRemoteConfigKeys` n a pas cette
 * ligne : il continue de juger les cles jamais lues. Sur le corpus, 95
 * declarations d un cote, zero de l autre.
 *
 * **G36, la branche trop rapide.** Pour
 *, `explain` teste d abord si les
 * mentions HORS du fichier se reduisent a des declarations d injection. Ici
 * oui, donc il conclut `unreferenced` et n atteint jamais la branche
 * `alive:same-file`, qui vient apres. `find`, lui, epargne la classe parce que
 * son propre fichier la construit (MainActivityV2).
 *
 * ## Comment chaque site est eprouve
 *
 * Comme en G40 : deux appels par site sur le MEME corpus a une chose pres, et
 * le premier est vert. Ce qui change d un appel a l autre n est jamais la
 * cible, c est son contexte ; et le detecteur, lui, suit ce changement.
 *
 * Ce fichier n ajoute aucune trouvaille. Il permet de verifier d un seul coup
 * qu une correction de l instrumentation vaut aux trois endroits.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const enums: any = await importOrNull('src/providers/unusedEnumEntries');
const rc: any = await importOrNull('src/providers/unusedRemoteConfigKeys');

const M = '/w/app/src/main/java/com/x';
const f = (chemin: string, texte: string) => ({ path: chemin, text: texte });

const VIVANT = f(`${M}/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');

const baseS = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'] } as any);

const verdictS = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols(baseS(sources)) as any[]).find(s => s.name === nom);

const rapportesS = (...sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols(baseS(sources)) as any[]).map(s => s.name);

/** Les deux sorties confrontees : jugeables d un cote, rapportes de l autre. */
const confronte = (...sources: { path: string; text: string }[]) => ({
  rapportes: rapportesS(...sources).sort(),
  juges: (symb.explainSymbols(baseS(sources)) as any[])
    .filter(s => ['unreferenced', 'testOnly'].includes(String(s.outcome)))
    .map(s => s.name).sort(),
});

// ── Site 1, G28 : le filtre ecrase le verdict du comptage ──────────────────

describe.skipIf(!symb)('G28, le filtre qui ecrase', () => {
  /** core/ui/.../audio/repository/AudioRepository.kt:3 */
  const INTERFACE = f(`${M}/Repo.kt`, [
    'package com.x',
    '',
    'interface Repo {',
    '',
    '    fun load(): Int',
    '}',
    '',
  ].join('\n'));

  const IMPL = f(`${M}/Noop.kt`, [
    'package com.x',
    '',
    '@Serializable',
    'class Noop : Repo {',
    '',
    '    override fun load() = 0',
    '}',
    '',
  ].join('\n'));

  const CONSOMMATEUR = f(`${M}/Player.kt`, [
    'package com.x',
    '',
    'class Player(private val r: Repo) {',
    '',
    '    fun go() = r.load()',
    '}',
    '',
  ].join('\n'));

  it('le compte de mentions suit bien le corpus', () => {
    const sans = verdictS('Repo', INTERFACE, IMPL, VIVANT);
    const avec = verdictS('Repo', INTERFACE, IMPL, CONSOMMATEUR, VIVANT);
    expect(avec.mainMentions).toBeGreaterThan(sans.mainMentions);
  });

  it('mais le verdict, lui, ne bouge pas', () => {
    expect(verdictS('Repo', INTERFACE, IMPL, VIVANT)).toMatchObject({ outcome: 'F8:annotated-subtype' });
    expect(verdictS('Repo', INTERFACE, IMPL, CONSOMMATEUR, VIVANT))
      .toMatchObject({ outcome: 'F8:annotated-subtype' });
  });

  it('l explication dit ce que le comptage aurait donne', () => {
    expect(verdictS('Repo', INTERFACE, IMPL, CONSOMMATEUR, VIVANT)).toHaveProperty('wouldBe');
  });

  /**
   * A defaut, les mentions du fichier declarant suffiraient a le reconstruire.
   * `mainMentions` seul ne suffit pas : il les compte sans les distinguer.
   */
  it('et expose les mentions du fichier declarant', () => {
    expect(verdictS('Repo', INTERFACE, IMPL, CONSOMMATEUR, VIVANT)).toHaveProperty('selfInFile');
  });
});

// ── Site 2, G35 : le coupe circuit invisible ───────────────────────────────

describe.skipIf(!rc)('G35, le coupe circuit que l explication ignore', () => {
  /** app/src/main/res/xml/remote_config_defaults.xml:212 */
  const DEFAUTS = f('/w/app/src/main/res/xml/remote_config_defaults.xml', [
    '<defaults>',
    '    <entry><key>enable_dark_mode</key><value>false</value></entry>',
    '</defaults>',
    '',
  ].join('\n'));

  /** app/common/.../service/impl/RemoteConfigurationService.kt:67 */
  const PROJECTION = f(`${M}/RemoteConfigurationService.kt`, [
    'package com.x',
    '',
    'fun getAll(): Map<String, String> =',
    '    RemoteConfigParameter.entries.asSequence().map { it.key }',
    '        .associateWith { remoteConfig.all.getValue(it).asString() }',
    '',
  ].join('\n'));

  const b = (sources: { path: string; text: string }[]) =>
    ({ sources, testSourceSets: ['/src/test/'] } as any);

  const deux = (...sources: { path: string; text: string }[]) => ({
    rapportes: (rc.findUnusedRemoteConfigKeys(b(sources)) as any[]).map((k: any) => k.name),
    juges: (rc.explainRemoteConfigKeys(b(sources)) as any[])
      .filter((k: any) => String(k.outcome) === 'unreferenced').map((k: any) => k.name),
  });

  it('sans le coupe circuit, les deux sorties s accordent', () => {
    const { rapportes, juges } = deux(DEFAUTS, VIVANT);
    expect(rapportes).toEqual(juges);
    expect(rapportes).toEqual(['enable_dark_mode']);
  });

  /**
   * La projection par enum n est plus un coupe circuit : elle interroge `.all`
   * cle par cle, donc elle ne lit pas les autres.
   */
  it('avec la projection, les deux sorties s accordent encore', () => {
    const { rapportes, juges } = deux(DEFAUTS, PROJECTION, VIVANT);
    expect(rapportes).toEqual(['enable_dark_mode']);
    expect(juges).toEqual(rapportes);
  });

  /** Et sous un vrai balayage, les deux se taisent ensemble. */
  it('sous un balayage, les deux se taisent ensemble', () => {
    const balayage = f(`${M}/Dump.kt`, [
      'package com.x',
      '',
      'fun dump() = remoteConfig.all.forEach { (k, v) -> println("$k=$v") }',
      '',
    ].join('\n'));
    const { rapportes, juges } = deux(DEFAUTS, balayage, VIVANT);
    expect(rapportes).toEqual([]);
    expect(juges).toEqual(rapportes);
  });
});

// ── Site 3, G36 : la branche trop rapide ───────────────────────────────────

describe.skipIf(!symb)('G36, la branche qui conclut avant l autre', () => {
  /** app/.../mainV2/MainActivityV2.kt:152 pour l usage, :639 pour la declaration. */
  const ACTIVITE = f(`${M}/MainActivityV2.kt`, [
    'package com.x',
    '',
    'class MainActivityV2 {',
    '',
    '    fun flag(application: Context) = Holder(application).svc',
    '}',
    '',
    'class Holder(context: Context) {',
    '',
    '    @Inject',
    '    lateinit var svc: Svc',
    '',
    '    init {',
    '        Graph.app(context).inject(this)',
    '    }',
    '}',
    '',
  ].join('\n'));

  /** app/.../core/dagger/component/AppApplicationComponent.kt:67 */
  const COMPOSANT = f(`${M}/Component.kt`, [
    'package com.x',
    '',
    'import com.x.Holder',
    '',
    'interface Component {',
    '',
    '    fun inject(target: Holder)',
    '}',
    '',
  ].join('\n'));

  const APPELANT = f(`${M}/Main.kt`, 'package com.x\n\nfun main() {\n    MainActivityV2()\n}\n');

  it('sans le composant, les deux sorties s accordent', () => {
    const { rapportes, juges } = confronte(ACTIVITE, APPELANT);
    expect(juges).toEqual(rapportes);
    expect(verdictS('Holder', ACTIVITE, APPELANT)).toMatchObject({ outcome: 'alive:same-file' });
  });

  it('avec lui, les deux s accordent encore', () => {
    expect(verdictS('Holder', ACTIVITE, COMPOSANT, APPELANT)).toMatchObject({ outcome: 'alive:same-file' });
    expect(rapportesS(ACTIVITE, COMPOSANT, APPELANT)).not.toContain('Holder');
  });

  it('les deux s accordent la aussi', () => {
    const { rapportes, juges } = confronte(ACTIVITE, COMPOSANT, APPELANT);
    expect(juges).toEqual(rapportes);
  });
});

// ── Gardes : les familles et les formes qui s accordent deja ───────────────

describe.skipIf(!memb)('les membres s accordent, et doivent continuer', () => {
  it('sur une methode morte et une vivante', () => {
    const classe = f(`${M}/Service.kt`, [
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
    const appel = f(`${M}/Main.kt`, 'package com.x\n\nfun main() {\n    Service().used()\n}\n');
    const b = { sources: [classe, appel], testSourceSets: ['/src/test/'], includeSelfOnly: false } as any;
    const rapportes = (memb.findUnusedMembers(b) as any[]).map((m: any) => m.name).sort();
    const juges = (memb.explainMembers(b) as any[])
      .filter((m: any) => ['unreferenced', 'testOnly'].includes(String(m.outcome)))
      .map((m: any) => m.name).sort();
    expect(juges).toEqual(rapportes);
  });
});

describe.skipIf(!enums)('les enums s accordent, et doivent continuer', () => {
  it('sur deux entrees mortes et une vivante', () => {
    const enumeration = f(`${M}/Mode.kt`, [
      'package com.x',
      '',
      'enum class Mode {',
      '    A,',
      '    B,',
      '    C',
      '}',
      '',
    ].join('\n'));
    const appel = f(`${M}/Main.kt`, 'package com.x\n\nfun main() {\n    println(Mode.A)\n}\n');
    const b = { sources: [enumeration, appel], testSourceSets: ['/src/test/'] } as any;
    const rapportes = ((enums.scanEnums(b) as any).entries ?? []).map((e: any) => e.name).sort();
    const juges = (enums.explainEnumEntries(b) as any[])
      .filter((e: any) => ['unreferenced', 'testOnly'].includes(String(e.outcome)))
      .map((e: any) => e.name).sort();
    expect(juges).toEqual(rapportes);
  });
});

describe.skipIf(!symb)('et les formes ordinaires de symboles', () => {
  const formes: [string, { path: string; text: string }[]][] = [
    ['une classe orpheline', [f(`${M}/A.kt`, 'package com.x\n\nclass Orpheline\n')]],
    ['une classe vivante', [
      f(`${M}/B.kt`, 'package com.x\n\nclass Vivante\n'),
      f(`${M}/C.kt`, 'package com.x\n\nfun go() = Vivante()\n'),
    ]],
    ['une classe privee', [f(`${M}/D.kt`, 'package com.x\n\nprivate class Priv\n')]],
    ['une classe de cadre', [f(`${M}/E.kt`, 'package com.x\n\nclass V : View\n')]],
    ['une classe annotee', [f(`${M}/F.kt`, 'package com.x\n\n@Serializable\nclass Anno\n')]],
  ];

  for (const [titre, sources] of formes) {
    it(titre, () => {
      const { rapportes, juges } = confronte(...sources, VIVANT);
      expect(juges).toEqual(rapportes);
    });
  }

  it('un corpus tronque, ou les deux rendent le vide', () => {
    expect(symb.findUnusedSymbols({
      ...baseS([f(`${M}/A.kt`, 'package com.x\n\nclass Orpheline\n'), VIVANT]), truncated: true,
    })).toHaveLength(0);
  });
});
