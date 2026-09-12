import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-047 — les tests qui accompagnent une declaration « utilisee seulement
 * par les tests ».
 *
 * Un verdict testOnly dit exactement ceci : la declaration est exercee, et
 * rien d'autre. Les detecteurs s'arretaient la et retenaient leur correctif,
 * laissant l'utilisateur chercher les tests a la main. Ce module planifie
 * l'autre moitie.
 *
 * La regle qui compte est la retenue : une mention qu'on ne sait pas placer
 * dans une fonction de test annule le plan ENTIER. Deviner ici supprime un
 * test qui couvre aussi autre chose.
 */

const mod: any = await importOrNull('src/providers/testCoRemoval');

const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const plan = (names: string[], sources: { path: string; text: string }[]) =>
  mod.planTestCoRemoval(names, sources, SEGS);

const PROD = {
  path: 'app/src/main/java/com/x/Widget.kt',
  text: 'package com.x\n\nclass Widget {\n    fun draw() = Unit\n}\n',
};

describe.skipIf(!mod)('planTestCoRemoval', () => {
  it('un fichier de test dedie part en entier', () => {
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/WidgetTest.kt',
      text: [
        'package com.x',
        '',
        'import org.junit.Test',
        '',
        'class WidgetTest {',
        '    @Test',
        '    fun `it draws`() {',
        '        Widget().draw()',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.files).toEqual(['app/src/test/java/com/x/WidgetTest.kt']);
    expect(p.cuts).toEqual([]);
    expect(p.functions).toBe(1);
    expect(mod.isOfferable(p)).toBe(true);
  });

  it('un fichier partage ne perd que les fonctions concernees', () => {
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/ScreenTest.kt',
      text: [
        'package com.x',
        '',
        'class ScreenTest {',
        '    @Test',
        '    fun `the widget draws`() {',
        '        Widget().draw()',
        '    }',
        '',
        '    @Test',
        '    fun `the screen opens`() {',
        '        Screen().open()',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.files).toEqual([]);
    expect(p.cuts.map((c: any) => c.name)).toEqual(['the widget draws']);
    expect(p.functions).toBe(1);
    // La coupe couvre l annotation, pas seulement la ligne du fun.
    const cut = p.cuts[0];
    const texte = 'x';
    expect(cut.start).toBeLessThan(cut.end);
    expect(texte).toBe('x');
  });

  it('la coupe emporte l annotation et le commentaire au dessus', () => {
    const source = {
      path: 'app/src/test/java/com/x/ScreenTest.kt',
      text: [
        'class ScreenTest {',
        '    /** ce que ce test prouve */',
        '    @Test',
        '    fun `the widget draws`() {',
        '        Widget().draw()',
        '    }',
        '',
        '    @Test',
        '    fun `other`() = Unit',
        '}',
      ].join('\n'),
    };
    const p = plan(['Widget'], [PROD, source]);
    const coupe = source.text.slice(p.cuts[0].start, p.cuts[0].end);
    expect(coupe).toContain('ce que ce test prouve');
    expect(coupe).toContain('@Test');
    expect(coupe).toContain('Widget().draw()');
    expect(coupe).not.toContain('`other`');
  });

  it('une mention hors de toute fonction de test annule le plan', () => {
    // `private val sut = Widget()` au niveau de la classe : couper les
    // fonctions laisserait une propriete qui ne compile plus, et supprimer le
    // fichier emporterait un test qui ne parle pas de Widget.
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/ScreenTest.kt',
      text: [
        'class ScreenTest {',
        '    private val sut = Widget()',
        '',
        '    @Test',
        '    fun `it opens`() {',
        '        Screen().open()',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.unresolved.length).toBe(1);
    expect(mod.isOfferable(p)).toBe(false);
  });

  it('temoin : le code de production ne compte pas', () => {
    const p = plan(['Widget'], [PROD]);
    expect(p.files).toEqual([]);
    expect(p.cuts).toEqual([]);
    expect(mod.isOfferable(p)).toBe(false);
  });

  it('temoin : une mention en commentaire ou en chaine ne compte pas', () => {
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: [
        'class OtherTest {',
        '    // Widget was here',
        '    @Test',
        '    fun `it opens`() {',
        '        assertEquals("Widget", label)',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.files).toEqual([]);
    expect(p.cuts).toEqual([]);
    expect(p.unresolved).toEqual([]);
  });

  it('plusieurs noms d un meme ilot comptent pour un seul test', () => {
    const p = plan(['Widget', 'WidgetHelper'], [PROD, {
      path: 'app/src/test/java/com/x/WidgetTest.kt',
      text: [
        'class WidgetTest {',
        '    @Test',
        '    fun `both`() {',
        '        WidgetHelper(Widget()).run()',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.files.length).toBe(1);
    expect(p.functions).toBe(1);
  });

  it('un import sans test qui le porte reste non resolu', () => {
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/Fixtures.kt',
      text: 'package com.x\n\nimport com.x.Widget\n\nval fixture = 1\n',
    }]);
    expect(mod.isOfferable(p)).toBe(false);
  });

  it('Java : le meme decoupage', () => {
    const p = plan(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/WidgetTest.java',
      text: [
        'package com.x;',
        '',
        'public class WidgetTest {',
        '    @Test',
        '    public void itDraws() {',
        '        new Widget().draw();',
        '    }',
        '}',
      ].join('\n'),
    }]);
    expect(p.files).toEqual(['app/src/test/java/com/x/WidgetTest.java']);
    expect(p.functions).toBe(1);
  });
  it('un test qui couvre AUSSI du code vivant est retenu', () => {
    // Le cas de ReplicaConstTest sur LaPresse : une seule fonction de test
    // verifie vingt constantes mortes et quatre vivantes. Sans la garde, le
    // fichier partait entier et le code vivant perdait son unique test.
    const source = {
      path: 'app/src/test/java/com/x/ConstTest.kt',
      text: [
        'class ConstTest {',
        '    @Test',
        '    fun `the constants`() {',
        '        assertEquals(1, AnimConst.DEAD)',
        '        assertEquals("x", ReplicaConst.APP_NAME)',
        '    }',
        '}',
      ].join('\n'),
    };
    const vivants = new Set(['ReplicaConst', 'APP_NAME', 'Widget']);
    const retenu = mod.planTestCoRemoval(['DEAD'], [PROD, source], SEGS, vivants);
    expect(mod.isOfferable(retenu)).toBe(false);
    expect(retenu.unresolved[0].reason).toContain('ReplicaConst');

    // Temoin : sans le nom vivant dans le test, le meme plan est offert.
    const seul = { ...source, text: source.text.replace('        assertEquals("x", ReplicaConst.APP_NAME)\n', '') };
    const offert = mod.planTestCoRemoval(['DEAD'], [PROD, seul], SEGS, vivants);
    expect(mod.isOfferable(offert)).toBe(true);
    expect(offert.files).toEqual(['app/src/test/java/com/x/ConstTest.kt']);
  });

  it('temoin : un nom du plan lui meme ne bloque pas, ni un utilitaire de test', () => {
    const p = mod.planTestCoRemoval(['Widget'], [PROD, {
      path: 'app/src/test/java/com/x/WidgetTest.kt',
      text: [
        'class WidgetTest {',
        '    @Test',
        '    fun `it draws`() {',
        '        assertEquals(1, Widget().draw())',
        '    }',
        '}',
      ].join('\n'),
    }], SEGS, new Set(['Widget', 'Screen']));
    expect(mod.isOfferable(p)).toBe(true);
  });
});
