import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Un ilot mort ne part pas s il contient une declaration qui demande a rester.
 *
 * Au premier niveau, `@Suppress("unused")` sur une fonction en fait une racine
 * vivante, et l ilot qu elle forme avec ses voisines est garde. Dans une
 * classe, non : les mentions du corps du membre marque tombent aussi dans
 * l etendue de sa classe, qui reste candidate, et lui sont attribuees au lieu
 * de devenir des racines. Deux classes qui ne s appellent qu entre elles
 * partaient donc ensemble, avec le membre que l auteur avait ecrit de garder.
 * Le cas du membre prive, que le detecteur des membres ne regarde pas, et
 * celui du compagnon anonyme, qui n est pas un symbole, etaient encore moins
 * couverts.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const APPEL = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(vivante()) }\n');
/** Le fichier tel qu il resterait apres les coupes de la famille des ilots. */
const reste = (src: string): string => {
  const coupes = (collecterUnePasse([f(`${MAIN}/I.kt`, src), APPEL, GRADLE], ['/src/test/']).parFichier.get(`${MAIN}/I.kt`) ?? [])
    .filter((c: any) => c.famille === 'ilots')
    .sort((x: any, y: any) => y.start - x.start);
  let out = src;
  for (const c of coupes as any[]) out = out.slice(0, c.start) + c.texte + out.slice(c.end);
  return out;
};

const deuxClasses = (dansIle: string) =>
  `package com.x\n\nclass Ile {\n${dansIle}}\nclass Autre {\n    fun b(): Int = Ile().a()\n}\nfun vivante() = 3\n`;
const A = '    fun a(): Int = Autre().b()\n';

describe('l ilot garde ce qui demande a rester', () => {
  it('temoin : les deux classes qui ne s appellent qu entre elles partent', () => {
    const r = reste(deuxClasses(A));
    expect(r).not.toContain('class Ile');
    expect(r).not.toContain('class Autre');
  });

  for (const [nom, dansIle] of [
    ['membre public marque', '    @Suppress("unused")\n' + A],
    ['membre public marque en ligne', '    @Suppress("unused") ' + A.trimStart()],
    ['SuppressWarnings', '    @SuppressWarnings("unused")\n' + A],
  ] as Array<[string, string]>) {
    it(`${nom} : il reste, et ce qu il appelle reste avec lui`, () => {
      const r = reste(deuxClasses(dansIle));
      expect(r).toContain('fun a()');
      expect(r).toContain('class Autre');
    });
  }

  for (const [nom, dansIle] of [
    ['membre prive marque, voisin de a', A + '    @Suppress("unused")\n    private fun garde() = 1\n'],
    ['regle detekt sur un membre prive', A + '    @Suppress("UnusedPrivateMember")\n    private fun garde() = 1\n'],
    ['compagnon anonyme marque', A + '    @Suppress("unused")\n    companion object {\n        fun garde() = 1\n    }\n'],
  ] as Array<[string, string]>) {
    it(`${nom} : la classe qui le porte reste, avec lui`, () => {
      // `a` et `Autre` ne s appellent qu entre eux et personne n a demande a
      // les garder : qu ils partent est juste. Ce qui ne doit pas partir,
      // c est `garde`, et donc la classe qui le contient.
      const r = reste(deuxClasses(dansIle));
      expect(r).toContain('class Ile');
      expect(r).toContain('fun garde()');
    });
  }

  it('un autre diagnostic ne garde rien', () => {
    expect(reste(deuxClasses('    @Suppress("MagicNumber")\n' + A))).not.toContain('class Ile');
  });

  it('une annotation dans un commentaire ne garde rien', () => {
    expect(reste(deuxClasses('    // @Suppress("unused")\n' + A))).not.toContain('class Ile');
  });

  it('au premier niveau, deja respecte', () => {
    const src = 'package com.x\n\n@Suppress("unused")\nfun a(): Int = b()\nfun b(): Int = a()\nfun vivante() = 3\n';
    expect(reste(src)).toContain('fun a()');
  });

  it('une demande de silence AILLEURS dans le fichier ne garde pas l ilot', () => {
    // Avant et apres les deux classes : seule compte une demande que la
    // classe CONTIENT.
    const src = 'package com.x\n\nclass Avant {\n    @Suppress("unused")\n    fun calme() = 0\n}\n'
      + deuxClasses(A).replace('package com.x\n\n', '')
      + 'class Apres {\n    @Suppress("unused")\n    fun calme() = 0\n}\n';
    const r = reste(src);
    expect(r).not.toContain('class Ile');
    expect(r).not.toContain('class Autre');
  });
});

/**
 * Une demande de silence sur une LOCALE ou un PARAMETRE ne garde pas l ilot.
 *
 * La regle de 1.42.327 comptait toute demande contenue dans l etendue d une
 * declaration. `@Suppress("unused") val tmp` dans un corps de fonction dit que
 * cette locale est inutilisee, et `fun b(@Suppress("unused") x: Int)` le dit du
 * parametre : rien sur la fonction qui les porte. Un ilot mort qui en
 * contenait une n etait plus jamais retire, alors que 1.42.326 le retirait.
 */
describe('une locale ou un parametre sous silence ne garde pas l ilot', () => {
  const partent = (src: string) => {
    const r = reste(src);
    return !r.includes('fun a()') && !r.includes('class Ile');
  };

  it('haut niveau, locale sous silence', () => {
    expect(partent('package com.x\n\nfun a(): Int = b()\nfun b(): Int {\n    @Suppress("unused") val tmp = 1\n    return a()\n}\nfun vivante() = 3\n')).toBe(true);
  });

  it('haut niveau, parametre sous silence', () => {
    expect(partent('package com.x\n\nfun a(): Int = b(0)\nfun b(@Suppress("unused") x: Int): Int = a()\nfun vivante() = 3\n')).toBe(true);
  });

  it('dans un membre de classe, locale sous silence', () => {
    expect(partent('package com.x\n\nclass Ile {\n    fun a(): Int {\n        @Suppress("unused") val tmp = 1\n        return Autre().b()\n    }\n}\nclass Autre {\n    fun b(): Int = Ile().a()\n}\nfun vivante() = 3\n')).toBe(true);
  });

  it('dans l initialiseur d une propriete', () => {
    expect(partent('package com.x\n\nclass Ile {\n    val a: Int = run {\n        @Suppress("unused") val tmp = 1\n        Autre().b()\n    }\n}\nclass Autre {\n    fun b(): Int = Ile().a\n}\nfun vivante() = 3\n')).toBe(true);
  });

  it('le membre de classe sous silence, lui, garde toujours sa classe', () => {
    const r = reste(deuxClasses(A + '    @Suppress("unused")\n    fun garde() = 1\n'));
    expect(r).toContain('fun garde()');
  });

  it('methode sans corps : son parametre sous silence ne garde pas l interface', () => {
    // Une methode d interface n a pas de corps pour ancrer son etendue : la
    // signature seule la delimite, et c est la qu est le parametre.
    const src = 'package com.x\n\ninterface Ile {\n    fun a(@Suppress("unused") x: Int): Int\n}\nclass Autre {\n    fun b(i: Ile): Int = i.a(1)\n}\nfun vivante() = 3\n';
    expect(reste(src)).not.toContain('interface Ile');
  });
});
