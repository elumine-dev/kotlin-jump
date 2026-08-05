import { describe, it, expect } from 'vitest';
import {
  fileHeader,
  fileOptsOut,
  UNUSED_DECLARATION,
  UNUSED_PARAMETER,
} from '../../../src/util/kotlinScan';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';
import { findUnusedParameters } from '../../../src/providers/UnusedParameterProvider';
import { findUnusedLocals } from '../../../src/providers/UnusedLocalProvider';
import { findUnusedDeclarations } from '../../../src/providers/UnusedDeclarationProvider';
import { findWriteOnlyVariables } from '../../../src/providers/WriteOnlyProvider';

/**
 * `@file:Suppress` ne compte qu'au-dessus de `package`.
 *
 * La regex tournait sur le texte brut du fichier entier. Une mention dans un
 * KDoc, une chaîne ou un TODO commenté éteignait le détecteur pour tout le
 * fichier, sans que rien ne le signale. Et la forme entre crochets, valide en
 * Kotlin, échappait au motif : un fichier que son auteur avait marqué
 * continuait d'être rapporté.
 *
 * Le correctif qui vient à l'esprit, passer le texte à sanitizeForUsageScan
 * avant la regex, est un générateur de faux positifs : cette fonction blanchit
 * les chaînes, et les arguments de l'annotation SONT une chaîne. Toutes les
 * suppressions légitimes cesseraient de fonctionner. D'où la coupe à `package`.
 */

const DECL = UNUSED_DECLARATION;

describe('fileOptsOut : ce qui fait taire', () => {
  it('la forme simple en en-tête', () => {
    expect(fileOptsOut('@file:Suppress("unused")\npackage a\n\nclass Ghost\n', DECL)).toBe(true);
  });

  it('la forme entre crochets, Suppress en second', () => {
    expect(fileOptsOut('@file:[JvmName("X") Suppress("unused")]\npackage a\n', DECL)).toBe(true);
  });

  it('la forme entre crochets, Suppress en premier', () => {
    expect(fileOptsOut('@file:[Suppress("unused") JvmName("X")]\npackage a\n', DECL)).toBe(true);
  });

  it('la seconde de deux annotations @file:', () => {
    expect(fileOptsOut('@file:JvmName("X")\n@file:Suppress("unused")\npackage a\n', DECL)).toBe(true);
  });

  it('un nom parmi plusieurs arguments', () => {
    expect(fileOptsOut('@file:Suppress("unused", "TooManyFunctions")\n\npackage a\n', DECL)).toBe(true);
  });

  it('un fichier sans package, où la coupe de repli s’applique', () => {
    expect(fileOptsOut('@file:Suppress("unused")\nclass A(dead: Int) { val x = 1 }\n', DECL)).toBe(true);
  });

  it('un « // package » commenté avant l’annotation ne coupe pas trop tôt', () => {
    // Le blanchiment des commentaires passe AVANT la coupe, sinon ce
    // commentaire terminerait l'en-tête et l'annotation tomberait dehors.
    expect(fileOptsOut('// package foo\n@file:Suppress("unused")\npackage a\n', DECL)).toBe(true);
  });

  it('un bloc commentaire ouvert avant et refermé après un faux package', () => {
    expect(fileOptsOut('/*\npackage a\n*/\n@file:Suppress("unused")\npackage b\n', DECL)).toBe(true);
  });
});

describe('fileOptsOut : ce qui ne fait plus taire', () => {
  it('une mention dans un KDoc au-dessus de package', () => {
    expect(fileOptsOut('/** @file:Suppress("unused") */\npackage a\n\nclass Ghost\n', DECL)).toBe(false);
  });

  it('une mention dans un TODO commenté', () => {
    expect(fileOptsOut('// remove this: @file:Suppress("unused")\npackage a\n', DECL)).toBe(false);
  });

  it('une mention dans une chaîne du corps', () => {
    expect(fileOptsOut('package a\nval s = "@file:Suppress(\\"unused\\")"\n', DECL)).toBe(false);
  });

  it('une mention dans un littéral brut', () => {
    expect(fileOptsOut('package a\nval s = """@file:Suppress("unused")"""\n', DECL)).toBe(false);
  });

  it('une mention dans un KDoc sous les import', () => {
    expect(fileOptsOut('package a\nimport b.C\n/** @file:Suppress("unused") */\nclass Ghost\n', DECL)).toBe(false);
  });

  it('une autre annotation de fichier', () => {
    expect(fileOptsOut('@file:JvmName("X")\npackage a\n', DECL)).toBe(false);
  });

  it('un fichier sans @file du tout', () => {
    expect(fileOptsOut('package a\nclass Ghost\n', DECL)).toBe(false);
  });
});

describe('fileOptsOut : ce que la relecture adversariale a trouvé', () => {
  it('un commentaire de bloc IMBRIQUÉ est entièrement un commentaire', () => {
    // Kotlin imbrique les blocs, contrairement à C. S'arrêter au premier `*/`
    // rendait l'annotation au code appelant, exactement le défaut corrigé ici.
    expect(fileOptsOut('/* /* */ @file:Suppress("unused") */\npackage a\n', DECL)).toBe(false);
    expect(fileOptsOut('/* a /* b /* c */ d */ @file:Suppress("unused") */\npackage a\n', DECL)).toBe(false);
  });

  it('« packageName » et « importantFlag » sont des identifiants, pas le début du corps', () => {
    expect(fileOptsOut('packageName = 1\n@file:Suppress("unused")\npackage a\n', DECL)).toBe(true);
    expect(fileOptsOut('importantFlag = 1\n@file:Suppress("unused")\npackage a\n', DECL)).toBe(true);
  });

  it('la forme qualifiée @file:kotlin.Suppress compte', () => {
    expect(fileOptsOut('@file:kotlin.Suppress("unused")\npackage a\n', DECL)).toBe(true);
    expect(fileOptsOut('@file:[JvmName("X") kotlin.Suppress("unused")]\npackage a\n', DECL)).toBe(true);
  });

  it('une licence de 60 lignes ne coûte pas son opt-out au fichier', () => {
    // Le plafond de lignes ne vaut que pour un fichier SANS package ni import.
    // L'appliquer pendant le parcours coupait l'en-tête sous une longue licence.
    const src = '// licence\n'.repeat(60) + '@file:Suppress("unused")\npackage a\n';
    expect(fileOptsOut(src, DECL)).toBe(true);
  });

  it('un fichier sans package ne fait pas lire son corps entier', () => {
    const src = '@file:JvmName("X")\n' + 'val a = 1\n'.repeat(80) + 'val s = "@file:Suppress(\\"unused\\")"\n';
    expect(fileOptsOut(src, DECL)).toBe(false);
  });
});

describe('fileOptsOut : la famille nommée compte toujours', () => {
  it('UNUSED_PARAMETER en en-tête ne cache pas le code mort', () => {
    const src = '@file:Suppress("UNUSED_PARAMETER")\n\npackage a\n';
    expect(fileOptsOut(src, UNUSED_DECLARATION)).toBe(false);
    expect(fileOptsOut(src, UNUSED_PARAMETER)).toBe(true);
  });
});

describe('fileHeader', () => {
  it('coupe au premier package', () => {
    expect(fileHeader('@file:JvmName("X")\npackage a\n\nclass C\n')).toBe('@file:JvmName("X")\n');
  });

  it('coupe au premier import quand il n’y a pas de package', () => {
    expect(fileHeader('@file:JvmName("X")\nimport b.C\nclass C\n')).toBe('@file:JvmName("X")\n');
  });

  it('préserve les longueurs, donc les décalages d’octets', () => {
    const text = '/** @file:Suppress("unused") */\npackage a\n';
    const header = fileHeader(text);
    expect(header).toHaveLength(32);
    expect(header.trim()).toBe('');
  });
});

describe('le câblage tient dans les quatre familles', () => {
  const kdoc = (body: string) => `/** @file:Suppress("unused") */\npackage a\n\n${body}`;
  const marked = (body: string) => `@file:[JvmName("X") Suppress("unused")]\npackage a\n\n${body}`;

  it('KJ-032, déclarations de premier niveau', () => {
    const at = (text: string) => [{ path: '/w/a/src/main/kotlin/A.kt', text }];
    const run = (text: string) =>
      findUnusedSymbols({ sources: at(text), testSourceSets: ['test/kotlin'] }).map(f => f.name);
    expect(run(kdoc('class Ghost\n'))).toEqual(['Ghost']);
    expect(run(marked('class Ghost\n'))).toEqual([]);
  });

  it('KJ-025, paramètres', () => {
    const body = 'class A(dead: Int) {\n  val x = 1\n}\n';
    expect(findUnusedParameters(kdoc(body))).toHaveLength(1);
    expect(findUnusedParameters(marked(body))).toHaveLength(0);
  });

  it('KJ-026, déclarations privées', () => {
    expect(findUnusedDeclarations(kdoc('private fun gone() = 1\n'))).toHaveLength(1);
    expect(findUnusedDeclarations(marked('private fun gone() = 1\n'))).toHaveLength(0);
  });

  it('KJ-027, variables locales', () => {
    const body = 'fun f() {\n  val dead = 1\n  println(2)\n}\n';
    expect(findUnusedLocals(kdoc(body))).toHaveLength(1);
    expect(findUnusedLocals(marked(body))).toHaveLength(0);
  });

  it('KJ-028, variables seulement écrites', () => {
    const body = 'class C {\n  private var n = 0\n  fun a() { n = 1 }\n}\n';
    expect(findWriteOnlyVariables(kdoc(body))).toHaveLength(1);
    expect(findWriteOnlyVariables(marked(body))).toHaveLength(0);
  });
});
