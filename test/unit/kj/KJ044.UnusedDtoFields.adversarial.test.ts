import { describe, it, expect } from 'vitest';
import { findUnusedDtoFields } from '../../../src/providers/unusedDtoFields';

/**
 * KJ-044 — les champs de DTO désérialisés mais jamais lus.
 *
 * Rouvre la population que KJ-042 exclut (M7, propriétés de constructeur
 * primaire) sous conditions plus strictes : classes visiblement contrats de
 * fil, et aucune destructuration possible dans le corpus.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  findUnusedDtoFields({ sources, testSourceSets: TEST_SETS, ...extra })
    .map(x => `${x.className}.${x.name}`);

// Les annotations sur leur propre ligne : la forme du corpus réel. Une
// annotation sur la même ligne que `val` masque le paramètre au parser,
// faux négatif connu, direction sûre.
const dto = f(`${MAIN}/ConfigDO.kt`, [
  'package com.x',
  '',
  '@Serializable',
  'data class ConfigDO(',
  '    @SerialName("cache_ttl")',
  '    val cacheTtl: Long,',
  '    @SerialName("api_url")',
  '    val apiUrl: String,',
  ')',
].join('\n'));

describe('le cas de base', () => {
  it('un champ que rien ne lit est signalé, le champ lu non', () => {
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(c: ConfigDO) = c.apiUrl\n');
    expect(names([dto, reader])).toEqual(['ConfigDO.cacheTtl']);
  });

  it('une classe sans marqueur de sérialisation ni suffixe n’est pas un DTO', () => {
    const plain = f(`${MAIN}/Point.kt`, 'package com.x\n\ndata class Point(val x: Int)\n');
    expect(names([plain])).toEqual([]);
  });

  it('le suffixe DO suffit à qualifier', () => {
    const plain = f(`${MAIN}/UserDO.kt`, 'package com.x\n\ndata class UserDO(val ghost: String)\n');
    expect(names([plain])).toEqual(['UserDO.ghost']);
  });

  it('copy(champ = …) épelle le nom : vivant', () => {
    const reader = f(`${MAIN}/Use.kt`,
      'package com.x\n\nfun go(c: ConfigDO) = c.copy(cacheTtl = 1).apiUrl\n');
    expect(names([dto, reader])).toEqual([]);
  });
});

describe('les gardes', () => {
  it('D1 : un fichier qui mentionne la classe ET destructure fait taire la classe', () => {
    // `val (a, b) = dto` lit les champs sans jamais les épeler.
    const destructurer = f(`${MAIN}/Use.kt`, [
      'package com.x',
      '',
      'fun go(c: ConfigDO) {',
      '    val (ttl, url) = c',
      '    println(url)',
      '}',
    ].join('\n'));
    expect(names([dto, destructurer])).toEqual([]);
  });

  it('D1 : l’arité de la destructuration borne les champs qu’elle peut lire', () => {
    // `val (a, b) = t` n'appelle que component1 et component2 : le champ en
    // position 3 reste hors d'atteinte, son verdict tient.
    const triple = f(`${MAIN}/TripleDO.kt`, [
      'package com.x',
      '',
      'data class TripleDO(',
      '    val first: Long,',
      '    val second: String,',
      '    val third: String,',
      ')',
    ].join('\n'));
    const destructurer = f(`${MAIN}/Use.kt`, [
      'package com.x',
      '',
      'fun go(t: TripleDO) {',
      '    val (a, b) = t',
      '    println(a + b)',
      '}',
    ].join('\n'));
    expect(names([triple, destructurer])).toEqual(['TripleDO.third']);
  });

  it('D1 : une destructuration d’autre chose dans le même fichier ne condamne que les positions atteignables', () => {
    // Co-occurrence fortuite : le fichier mentionne la classe (paramètre) et
    // destructure un Pair sans rapport. Position 3 échappe à la garde.
    const triple = f(`${MAIN}/TripleDO.kt`, [
      'package com.x',
      '',
      'data class TripleDO(',
      '    val first: Long,',
      '    val second: String,',
      '    val third: String,',
      ')',
    ].join('\n'));
    const bystander = f(`${MAIN}/Use.kt`, [
      'package com.x',
      '',
      'fun go(t: TripleDO): TripleDO {',
      '    val (x, y) = makePair()',
      '    println(x + y)',
      '    return t',
      '}',
    ].join('\n'));
    expect(names([triple, bystander])).toEqual(['TripleDO.third']);
  });

  it('D1 : la destructuration en paramètre de lambda compte aussi', () => {
    // `list.map { (a, b, c) -> … }` lit component1..3 sans aucun `val (`.
    const triple = f(`${MAIN}/TripleDO.kt`, [
      'package com.x',
      '',
      'data class TripleDO(',
      '    val first: Long,',
      '    val second: String,',
      '    val third: String,',
      ')',
    ].join('\n'));
    const lambda = f(`${MAIN}/Use.kt`, [
      'package com.x',
      '',
      'fun go(list: List<TripleDO>) = list.map { (a, b, c) -> a }',
    ].join('\n'));
    expect(names([triple, lambda])).toEqual([]);
  });

  it('D5 : une construction à la main retire le correctif, pas le verdict', () => {
    const builder = f(`${MAIN}/Fixture.kt`,
      'package com.x\n\nfun sample() = ConfigDO(1L, "https://x")\n');
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(c: ConfigDO) = c.apiUrl\n');
    const found = findUnusedDtoFields({ sources: [dto, builder, reader], testSourceSets: TEST_SETS });
    expect(found.map(x => x.name)).toEqual(['cacheTtl']);
    expect(found[0].removeStart).toBe(-1);
  });

  it('un fichier généré est hors périmètre', () => {
    const generated = f(`${MAIN}/Gen.kt`,
      '// auto generated by OpenAPI Generator. Do not edit.\npackage com.x\n\n@Serializable\ndata class GenDO(val unused: String)\n');
    expect(names([generated])).toEqual([]);
  });

  it('une annotation inconnue sur le champ le protège', () => {
    const roomish = f(`${MAIN}/RowDO.kt`,
      'package com.x\n\ndata class RowDO(@PrimaryKey val id: Long)\n');
    expect(names([roomish])).toEqual([]);
  });

  it('un homonyme dans un autre DTO neutralise les deux', () => {
    const other = f(`${MAIN}/OtherDO.kt`, 'package com.x\n\ndata class OtherDO(val ghost: String)\n');
    const one = f(`${MAIN}/UserDO.kt`, 'package com.x\n\ndata class UserDO(val ghost: String)\n');
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(u: UserDO) = u.ghost\n');
    // `u.ghost` pourrait lire l'un ou l'autre : les deux vivants.
    expect(names([other, one, reader])).toEqual([]);
  });

  it('une lecture depuis un test donne le verdict testOnly', () => {
    const test = f('/w/app/src/test/kotlin/com/x/T.kt',
      'package com.x\n\nfun t(c: ConfigDO) = c.cacheTtl\n');
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(c: ConfigDO) = c.apiUrl\n');
    const found = findUnusedDtoFields({ sources: [dto, reader, test], testSourceSets: TEST_SETS });
    expect(found.map(x => x.verdict)).toEqual(['testOnly']);
  });

  it('une expression de data binding lit par le nom : vivant', () => {
    const layout = f('/w/app/src/main/res/layout/a.xml', '<TextView android:text="@{cfg.cacheTtl}" />');
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(c: ConfigDO) = c.apiUrl\n');
    expect(names([dto, reader, layout])).toEqual([]);
  });

  it('un corpus tronqué ne produit rien', () => {
    expect(names([dto])).toHaveLength(2);
    expect(names([dto], { truncated: true })).toEqual([]);
  });
});
