/**
 * KJ-011 — un en-tete de classe sans corps ne doit pas capturer l'accolade
 * suivante du fichier.
 *
 * `pendingClass` sert aux en-tetes multilignes (`class Vm @Inject constructor(`
 * … `) : ViewModel() {`). Il restait arme pour le reste du fichier quand la
 * classe n'avait tout simplement pas de corps, ce qui est le cas de toute
 * `data class Foo(...)`. La classe SUIVANTE ouvrait alors son corps sur sa
 * propre accolade, puis le drapeau se redeclenchait sur l'accolade de son
 * premier membre : le corps etait cru un niveau trop bas, et l'accolade
 * fermante correspondante le refermait pour de bon. Tous les separateurs de
 * cette classe disparaissaient.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse (3187 fichiers Kotlin) :
 * 1290 declarations de classe sans corps dans 685 fichiers. 15 fichiers
 * changent de resultat : 37 separateurs retrouves, dont 5 fichiers ou la
 * fonctionnalite etait completement muette (`FileLoggingTree.kt` passait de 0 a
 * 11), et 2 faux separateurs retires, tous deux au dessus du PREMIER membre
 * d'un companion object, la ou IntelliJ n'en trace aucun.
 */
import { describe, it, expect } from 'vitest';
import { computeSeparatorLines } from '../../src/providers/MethodSeparatorProvider';

const NL = String.fromCharCode(10);
const sep = (lines: string[]) => computeSeparatorLines(lines.join(NL));

describe('computeSeparatorLines — classe sans corps en tete de fichier', () => {
  const CLASSE = [
    'class Bar {',
    '    fun one() {}',
    '    fun two() {}',
    '    fun three() {}',
    '}',
  ];

  it('temoin : seule, la classe recoit ses separateurs', () => {
    expect(sep(CLASSE)).toEqual([2, 3]);
  });

  it('precedee d une data class sans corps, elle les garde', () => {
    const lignes = ['data class Foo(', '    val a: String,', ')', '', ...CLASSE];
    // Meme classe, decalee de 4 lignes.
    expect(sep(lignes)).toEqual([6, 7]);
  });

  it('precedee d une data class sur une seule ligne', () => {
    const lignes = ['data class Foo(val a: String)', '', ...CLASSE];
    expect(sep(lignes)).toEqual([4, 5]);
  });

  it('precedee de deux classes sans corps', () => {
    const lignes = ['sealed interface Deep', 'data object Login : Deep', '', ...CLASSE];
    expect(sep(lignes)).toEqual([5, 6]);
  });

  it('aucun separateur au dessus du PREMIER membre d un companion object', () => {
    // Le faux positif que l'ancien code produisait : le corps de l'interface
    // etait cru commencer au niveau du companion, donc `fun parse` passait pour
    // un membre de second rang.
    expect(sep([
      'sealed interface Deep',
      'data object Login : Deep',
      '',
      'sealed interface Nav : Deep {',
      '    companion object {',
      '        fun parse(x: String): Int {',
      '            return 0',
      '        }',
      '    }',
      '}',
    ])).toEqual([]);
  });
});

describe('computeSeparatorLines — les en-tetes multilignes restent couverts', () => {
  it('constructeur Hilt sur plusieurs lignes', () => {
    expect(sep([
      'class Vm @Inject constructor(',
      '    private val repo: Repo,',
      ') : ViewModel() {',
      '    fun one() {}',
      '    fun two() {}',
      '}',
    ])).toEqual([4]);
  });

  it('nom de classe, annotation, puis constructeur secondaire', () => {
    expect(sep([
      'class Uid',
      '@VisibleForTesting',
      'constructor(id: String?) : Parcelable {',
      '    val id = id',
      '',
      '    constructor(p: Parcel) : this(p.readString())',
      '',
      '    override fun equals(other: Any?): Boolean {',
      '        return true',
      '    }',
      '}',
    ])).toEqual([7]);
  });

  it('ligne vide A L INTERIEUR de l en-tete, parentheses deja fermees', () => {
    // Forme reelle trouvee sur le corpus : `) :` puis une ligne vide puis le
    // supertype. Une regle qui couperait l'en-tete sur la premiere ligne vide
    // perdrait tous les separateurs de cette classe.
    expect(sep([
      '@NonSingleton',
      'class Load @Inject internal constructor(',
      '    private val a: A,',
      '    private val b: B',
      ') :',
      '',
      '    Base<X, Y>() {',
      '    override fun createSingle(x: X): Y {',
      '        return y',
      '    }',
      '',
      '    override fun publishError(e: E) {',
      '    }',
      '',
      '    class Request(val id: String) {',
      '        override fun toString(): String = "x"',
      '    }',
      '}',
    ])).toEqual([11, 14]);
  });
});
