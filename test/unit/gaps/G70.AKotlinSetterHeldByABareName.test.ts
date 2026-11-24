import { describe, it, expect } from 'vitest';
import { findUnusedContracts } from '../../../src/providers/unusedContracts';

/**
 * G70 — un `setX()` Kotlin sans appelant, tenu par une propriete nommee `x`.
 *
 * Vu sur le projet de reference en relisant vingt coupes : un `setX()` de
 * contrat n avait aucun appelant, et ne sortait que le jour ou la propriete
 * privee `x` voisine etait retiree.
 *
 * La famille des contrats (G44) exigeait que le nom nu `x` soit absent de tout
 * le corpus, au titre de la syntaxe de propriete de Kotlin et du data binding.
 * Or cette syntaxe n atteint qu un accesseur JAVA : entre deux fichiers
 * Kotlin, un appel ecrit toujours `setX()`, et un `x` nu est une variable.
 * Reste le data binding, qui vit dans le XML. La famille des membres le sait
 * deja (H9 inverse).
 *
 * Quand le contrat et toutes ses implementations sont en `.kt`, le nom nu ne
 * se cherche donc que dans les sources XML. Des qu un fichier Java declare ou
 * implemente le contrat, la regle large reste.
 *
 * Chaque cas a son jumeau, qui ne differe que par le nom de la propriete :
 * une fixture mal formee ne peut pas passer pour le defaut.
 */

const SEGS = ['/src/test/'];
type Source = { path: string; text: string };
const src = (name: string, ...lines: string[]): Source => ({ path: `/w/app/src/main/java/app/${name}`, text: lines.join('\n') + '\n' });

const PROBE = src('Probe.kt',
  'package app',
  '',
  'fun main() {',
  '    val p = PrefsImpl()',
  '    p.removeShownTimestamp()',
  '    println(p.has())',
  '}');

const CONTRAT_KT = src('Prefs.kt',
  'package app',
  '',
  'interface Prefs {',
  '    fun removeShownTimestamp()',
  '    fun setShownTimestamp()',
  '    fun canaryGone()',
  '}');

const implKt = (propriete: string) => src('PrefsImpl.kt',
  'package app',
  '',
  'class PrefsImpl : Prefs {',
  '    override fun removeShownTimestamp() {',
  '        println("r")',
  '    }',
  '',
  '    override fun setShownTimestamp() {',
  '        println("s")',
  '    }',
  '',
  '    override fun canaryGone() {',
  '        println("c")',
  '    }',
  '',
  '    fun has(): Boolean {',
  `        val t = ${propriete}`,
  '        return t > 0',
  '    }',
  '',
  `    private val ${propriete}: Long = 3`,
  '}');

const CONTRAT_JAVA = src('Prefs.java',
  'package app;',
  '',
  'public interface Prefs {',
  '\tvoid removeShownTimestamp();',
  '',
  '\tvoid setShownTimestamp();',
  '',
  '\tvoid canaryGone();',
  '}');

const implJava = (propriete: string) => src('PrefsImpl.java',
  'package app;',
  '',
  'public class PrefsImpl implements Prefs {',
  `\tprivate final long ${propriete} = 3;`,
  '',
  '\t@Override',
  '\tpublic void removeShownTimestamp() {',
  '\t\tSystem.out.println("r");',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void setShownTimestamp() {',
  '\t\tSystem.out.println("s");',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void canaryGone() {',
  '\t\tSystem.out.println("c");',
  '\t}',
  '',
  '\tpublic boolean has() {',
  `\t\treturn ${propriete} > 0;`,
  '\t}',
  '}');

const layout = (expression: string): Source => ({
  path: '/w/app/src/main/res/layout/prefs.xml',
  text: [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<layout xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <data>',
    '        <variable name="prefs" type="app.PrefsImpl" />',
    '    </data>',
    `    <TextView android:text="${expression}" />`,
    '</layout>', '',
  ].join('\n'),
});

const trouves = (...sources: Source[]) =>
  findUnusedContracts({ sources, testSourceSets: SEGS }).map(c => c.name);

describe('G70, temoin : le setter sort quand la propriete porte un autre nom', () => {
  it('contrat et implementation en Kotlin', () => {
    expect(trouves(CONTRAT_KT, implKt('shownAt'), PROBE)).toEqual(['canaryGone', 'setShownTimestamp']);
  });
});

describe('G70, entre fichiers Kotlin, le nom nu n est pas un appel', () => {
  it('le setter sort aussi quand la propriete porte son nom nu', () => {
    expect(trouves(CONTRAT_KT, implKt('shownTimestamp'), PROBE)).toEqual(['canaryGone', 'setShownTimestamp']);
  });
});

describe('G70, gardes : ce qui tient encore le setter', () => {
  it('une expression de data binding qui lit le nom nu', () => {
    expect(trouves(CONTRAT_KT, implKt('shownAt'), PROBE, layout('@{prefs.shownAt}'))).toEqual(['canaryGone', 'setShownTimestamp']);
    expect(trouves(CONTRAT_KT, implKt('shownAt'), PROBE, layout('@={prefs.shownTimestamp}'))).toEqual(['canaryGone']);
  });

  it('une implementation Java : la regle large reste', () => {
    expect(trouves(CONTRAT_KT, implJava('shownAt'), PROBE)).toEqual(['canaryGone', 'setShownTimestamp']);
    expect(trouves(CONTRAT_KT, implJava('shownTimestamp'), PROBE)).toEqual(['canaryGone']);
  });

  it('un contrat declare en Java : la regle large reste', () => {
    expect(trouves(CONTRAT_JAVA, implKt('shownAt'), PROBE)).toEqual(['canaryGone', 'setShownTimestamp']);
    expect(trouves(CONTRAT_JAVA, implKt('shownTimestamp'), PROBE)).toEqual(['canaryGone']);
  });
});
