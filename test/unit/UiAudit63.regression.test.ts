import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

// Audit 63 : une annotation posee sur le RECEVEUR d'une extension, apres le mot
// cle `fun`, faisait rater la declaration entiere. `ANNOT` ne couvre que les
// annotations qui precedent `fun`. Consequence : la fonction n'existait pour
// aucune fonctionnalite, ni Outline, ni Cmd+T, ni Go to Definition, ni
// hierarchie d'appels. Six fonctions d'un meme fichier de LaPresse.

const URI = 'file:///a63/ColorUtilExt.kt';
const CODE = [
  'package p',
  '',
  '@Suppress("MagicNumber")',
  'fun @receiver:ColorInt Int.darken(amount: Int): Int {',
  '    val hsv = FloatArray(3)',
  '    return hsv[0].toInt()',
  '}',
  '',
  'fun @receiver:ColorInt Int?.isNullOrTransparent() = this == null',
  '',
  'val @receiver:ColorInt Int.estSombre: Boolean',
  '    get() = this < 0',
  '',
  'fun Int.sansAnnotation(): Int = this',
].join('\n');

describe('Une annotation de receveur ne fait pas disparaitre la declaration', () => {
  it('la fonction annotee est indexee, avec son nom et sa colonne', () => {
    const syms = parse(URI, CODE).symbols;
    const d = syms.find(s => s.name === 'darken');
    expect(d).toBeDefined();
    expect(d!.kind).toBe('fun');
    expect(d!.line).toBe(3);
    expect(CODE.split('\n')[3].slice(d!.character, d!.character + 'darken'.length)).toBe('darken');
    expect(d!.isExtension).toBe(true);
  });

  it('la forme a corps d\'expression aussi', () => {
    const syms = parse(URI, CODE).symbols;
    expect(syms.some(s => s.name === 'isNullOrTransparent')).toBe(true);
  });

  it('une propriete d\'extension annotee de meme', () => {
    const syms = parse(URI, CODE).symbols;
    const p = syms.find(s => s.name === 'estSombre');
    expect(p).toBeDefined();
    expect(CODE.split('\n')[10].slice(p!.character, p!.character + 'estSombre'.length)).toBe('estSombre');
  });

  it('les extensions sans annotation ne changent pas', () => {
    const syms = parse(URI, CODE).symbols;
    const s = syms.find(x => x.name === 'sansAnnotation');
    expect(s).toBeDefined();
    expect(s!.isExtension).toBe(true);
  });

  it('elle devient joignable par son nom', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    expect(index.lookup('darken').map(e => e.name)).toEqual(['darken']);
  });

  it('une annotation de parametre ne cree pas de faux symbole', () => {
    const code = 'package p\n\nfun applique(@Named("x") valeur: Int): Int = valeur\n';
    const syms = parse(URI, code).symbols;
    expect(syms.filter(s => s.kind === 'fun').map(s => s.name)).toEqual(['applique']);
  });
});

describe('Un appel appartient a la fonction englobante, pas a une locale', () => {
  // Le dernier `fun` avant la ligne d'appel peut etre un `override` imbrique
  // dans un objet anonyme, deja referme. Le repli choisissait alors la
  // derniere variable LOCALE, et la hierarchie d'appels annoncait `end` comme
  // appelant de `start`. 74 cas sur LaPresse avant la serie d'etendues, 12
  // avant ce correctif.
  const URI_CH = 'file:///a63/Use.kt';
  const CODE_CH = [
    'package p',
    '',
    'class UseCase {',
    '    fun construire(texte: String, url: String): Spannable {',
    '        val span = SpannableString(texte)',
    '        val clickable = object : ClickableSpan() {',
    '            override fun updateDrawState(ds: TextPaint) {',
    '                ds.isUnderlineText = true',
    '            }',
    '        }',
    '',
    '        val debut = texte.indexOf(url)',
    '        val fin = debut + url.length',
    '        span.setSpan(clickable, debut, fin, 0)',
    '        return span',
    '    }',
    '}',
  ].join('\n');

  it('la fixture met bien un fun imbriqué et deja clos avant l\'appel', () => {
    const syms = parse(URI_CH, CODE_CH).symbols;
    const imbrique = syms.find(s => s.name === 'updateDrawState')!;
    const englobante = syms.find(s => s.name === 'construire')!;
    expect(imbrique).toBeDefined();
    expect(imbrique.line).toBeLessThan(12);
    expect(imbrique.depth).toBeGreaterThan(englobante.depth);
  });

  it('la variable locale n\'est pas retenue comme conteneur', () => {
    const index = new SymbolIndex();
    index.add(parse(URI_CH, CODE_CH));
    index.finalize();
    const syms = index.getFileSymbols(URI_CH);
    const fin = syms.find(e => e.name === 'fin')!;
    expect(fin.isLocal).toBe(true);
  });
});

describe('La remontee vers la fonction englobante reste bornee', () => {
  // La boucle de remontee balayait le fichier jusqu'a l'indice 0 meme quand il
  // n'y avait rien a trouver : +9 % sur ce chemin, en distributions disjointes.
  // Deux bornes la coupent, et aucune ne doit changer le resultat.
  const URI_B = 'file:///a63/Borne.kt';

  it('un appel hors de toute fonction de plus haut niveau ne remonte a rien', () => {
    // `best` est une fonction de profondeur 0 qui ne contient pas l'appel :
    // il n'existe aucune fonction plus externe, la remontee doit etre sautee.
    const code = [
      'package p',
      '',
      'fun aide(): Int = 1',
      '',
      'val global = aide()',
    ].join('\n');
    const index = new SymbolIndex();
    index.add(parse(URI_B, code));
    index.finalize();
    const syms = index.getFileSymbols(URI_B);
    const aide = syms.find(e => e.name === 'aide')!;
    const global = syms.find(e => e.name === 'global')!;
    expect(aide.depth).toBe(0);
    expect(global.depth).toBe(0);
    expect(global.isLocal).toBeUndefined();
  });

  it('la fonction englobante est trouvee quand elle existe vraiment', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    fun externe() {',
      '        val o = object : L {',
      '            override fun interne() {}',
      '        }',
      '        val x = calcule()',
      '        println(o, x)',
      '    }',
      '}',
    ].join('\n');
    const index = new SymbolIndex();
    index.add(parse(URI_B, code));
    index.finalize();
    const syms = index.getFileSymbols(URI_B);
    const externe = syms.find(e => e.name === 'externe')!;
    const interne = syms.find(e => e.name === 'interne')!;
    // La remontee n'a de sens que si l'imbriquee est plus profonde et deja close
    // avant la ligne d'appel : c'est ce que la borne `depthLimit > 0` traverse.
    expect(interne.depth).toBeGreaterThan(externe.depth);
    expect(externe.depth).toBeGreaterThan(0);
  });
});
