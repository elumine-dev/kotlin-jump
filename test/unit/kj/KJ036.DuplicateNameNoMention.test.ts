import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, explainSymbols } from '../../../src/providers/unusedSymbols';

/**
 * KJ-036 — la garde F3 relâchée quand personne ne nomme le doublon.
 *
 * F3 existe parce que la moisson est sans attribution : deux fichiers déclarent
 * `foo`, un token `foo` ailleurs peut désigner l'un ou l'autre, donc aucun des
 * deux n'est prouvable. Mais quand le corpus ne mentionne le nom QU'AUX sites
 * de déclaration, il n'y a plus rien à attribuer.
 *
 * Trouvé en auditant un vrai monorepo contre un autre outil de code mort :
 * deux copies de `setCheckedState`, deux de `setVisibleState`, deux variantes
 * de build de `watchForLeaks`. Six déclarations mortes, zéro appelant, et F3
 * seule les taisait toutes.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const j = (path: string, text: string) => ({ path, text });
const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedSymbols({ sources, testSourceSets: TEST_SETS, ...extra });
const names = (sources: any[]) => find(sources).map((f: any) => f.name);
const why = (sources: any[], name: string) =>
  explainSymbols({ sources, testSourceSets: TEST_SETS }).filter(e => e.name === name).map(e => e.outcome);

describe('les cas réels qui ont motivé la règle', () => {
  it('deux extensions jumelles sans appelant sont signalées toutes les deux', () => {
    // `setCheckedState`, déclaré dans deux modules, appelé par personne.
    const sources = [
      j('/w/ui-common/src/main/kotlin/binding/BindingAdapters.kt',
        'package binding\n\nimport android.widget.CompoundButton\n\n' +
        'fun CompoundButton.setCheckedState(isChecked: Boolean?) {\n    isChecked?.let { this.isChecked = it }\n}\n'),
      j('/w/core/ui/src/main/kotlin/extension/CompoundButtonExt.kt',
        'package extension\n\nimport android.widget.CompoundButton\n\n' +
        'fun CompoundButton.setCheckedState(isChecked: Boolean?) {\n    isChecked?.let { this.isChecked = it }\n}\n'),
    ];
    expect(names(sources)).toEqual(['setCheckedState', 'setCheckedState']);
  });

  it('et le `--why` dit `unreferenced`, plus `F3:duplicate-name`', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun View.setVisibleState(v: Boolean?) {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun View.setVisibleState(v: Boolean?) {\n}\n'),
    ];
    expect(why(sources, 'setVisibleState')).toEqual(['unreferenced', 'unreferenced']);
  });

  it('deux variantes de build du même stub, sans appelant, sont signalées', () => {
    // `watchForLeaks` : le crochet LeakCanary a été retiré côté appelant, les
    // deux stubs de variante sont restés.
    const sources = [
      j('/w/app/src/release/kotlin/ObjectWatcher.kt', 'package core\n\nfun watchForLeaks(obj: Any) {\n}\n'),
      j('/w/app/src/staging/kotlin/ObjectWatcher.kt', 'package core\n\nfun watchForLeaks(obj: Any) {\n}\n'),
    ];
    expect(names(sources)).toEqual(['watchForLeaks', 'watchForLeaks']);
  });

  it('un seul appelant suffit à faire retomber F3 sur TOUT le groupe', () => {
    // Le point de la garde : on ne sait pas laquelle des deux il appelle.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun watchForLeaks(obj: Any) {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun watchForLeaks(obj: Any) {\n}\n'),
      j('/w/c/src/main/kotlin/C.kt', 'package c\n\nimport a.watchForLeaks\n\nfun go() {\n    watchForLeaks(this)\n}\n'),
    ];
    expect(names(sources)).not.toContain('watchForLeaks');
    expect(why(sources, 'watchForLeaks')).toEqual(['F3:duplicate-name', 'F3:duplicate-name']);
  });
});

describe('ce que la règle refuse de faire', () => {
  it('une déclaration invisible du groupe bloque la règle', () => {
    // La troisième est dans un source set de test : elle n'est pas candidate,
    // donc ses propres mentions restent dans le sac sans qu'on puisse les
    // soustraire. Sans cette garde, `self` sous-compterait et le groupe
    // passerait pour muet alors qu'il ne l'est pas.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun helper() {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun helper() {\n}\n'),
      j('/w/c/src/test/kotlin/CTest.kt', 'package c\n\nfun helper() {\n}\n'),
    ];
    expect(names(sources)).not.toContain('helper');
  });

  it('un import aliasé neutralise le groupe : le nom peut ne jamais être écrit', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun helper() {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun helper() {\n}\n'),
      j('/w/c/src/main/kotlin/C.kt', 'package c\n\nimport a.helper as aide\n\nfun go() {\n    aide()\n}\n'),
    ];
    expect(names(sources)).not.toContain('helper');
  });

  it('une mention hors de sa propre étendue neutralise le groupe', () => {
    // `helper` est appelée dans son propre fichier, mais par une fonction que
    // rien n'appelle. La mention pourrait appartenir à l'un ou l'autre membre
    // du groupe, donc on ne tranche pas.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun helper() {\n}\n\nfun caller() {\n    helper()\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun helper() {\n}\n'),
    ];
    expect(names(sources)).not.toContain('helper');
  });

  it('une mention en XML compte comme partout ailleurs', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nclass Twin\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nclass Twin\n'),
      j('/w/a/src/main/AndroidManifest.xml', '<manifest><activity android:name=".Twin" /></manifest>'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('les autres gardes s’appliquent toujours au groupe rendu visible', () => {
    // La règle rend le groupe VISIBLE aux gardes suivantes, elle ne le
    // dispense de rien : ici F5 sur l'annotation, et F1 sur le private.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\n@Entity\nclass Twin\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nprivate class Twin\n'),
    ];
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'Twin').sort()).toEqual(['F1:private', 'F5:@Entity']);
  });

  it('un groupe de trois muet est signalé en entier', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun triplet() {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun triplet() {\n}\n'),
      j('/w/c/src/main/kotlin/C.kt', 'package c\n\nfun triplet() {\n}\n'),
    ];
    expect(names(sources)).toEqual(['triplet', 'triplet', 'triplet']);
  });

  it('le verdict testOnly reste distinct pour un groupe muet en production', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nfun helper() {\n}\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nfun helper() {\n}\n'),
      j('/w/a/src/test/kotlin/ATest.kt', 'package a\n\nimport a.helper\n\nfun t() {\n    helper()\n}\n'),
    ];
    expect(find(sources).filter((f: any) => f.name === 'helper').map((f: any) => f.verdict))
      .toEqual(['testOnly', 'testOnly']);
  });

  it('une propriété dupliquée voit ses accesseurs Java comptés', () => {
    // H9 : du Java, `val timeout` se lit `AKt.getTimeout()`. Le nom nu
    // n'apparaît nulle part, donc sans H9 le groupe passerait pour muet.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nval timeout = 30\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nval timeout = 60\n'),
      j('/w/c/src/main/java/C.java', 'package c;\n\nclass C {\n    int t = AKt.getTimeout();\n}\n'),
    ];
    expect(names(sources)).not.toContain('timeout');
  });
});

describe('la symétrie du compte : imports d’un côté comme de l’autre', () => {
  it('un import dans le fichier déclarant ne fabrique pas de trouvaille', () => {
    // `selfInFile` comptait les lignes d'import alors que le sac les jette.
    // L'écart sous-comptait le résidu, ce qui est la direction qui FABRIQUE
    // une trouvaille : ici la mention de C serait annulée par l'import de A.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nimport z.Solo\n\nclass Solo2(val s: Solo)\n'),
      j('/w/c/src/main/kotlin/C.kt', 'package c\n\nimport a.Solo2\n\nval x = Solo2(null)\n'),
    ];
    expect(names(sources)).not.toContain('Solo2');
  });
});
