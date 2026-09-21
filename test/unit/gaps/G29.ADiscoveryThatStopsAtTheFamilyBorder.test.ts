import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G29 — une decouverte qui s arrete a la frontiere des familles.
 *
 * Le recensement de `unusedSymbols` est clos (G28). Celui de `unusedMembers`
 * commence ici, et son premier resultat est le plus gros ecart mesurable de
 * tout ce dossier.
 *
 * ## Le recensement des membres
 *
 * 18128 membres examines sur le corpus de reference :
 *
 *   alive         5550
 *   M2 override   4965   un `@Override` peut etre appele par le supertype
 *   M4 conteneur  4823   quelque chose ecarte la CLASSE qui les porte
 *   M3 java-sup   1240   classe Java portant un supertype quelconque
 *   M6 annotation 1119   instruit en G23
 *   selfOnly       230
 *   F12            95 | M8 44 | testOnly 40 | M12 16 | H10 4
 *   unreferenced      2
 *
 * Deux membres rapportes sur dix-huit mille. Les trois premiers filtres en
 * avalent onze mille, soit 61 %.
 *
 * ## M4, decompose
 *
 *   @ScopeApplication            1402
 *   @Module                       435
 *   @UnstableApi                  394
 *   @ScopeActivity                277
 *   F7:Fragment(via ancestor)     269
 *   F6:Serializable               212
 *   F7:ViewGroup                  200
 *   F6:Parcelable                 173
 *   F7:AppCompatActivity          163
 *   F7:View                       160
 *   F7:RecyclerView               136
 *   F7:Fragment                   131
 *
 * ## L ecart, mesure
 *
 * `@ScopeApplication` et `@ScopeActivity` sont des annotations de portee
 * Dagger DECLAREES DANS LE PROJET :
 *
 *
 * KJ-070 a appris a `unusedSymbols` a les reconnaitre : il collecte les
 * annotations du workspace portant `@Scope` et cesse de les traiter comme
 * etrangeres. La mesure le confirme, une classe `@ScopeApplication` sort
 * `alive:main`.
 *
 * `unusedMembers` n a jamais recu cette decouverte. Sa liste
 * `BENIGN_MEMBER_ANNOTATIONS` (unusedMembers.ts:136) contient `Singleton` et
 * `Reusable` en dur, avec ce commentaire : « les portees personnalisees
 * restent etrangeres : ensemble inconnaissable ». Il ne l est plus depuis
 * KJ-070.
 *
 * Consequence chiffree : **1679 membres** (1402 + 277) ecartes par des
 * annotations que l autre famille sait deja reconnaitre. C est le plus gros
 * ecart mesurable du dossier.
 *
 * Et le raisonnement est deja ecrit dans le code, pour `@Singleton` : « le
 * code genere par Dagger n appelle jamais que le CONSTRUCTEUR d une classe a
 * portee. Ses autres membres sont appeles par du code ordinaire que le sac
 * lit. » Exactement le meme argument vaut pour `@ScopeApplication`.
 *
 * ## Le second cas : un marqueur de stabilite
 *
 * `@UnstableApi` (394 membres) vient de media3 et dit « cette API peut
 * changer ». Elle ne dit rien de qui appelle. Motif reel :
 *
 * ## Le troisieme : un conteneur ecarte ecarte ses membres
 *
 * `M4:F6:Serializable` 212 et `M4:F6:Parcelable` 173. Une classe serialisable
 * est fabriquee par la bibliotheque, ce qui justifie F6 sur la CLASSE ; mais
 * la bibliotheque n appelle pas ses methodes. Les 385 membres correspondants
 * sont ecartes sans raison.
 *
 * Les cas `M4:F7:*` sont differents et restent gardes : un cadre qui fabrique
 * un `Fragment` en appelle bel et bien les methodes de cycle de vie.
 */

const memb: any = await importOrNull('src/providers/unusedMembers');
const symb: any = await importOrNull('src/providers/unusedSymbols');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any);

const membre = (nom: string, ...sources: { path: string; text: string }[]) =>
  (memb.explainMembers(base(sources)) as any[]).find((m: any) => m.name === nom);

const morts = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers(base(sources)) as any[]).map((m: any) => m.name);

const symbole = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom);

/**
 * Une portee Dagger declaree par le projet, reconnaissable a son `@Scope`.
 */
const PORTEE = f('ScopeApplication.kt', [
  'package com.x',
  '',
  'import javax.inject.Scope',
  '',
  '@Scope',
  'annotation class ScopeApplication',
  '',
].join('\n'));

/**
 * Un service ordinaire : une methode appelee, une qui ne l est pas. Forme
 * reduite de.
 */
const service = (annotation: string) => f('Service.kt', [
  'package com.x',
  '',
  ...(annotation ? [annotation] : []),
  'class Service {',
  '',
  '    fun used() = 1',
  '',
  '    fun neverCalled() = 2',
  '}',
  '',
].join('\n'));

const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!memb)('le detecteur juge bien ces membres', () => {
  it('sans annotation, la methode que personne n appelle est rapportee', () => {
    expect(morts(service(''), APPELANT)).toContain('neverCalled');
  });

  /**
   * Et le mecanisme existe deja : `@Singleton` est dans la liste benigne, donc
   * une classe `@Singleton` laisse juger ses membres. C est exactement ce que
   * ce trou demande pour les portees du projet.
   */
  it('avec @Singleton, deja benigne, elle l est encore', () => {
    expect(morts(service('@Singleton'), APPELANT)).toContain('neverCalled');
  });
});

// ── Sentinelles : l ecart entre les deux familles ──────────────────────────

describe.skipIf(!memb || !symb)('aujourd hui, la decouverte ne traverse pas', () => {
  const CORPUS = [PORTEE, service('@ScopeApplication'), APPELANT];

  /**
   * Les deux lignes qui montrent l ecart : le MEME corpus, la MEME annotation,
   * et deux familles qui n en tirent pas la meme conclusion.
   */
  it('unusedSymbols reconnait la portee du projet', () => {
    expect(symbole('Service', ...CORPUS)).toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * CORRIGÉ. `scopeAnnotationsOf` traverse maintenant jusqu'ici : la portée
   * déclarée par le projet est bénigne, comme `@Singleton` l'était déjà.
   * Mesuré sur le corpus : M4 passe de 4815 à 3067, soit 1748 membres rendus
   * au jugement, et 15 trouvailles de plus.
   */
  it('unusedMembers la reconnait desormais', () => {
    expect(membre('neverCalled', ...CORPUS)).toMatchObject({ outcome: 'unreferenced' });
  });

  it('et la methode qui EST appelee sort vivante', () => {
    expect(membre('used', ...CORPUS)).toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * La decouverte cote symboles depend bien de la declaration : sans le
   * fichier qui declare la portee, `unusedSymbols` retombe sur F5. Ce qui
   * prouve que c est la decouverte, et non un cas particulier code en dur.
   */
  it('sans le fichier qui declare la portee, les symboles retombent sur F5', () => {
    expect(symbole('Service', service('@ScopeApplication'), APPELANT))
      .toMatchObject({ outcome: 'F5:@ScopeApplication' });
  });

  it('un marqueur de stabilite ecarte lui aussi tous les membres', () => {
    expect(membre('neverCalled', service('@UnstableApi'), APPELANT))
      .toMatchObject({ outcome: 'M4:@UnstableApi' });
  });

  it('et une classe serialisable ecarte les siens', () => {
    const serialisable = f('Service.kt', [
      'package com.x',
      '',
      'class Service : Serializable {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    expect(membre('neverCalled', serialisable, APPELANT))
      .toMatchObject({ outcome: 'M4:F6:Serializable' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!memb)('la decouverte devrait traverser', () => {
  it('les membres d une classe a portee du projet sont juges', () => {
    expect(morts(PORTEE, service('@ScopeApplication'), APPELANT)).toContain('neverCalled');
  });

  it('la methode appelee sort vivante, pas ecartee', () => {
    expect(membre('used', PORTEE, service('@ScopeApplication'), APPELANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
 * Motif reel:. Une annotation
   * qui parle de la STABILITE d une API ne dit rien de qui l appelle.
   */
  it.fails('un marqueur de stabilite ne devrait rien ecarter', () => {
    expect(morts(service('@UnstableApi'), APPELANT)).toContain('neverCalled');
  });

  /**
   * La bibliotheque de serialisation fabrique l objet et lit ses champs ; elle
   * n appelle pas ses methodes. 385 membres du corpus dependent de ce point.
   */
  it.fails('une classe serialisable ne devrait pas proteger ses methodes', () => {
    const serialisable = f('Service.kt', [
      'package com.x',
      '',
      'class Service : Serializable {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    expect(morts(serialisable, APPELANT)).toContain('neverCalled');
  });
});

// ── Gardes : les conteneurs dont les membres SONT appeles ──────────────────

describe.skipIf(!memb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(morts(service(''), APPELANT)).toContain('neverCalled');

  /**
   * Un `@Module` Dagger : ses methodes de fourniture sont appelees par le code
   * genere, que le corpus ne contient pas. 435 membres en dependent.
   */
  it('un @Module, dont les fournitures sont appelees par le code genere', () => {
    temoin();
    const module = f('Service.kt', [
      'package com.x',
      '',
      '@Module',
      'class Service {',
      '',
      '    @Provides',
      '    fun provideThing() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    expect(morts(module, APPELANT)).not.toContain('neverCalled');
  });

  /**
   * Un `Fragment` : le cadre appelle `onCreate`, `onResume` et le reste. La
   * difference avec `Serializable` est que le cadre APPELLE, il ne se contente
   * pas de fabriquer. Les 1059 membres `M4:F7:*` restent proteges.
   */
  it('un Fragment, dont le cadre appelle les methodes de cycle de vie', () => {
    temoin();
    const fragment = f('Service.kt', [
      'package com.x',
      '',
      'class Service : Fragment() {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    expect(morts(fragment, APPELANT)).not.toContain('neverCalled');
  });

  it('une View, meme raison', () => {
    temoin();
    const vue = f('Service.kt', [
      'package com.x',
      '',
      'class Service : View {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    expect(morts(vue, APPELANT)).not.toContain('neverCalled');
  });

  /**
   * Et la garde qui borne la relache des portees : une annotation que le
   * corpus ne declare PAS reste etrangere. C est la regle de KJ-070, et elle
   * doit valoir ici aussi, sans quoi la relache s appliquerait a n importe
   * quelle annotation inconnue.
   */
  it('une annotation que le corpus ne declare pas reste etrangere', () => {
    temoin();
    expect(morts(service('@ScopeApplication'), APPELANT)).not.toContain('neverCalled');
  });

  /**
   * Et une annotation du corpus qui ne porte PAS `@Scope` n est pas une
   * portee : la declarer ne doit rien relacher.
   */
  it('une annotation du corpus sans @Scope n est pas une portee', () => {
    temoin();
    const marqueur = f('Marker.kt', [
      'package com.x',
      '',
      'annotation class ScopeApplication',
      '',
    ].join('\n'));
    expect(morts(marqueur, service('@ScopeApplication'), APPELANT)).not.toContain('neverCalled');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = base([service(''), APPELANT]);
    expect((memb.findUnusedMembers(entier) as any[]).length).toBeGreaterThan(0);
    expect(memb.findUnusedMembers({ ...entier, truncated: true })).toHaveLength(0);
  });
});
