import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Une entree d'enum part avec SES annotations.
 *
 * La coupe commencait au nom de l'entree. Une entree morte `@Deprecated OLD,`
 * laissait donc son `@Deprecated` sur place, et Kotlin comme Java rattachent
 * une annotation en tete a la declaration qui SUIT : l'entree suivante, bien
 * vivante, heritait de la depreciation. javac le dit noir sur blanc.
 *
 * Et quand l'entree morte est la DERNIERE et que la liste porte une virgule
 * finale, l'annotation se retrouve seule devant `}` : le fichier ne parse
 * plus du tout. C'est une casse de build sur un correctif presente comme sur.
 */

const mod: any = await importOrNull('src/providers/unusedEnumEntries');

const coupe = (chemin: string, texte: string, nom: string, ...autres: { path: string; text: string }[]) => {
  const f = (mod.findUnusedEnumEntries({
    sources: [{ path: chemin, text: texte }, ...autres], testSourceSets: [],
  }) as any[]).find(x => x.name === nom);
  if (!f || f.removeStart < 0) return undefined;
  return { coupe: texte.slice(f.removeStart, f.removeEnd), reste: texte.slice(0, f.removeStart) + texte.slice(f.removeEnd) };
};

const USE_JAVA = { path: 'p/Use.java', text: 'package p;\nclass Use { Object a = Flag.NEW; Object b = Flag2.HIGH; Object c = Plain.KEEP; }\n' };
const USE_KT = { path: 'p/UseKt.kt', text: 'package p\nval v = Level.HIGH\nval w = Level2.HIGH2\n' };

describe.skipIf(!mod)('une entree morte emporte ses annotations', () => {
  it('derniere entree annotee avec virgule finale : le fichier parse encore', () => {
    const r = coupe('p/Flag2.java', 'package p;\n\npublic enum Flag2 {\n\tHIGH,\n\t@Deprecated LOW,\n}\n', 'LOW', USE_JAVA);
    expect(r).toBeDefined();
    expect(r!.coupe).toContain('@Deprecated');
    expect(r!.reste).not.toContain('@Deprecated');
  });

  it('entree annotee au milieu : la voisine vivante n herite de rien', () => {
    const r = coupe('p/Flag.java', 'package p;\n\npublic enum Flag {\n\t@Deprecated OLD,\n\tNEW;\n}\n', 'OLD', USE_JAVA);
    expect(r).toBeDefined();
    expect(r!.coupe).toContain('@Deprecated');
    expect(r!.reste).not.toContain('@Deprecated');
    expect(r!.reste).toContain('NEW;');
  });

  it('annotation sur sa propre ligne, arguments compris', () => {
    const r = coupe('p/Level.kt', 'package p\n\nenum class Level {\n    @Deprecated("use HIGH")\n    LOW,\n    HIGH\n}\n', 'LOW', USE_KT);
    expect(r).toBeDefined();
    expect(r!.reste).toBe('package p\n\nenum class Level {\n    HIGH\n}\n');
  });

  it('annotation a arguments imbriques', () => {
    const r = coupe('p/Level2.kt', 'package p\n\nenum class Level2 {\n    @Suppress("a", Foo::class)\n    LOW2,\n    HIGH2\n}\n', 'LOW2', USE_KT);
    expect(r).toBeDefined();
    expect(r!.reste).toBe('package p\n\nenum class Level2 {\n    HIGH2\n}\n');
  });

  it('temoin : une entree annotee APRES une voisine sur la meme ligne ne recule pas trop', () => {
    const t = 'package p\n\nenum class Ordre {\n    ASC, @Deprecated("x") DESC\n}\n';
    const r = coupe('p/Ordre.kt', t, 'DESC', { path: 'p/UseO.kt', text: 'package p\nval o = Ordre.ASC\n' });
    if (r) {
      expect(r.coupe).not.toContain('ASC');
      expect(r.reste).toContain('ASC');
    }
  });

  it('temoin : une entree sans annotation coupe comme avant', () => {
    const r = coupe('p/Plain.java', 'package p;\n\npublic enum Plain {\n\tKEEP,\n\tGONE;\n}\n', 'GONE', USE_JAVA);
    expect(r).toBeDefined();
    // La derniere entree emporte la virgule qui la precede : comportement
    // d'origine, que ce correctif ne doit pas deranger.
    expect(r!.coupe).toBe(',\n\tGONE');
    expect(r!.reste).toContain('KEEP');
  });
});
