import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G35 — un fichier qui fait taire une famille entiere.
 *
 * Premier recensement des familles secondaires, et il rapporte la plus grosse
 * recolte depuis G30.
 *
 *   evenements (findUnheardEvents)          5 trouvailles
 *   dependances Gradle                      0 trouvailles, 275 explications alive
 *   cles Remote Config                      0 trouvailles, 328 explications
 *                                           dont 95 `unreferenced`
 *
 * La derniere ligne est une contradiction : `explainRemoteConfigKeys` juge 95
 * declarations jamais lues, et `findUnusedRemoteConfigKeys` n en rapporte
 * aucune. Les deux fonctions du meme fichier ne disent pas la meme chose.
 *
 * ## La cause : un coupe circuit que l explication ne modelise pas
 *
 * `findUnusedRemoteConfigKeys` porte cette ligne (unusedRemoteConfigKeys.ts:197) :
 *
 *   if (input.sources.some(s => ... READS_EVERY_KEY.test(s.text))) return [];
 *
 * Un SEUL fichier du depot qui lit `remoteConfig.all` ou `getAll()` eteint la
 * famille entiere. `explainRemoteConfigKeys` n a pas cette ligne, d ou le
 * desaccord.
 *
 * ## Les trois declencheurs du corpus, et pourquoi deux sont abusifs
 *
 *
 * Les deux premiers sont la MEME forme, et ils ne lisent pas toutes les cles :
 *
 *   override fun getAll(): Map<String, String> =
 *       RemoteConfigParameter.entries.asSequence().map { it.key }
 *           .associateWith { remoteConfig.all.getValue(it).asString() }
 *
 * `remoteConfig.all` n est ici qu une table de correspondance, interrogee cle
 * par cle pour les entrees d un enum connu. Une cle presente dans le XML de
 * valeurs par defaut mais absente de `RemoteConfigParameter` n est jamais
 * retournee. Elle n est donc pas lue, et le coupe circuit a tort.
 *
 * Le troisieme, lui, est un ecran d administration qui affiche tout : c est le
 * cas pour lequel la garde a ete ecrite, et il reste garde ci dessous.
 *
 * ## Ce que ca coute
 *
 * **29 cles distinctes** jamais lues, sur 95 declarations (le corpus decline
 * chaque cle en trois ou quatre variantes de `remote_config_defaults.xml`).
 * Trois relues a la main, toutes confirmees : `enable_dark_mode`,
 * `section_navigator_enabled` et `external_web_hosts` n apparaissent que dans
 * les fichiers de valeurs par defaut, jamais dans un `.kt` ni un `.java`.
 *
 *
 * ## Ce que ces tests demandent
 *
 * Que le coupe circuit distingue une LECTURE de toutes les cles d une simple
 * table de correspondance. Une iteration sur `.all` (`for ((k, v) in ...)`,
 * `.all.forEach`) lit tout ; un `.all.getValue(cle)` ou `.all[cle]` ne lit que
 * cette cle.
 *
 * Et, accessoirement, que `explain` modelise la meme chose que `find`. Un
 * detecteur dont les deux sorties se contredisent est un detecteur dont on ne
 * peut pas mesurer les gardes, ce que G28 demandait deja.
 */

const rc: any = await importOrNull('src/providers/unusedRemoteConfigKeys');

const f = (path: string, text: string) => ({ path, text });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'] } as any);

const morts = (...sources: { path: string; text: string }[]) =>
  (rc.findUnusedRemoteConfigKeys(base(sources)) as any[]).map((k: any) => k.name);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (rc.explainRemoteConfigKeys(base(sources)) as any[]).find((k: any) => k.name === nom);

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** app/src/main/res/xml/remote_config_defaults.xml:212 */
const DEFAUTS = f('/w/app/src/main/res/xml/remote_config_defaults.xml', [
  '<defaults>',
  '    <entry><key>enable_dark_mode</key><value>false</value></entry>',
  '    <entry><key>appstore_review_days_delay</key><value>7</value></entry>',
  '</defaults>',
  '',
].join('\n'));

/** L enum qui nomme les cles reellement lues. */
const PARAMETRES = f('/w/app/src/main/java/com/x/RemoteConfigParameter.kt', [
  'package com.x',
  '',
  'enum class RemoteConfigParameter(val key: String) {',
  '    DELAY("appstore_review_days_delay")',
  '}',
  '',
].join('\n'));

/**
 * `remoteConfig.all` sert de table de correspondance, interrogee cle par cle.
 */
const PROJECTION = f('/w/app/src/main/java/com/x/RemoteConfigurationService.kt', [
  'package com.x',
  '',
  'fun getAll(): Map<String, String> =',
  '    RemoteConfigParameter.entries.asSequence().map { it.key }',
  '        .associateWith { remoteConfig.all.getValue(it).asString() }',
  '',
].join('\n'));

/** host/base/.../service/RemoteConfigurationService.kt:113, meme forme. */
const PROJECTION_INDEXEE = f('/w/app/src/main/java/com/x/Autre.kt', [
  'package com.x',
  '',
  'fun getAll(): Map<String, String> {',
  '    val allValues = remoteConfig.all',
  '    return RemoteConfigParameter.entries.associateBy(',
  '        keySelector = { it.key },',
  '        valueTransform = { allValues[it.key]?.asString().orEmpty() },',
  '    )',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!rc)('la famille juge bien ce corpus', () => {
  it('une cle que rien ne lit est rapportee', () => {
    expect(morts(DEFAUTS, PARAMETRES)).toEqual(['enable_dark_mode']);
  });

  it('et celle que l enum nomme ne l est pas', () => {
    expect(verdict('appstore_review_days_delay', DEFAUTS, PARAMETRES))
      .toMatchObject({ outcome: 'alive:1' });
  });
});

// ── Une table de correspondance n est pas une lecture de tout ──────────────

describe.skipIf(!rc)('une table de correspondance n est pas une lecture de tout', () => {
  it('la projection par enum ne fait plus taire le detecteur', () => {
    expect(morts(DEFAUTS, PARAMETRES)).toEqual(['enable_dark_mode']);
    expect(morts(DEFAUTS, PARAMETRES, PROJECTION)).toEqual(['enable_dark_mode']);
  });

  it('ni la forme indexee, ou le nom lie n est jamais parcouru', () => {
    expect(morts(DEFAUTS, PARAMETRES, PROJECTION_INDEXEE)).toEqual(['enable_dark_mode']);
  });

  /**
   * La forme minimale du meme malentendu : une seule cle tiree de `.all`.
   * Elle ne lit qu une cle, et elle eteignait les 29 autres.
   */
  it('un acces a une seule cle n eteint rien', () => {
    const une = f('/w/app/src/main/java/com/x/Une.kt', [
      'package com.x',
      '',
      'fun delay() = remoteConfig.all["appstore_review_days_delay"]',
      '',
    ].join('\n'));
    expect(morts(DEFAUTS, PARAMETRES, une)).toEqual(['enable_dark_mode']);
  });

  /**
   * Une projection venue de n importe quel module n eteint plus rien non plus.
   */
  it('ni celle qui vient d un autre module', () => {
    const ailleurs = f('/w/lib/src/main/java/com/y/Service.kt', PROJECTION.text.replace('com.x', 'com.y'));
    expect(morts(DEFAUTS, PARAMETRES, ailleurs)).toEqual(['enable_dark_mode']);
  });
});

// ── Les deux sorties de la famille disent la meme chose ────────────────────

/**
 * L invariant que G41 reclame : une declaration jugee `unreferenced` par
 * `explain` DOIT etre rapportee par `find`. Sinon `--why` explique une
 * trouvaille qui ne vient jamais, et aucune garde ne se mesure.
 */
describe.skipIf(!rc)('explain modelise les deux abandons de find', () => {
  const balayage = f('/w/app/src/main/java/com/x/Dump.kt', [
    'package com.x',
    '',
    'fun dump() {',
    '    for ((k, v) in remoteConfig.all) println("$k=$v")',
    '}',
    '',
  ].join('\n'));

  it('sous un balayage, aucune declaration ne reste unreferenced', () => {
    expect(morts(DEFAUTS, PARAMETRES, balayage)).toEqual([]);
    const tous = rc.explainRemoteConfigKeys(base([DEFAUTS, PARAMETRES, balayage])) as any[];
    expect(tous.filter(d => d.outcome === 'unreferenced')).toEqual([]);
  });

  it('et le verdict nomme le fichier qui balaye', () => {
    expect(verdict('enable_dark_mode', DEFAUTS, PARAMETRES, balayage))
      .toMatchObject({ outcome: 'R4:every-key-read:/w/app/src/main/java/com/x/Dump.kt' });
  });

  it('un corpus tronque ne laisse pas non plus de unreferenced', () => {
    const tous = rc.explainRemoteConfigKeys(
      { ...base([DEFAUTS, PARAMETRES]), truncated: true },
    ) as any[];
    expect(new Set(tous.map(d => d.outcome))).toEqual(new Set(['R0:truncated-corpus']));
  });
});

// ── Gardes : les lectures qui lisent vraiment tout ─────────────────────────

describe.skipIf(!rc)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(morts(DEFAUTS, PARAMETRES)).toEqual(['enable_dark_mode']);

  /**
   * Le motif pour lequel la garde existe : une boucle sur `.all` atteint
   * toutes les cles sans en nommer aucune.
   */
  it('une iteration sur remoteConfig.all', () => {
    temoin();
    const balayage = f('/w/app/src/main/java/com/x/Dump.kt', [
      'package com.x',
      '',
      'fun dump() {',
      '    for ((k, v) in remoteConfig.all) println("$k=$v")',
      '}',
      '',
    ].join('\n'));
    expect(morts(DEFAUTS, PARAMETRES, balayage)).toEqual([]);
  });

  it('un forEach sur remoteConfig.all', () => {
    temoin();
    const foreach = f('/w/app/src/main/java/com/x/Dump.kt', [
      'package com.x',
      '',
      'fun dump() = remoteConfig.all.forEach { (k, v) -> println("$k=$v") }',
      '',
    ].join('\n'));
    expect(morts(DEFAUTS, PARAMETRES, foreach)).toEqual([]);
  });

  /**
 * — l ecran
   * d administration qui affiche toutes les valeurs. C est le cas cite par le
   * commentaire de la garde, et il doit rester garde.
   */
  it('un ecran d administration qui affiche tout', () => {
    temoin();
    const admin = f('/w/app/src/main/java/com/x/AdminViewModel.kt', [
      'package com.x',
      '',
      'fun rows() = remoteConfigurationValuesHelper.getAll().map { (k, v) -> "$k = $v" }',
      '',
    ].join('\n'));
    expect(morts(DEFAUTS, PARAMETRES, admin)).toEqual([]);
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    temoin();
    expect(rc.findUnusedRemoteConfigKeys({ ...base([DEFAUTS, PARAMETRES]), truncated: true })).toEqual([]);
  });

  /**
   * Et le marqueur d ignorance, qui est l intention explicite de l auteur.
   */
  it('une cle marquee comme ignoree', () => {
    temoin();
    const marque = f('/w/app/src/main/res/xml/remote_config_defaults.xml', [
      '<defaults>',
      '    <!-- kotlin-jump:ignore unused-remote-config-key -->',
      '    <entry><key>enable_dark_mode</key><value>false</value></entry>',
      '</defaults>',
      '',
    ].join('\n'));
    expect(morts(marque, PARAMETRES)).toEqual([]);
  });
});

// ── La soupape : un ecran qui affiche tout n est pas un consommateur ───────

/**
 * Un balayage reste un balayage, et le detecteur ne sait pas distinguer un
 * ecran de mise au point qui AFFICHE toutes les valeurs d un consommateur qui
 * les APPLIQUE. Le premier n a pourtant besoin d aucune declaration : il rend
 * ce que Firebase sert, le XML de valeurs par defaut n etant qu un repli.
 *
 * Plutot que de deviner, le meme marqueur que pour une cle dit, sur le fichier
 * declencheur, que son balayage n est pas une raison d aveugler la famille.
 * C est le seul levier qui rend les 29 cles de la vitrine atteignables, et il
 * est ecrit par la main de l auteur.
 *
 */
describe.skipIf(!rc)('un balayage marque ne fait plus taire la famille', () => {
  const dump = (entete: string) => f('/w/app/src/main/java/com/x/Dump.kt', [
    'package com.x',
    '',
    entete,
    'fun dump() = remoteConfig.all.map { (k, v) -> "$k=$v" }',
    '',
  ].join('\n'));

  it('sans le marqueur, il eteint tout', () => {
    expect(morts(DEFAUTS, PARAMETRES, dump(''))).toEqual([]);
  });

  it('avec le marqueur, les cles jamais lues reviennent', () => {
    expect(morts(DEFAUTS, PARAMETRES, dump('// kotlin-jump:ignore unused-remote-config-key')))
      .toEqual(['enable_dark_mode']);
  });
});
