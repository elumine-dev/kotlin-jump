import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G27 — un sous type non juge cautionne son parent.
 *
 * Recensement des declarations jamais jugees, promis au tour precedent. Le
 * plus gros poste restant n est ni F3 ni F7, c est **F8, 93 declarations**, et
 * c est la troisieme fois que ce dossier rencontre la meme erreur de
 * categorie, cette fois ecrite dans le filtre lui meme.
 *
 * ## Ce que F8 dit, et ce qu il fait
 *
 * « Un parent dont le SOUS TYPE appartient a un cadre est lui meme atteint par
 * ce cadre » (unusedSymbols.ts:862). Le motif qui l a fait ecrire est reel :
 * une classe scellee dont les variantes portent `@SerializedName` est
 * instanciee par la bibliotheque JSON, jamais par son nom. Ce cas est garde
 * ci dessous, il doit continuer de fonctionner.
 *
 * Mais la regle ne regarde ni QUELLE annotation, ni si le sous type est lui
 * meme vivant. Mesure sur le corpus : les 93 declarations F8 sont presque
 * toutes des **interfaces**, et leurs cautions sont des implementations
 * ordinaires.
 *
 * AudioRepository
 *       cautionnee par AudioRepositoryNoop
 * FullscreenDirector
 *       cautionnee par FullscreenDirectorImpl
 * ModuleModel
 * StyledModuleModel
 *
 * ## Les trois defauts, mesures
 *
 * **1. La caution vient d une declaration elle meme non jugee.** L
 * implementation sort en `F5:@...`, donc personne ne sait si elle vit. Une
 * declaration dont on ignore tout en cautionne une autre. C est exactement
 * G21 et G22, mais inscrit dans la regle au lieu d en etre un effet de bord.
 *
 * **2. Le filtre gagne sur le comptage.** `explainSymbols` applique
 * `rejectionReason` AVANT de regarder les mentions
 * (unusedSymbols.ts:1709-1711). Une interface F8 reste F8 qu elle ait deux
 * mentions ou trois, qu un consommateur existe ou non. Elle n est donc pas
 * « probablement vivante », elle est **definitivement non jugee**.
 *
 * **3. Il plafonne G4 et G7.** G4 cherche une interface qui n existe que pour
 * une liaison Dagger morte ; G7, une interface dont aucune methode n est
 * appelee. Si l implementation porte la moindre annotation non benigne, le
 * parent est F8 et ni l un ni l autre ne peut se prononcer. Les 93 sont donc
 * un plafond pose sur deux trous deja ecrits.
 *
 * ## Ce que ces tests demandent
 *
 * Que la caution soit conditionnee. Trois pistes, dans l ordre de surete :
 * n accepter que les annotations qui designent vraiment une fabrication par
 * un cadre (serialisation, Parcelable, Room) ; exiger que le sous type
 * cautionnaire soit lui meme juge vivant ; et laisser le comptage des
 * mentions primer quand il suffit a conclure.
 *
 * Zero suppression a la cle ici non plus, mais 93 declarations qui
 * passeraient de « jamais jugee » a « jugee », dont des interfaces que G4 et
 * G7 pourraient enfin examiner.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom);

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(s => s.name);

const VIVANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** core/ui/src/main/java/com/example/core/core/ui/audio/repository/AudioRepository.kt:3 */
const INTERFACE = f('AudioRepository.kt', [
  'package com.x',
  '',
  'interface AudioRepository {',
  '',
  '    fun load(): Int',
  '}',
  '',
].join('\n'));

/** app/.../common/audio/AudioRepositoryNoop.kt, avec son annotation. */
const IMPL_ANNOTEE = f('AudioRepositoryNoop.kt', [
  'package com.x',
  '',
  '@Serializable',
  'class AudioRepositoryNoop : AudioRepository {',
  '',
  '    override fun load() = 0',
  '}',
  '',
].join('\n'));

/** La meme, sans son annotation : le temoin. */
const IMPL_NUE = f('AudioRepositoryNoop.kt', [
  'package com.x',
  '',
  'class AudioRepositoryNoop : AudioRepository {',
  '',
  '    override fun load() = 0',
  '}',
  '',
].join('\n'));

/** Un consommateur du TYPE, pas de l implementation. */
const CONSOMMATEUR = f('Player.kt', [
  'package com.x',
  '',
  'class Player(private val r: AudioRepository) {',
  '',
  '    fun go() = r.load()',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!mod)('sans l annotation, le detecteur se prononce', () => {
  it('l interface recoit un verdict ordinaire', () => {
    expect(verdict('AudioRepository', INTERFACE, IMPL_NUE, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  it('et l implementation, que rien ne nomme, est rapportee', () => {
    expect(morts(INTERFACE, IMPL_NUE, VIVANT)).toContain('AudioRepositoryNoop');
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!mod)('aujourd hui, une annotation sur l impl eteint le parent', () => {
  it('l interface passe de jugee a F8 quand l impl est annotee', () => {
    expect(verdict('AudioRepository', INTERFACE, IMPL_NUE, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
    expect(verdict('AudioRepository', INTERFACE, IMPL_ANNOTEE, VIVANT))
      .toMatchObject({ outcome: 'F8:annotated-subtype' });
  });

  /**
   * Le cœur du defaut : la caution vient d une declaration que PERSONNE n a
   * jugee. Elle sort en F5, c est a dire « je ne sais pas », et cette absence
   * de savoir vaut certificat de vie pour son parent.
   */
  it('et la caution elle meme n est pas jugee, elle est F5', () => {
    expect(verdict('AudioRepositoryNoop', INTERFACE, IMPL_ANNOTEE, VIVANT))
      .toMatchObject({ outcome: 'F5:@Serializable' });
  });

  /**
   * Le filtre passe avant le comptage : ajouter un vrai consommateur du type
   * ne change rien au verdict. Une interface F8 n est pas « probablement
   * vivante », elle est definitivement non jugee.
   */
  it('un consommateur du type ne change pas le verdict', () => {
    const sans = verdict('AudioRepository', INTERFACE, IMPL_ANNOTEE, VIVANT);
    const avec = verdict('AudioRepository', INTERFACE, IMPL_ANNOTEE, CONSOMMATEUR, VIVANT);
    expect(sans).toMatchObject({ outcome: 'F8:annotated-subtype' });
    expect(avec).toMatchObject({ outcome: 'F8:annotated-subtype' });
    expect(avec.mainMentions).toBeGreaterThan(sans.mainMentions);
  });

  /**
   * Seule une annotation qui FABRIQUE cautionne desormais. La serialisation,
   * motif d origine de la regle, continue ; `@Singleton` est une portee, elle
   * dit combien d instances garder et jamais qui en fabrique une ; `@Keep`
   * promet a R8 qu un nom est atteint, ce qui protege la declaration ANNOTEE,
   * dont F5 s occupe deja, et ne dit rien du parent.
   */
  it('seule une annotation qui fabrique cautionne', () => {
    const impl = (anno: string) => f('AudioRepositoryNoop.kt', [
      'package com.x',
      '',
      anno,
      'class AudioRepositoryNoop : AudioRepository {',
      '',
      '    override fun load() = 0',
      '}',
      '',
    ].join('\n'));
    for (const anno of ['@Serializable', '@SerializedName("x")']) {
      expect(verdict('AudioRepository', INTERFACE, impl(anno), VIVANT), anno)
        .toMatchObject({ outcome: 'F8:annotated-subtype' });
    }
    for (const anno of ['@Keep', '@Singleton', '@UnstableApi', '@Provides']) {
      expect(verdict('AudioRepository', INTERFACE, impl(anno), VIVANT), anno)
        .toMatchObject({ outcome: 'alive:main' });
    }
  });

  /**
   * Et une portee DI declaree par l espace de travail ne cautionne pas non
   * plus, pour la meme raison : elle ne fabrique rien. Sur le projet de
   * reference c etait le premier poste de F8, `@ScopeApplication` cautionnant
   * 65 parents a lui seul et `@ScopeActivity` 35.
   */
  it('ni une portee que l espace de travail declare lui meme', () => {
    const portee = f('ScopeApplication.kt', [
      'package com.x',
      '',
      'import javax.inject.Scope',
      '',
      '@Scope',
      'annotation class ScopeApplication',
      '',
    ].join('\n'));
    const impl = f('AudioRepositoryNoop.kt', [
      'package com.x',
      '',
      '@ScopeApplication',
      'class AudioRepositoryNoop : AudioRepository {',
      '',
      '    override fun load() = 0',
      '}',
      '',
    ].join('\n'));
    expect(verdict('AudioRepository', INTERFACE, impl, portee, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!mod)('la caution devrait etre conditionnee', () => {
  it('une annotation qui ne fabrique rien ne cautionne pas', () => {
    const impl = f('AudioRepositoryNoop.kt', [
      'package com.x',
      '',
      '@Keep',
      'class AudioRepositoryNoop : AudioRepository {',
      '',
      '    override fun load() = 0',
      '}',
      '',
    ].join('\n'));
    expect(verdict('AudioRepository', INTERFACE, impl, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  it.fails('le comptage devrait primer quand un consommateur existe', () => {
    expect(verdict('AudioRepository', INTERFACE, IMPL_ANNOTEE, CONSOMMATEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Et le cas qui plafonne G4 : l interface que plus rien ne consomme devrait
   * pouvoir etre rapportee, meme si son unique implementation est annotee.
   */
  it.fails('une interface que plus rien ne consomme devrait etre rapportee', () => {
    const orpheline = f('AudioRepository.kt', [
      'package com.x',
      '',
      'interface AudioRepository',
      '',
    ].join('\n'));
    const impl = f('AudioRepositoryNoop.kt', [
      'package com.x',
      '',
      '@Keep',
      'class AudioRepositoryNoop : AudioRepository',
      '',
    ].join('\n'));
    expect(morts(orpheline, impl, VIVANT)).toContain('AudioRepository');
  });
});

// ── Gardes : le motif pour lequel F8 a ete ecrit ────────────────────────────

describe.skipIf(!mod)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(verdict('AudioRepository', INTERFACE, IMPL_NUE, VIVANT))
    .toMatchObject({ outcome: 'alive:main' });

  /**
   * Le motif d origine, cite par le code lui meme : une classe scellee dont
   * les variantes portent `@SerializedName` est fabriquee par la bibliotheque
   * JSON, jamais nommee. La relache ne doit surtout pas la decouvrir.
   */
  it('une classe scellee dont les variantes sont serialisees', () => {
    temoin();
    const scellee = f('Mode.kt', 'package com.x\n\nsealed class Mode\n');
    const variante = f('Json.kt', [
      'package com.x',
      '',
      '@SerializedName("a")',
      'class A(val a: Int) : Mode()',
      '',
    ].join('\n'));
    expect(verdict('Mode', scellee, variante, VIVANT))
      .toMatchObject({ outcome: 'F8:annotated-subtype' });
    expect(morts(scellee, variante, VIVANT)).not.toContain('Mode');
  });

  /**
   * Et la variante Parcelable, l autre fabrication invisible du monde
   * Android : le parent ne doit pas devenir supprimable parce que sa variante
   * n est nommee nulle part.
   */
  it('un parent dont la variante est Parcelize', () => {
    temoin();
    const parent = f('Payload.kt', 'package com.x\n\nsealed class Payload\n');
    const variante = f('Parcel.kt', [
      'package com.x',
      '',
      '@Parcelize',
      'class Simple(val id: Int) : Payload()',
      '',
    ].join('\n'));
    expect(morts(parent, variante, VIVANT)).not.toContain('Payload');
  });

  /**
   * Une implementation non annotee ne cautionne rien, et c est deja le cas :
   * cette garde fixe la limite du cote ou elle est deja juste.
   */
  it('une implementation nue ne cautionne pas son parent', () => {
    expect(verdict('AudioRepository', INTERFACE, IMPL_NUE, VIVANT))
      .not.toMatchObject({ outcome: 'F8:annotated-subtype' });
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [INTERFACE, IMPL_NUE, VIVANT], testSourceSets: ['/src/test/'] };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
