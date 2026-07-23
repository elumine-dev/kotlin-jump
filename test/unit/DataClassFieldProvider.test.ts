/**
 * DataClassFieldProvider — champs de corps de data class exclus de equals/copy
 *
 * Vecteurs :
 *   DF-1  Champ de corps de data class → flaggé ; param du ctor → non
 *   DF-2  Parser : isPrimaryCtorParam propagé jusqu'à l'index
 *   DF-3  Classe normale avec champ de corps → non flaggé
 *   DF-4  Companion object dans la data class → ses vals non flaggés
 *   DF-5  var de corps aussi flaggé ; const val exclu
 *   DF-6  Data class imbriquée dans une classe normale → flaggée quand même
 *   DF-7  Classe normale imbriquée dans une data class → ses champs non flaggés
 *   DF-8  Plusieurs data classes dans un fichier → chacune ses propres champs
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { bodyFieldsOfDataClasses } from '../../src/providers/DataClassFieldProvider';

const URI = 'file:///src/main/kotlin/com/example/Models.kt';

function fieldsOf(code: string): string[] {
  const index = new SymbolIndex();
  index.add(parse(URI, code));
  return bodyFieldsOfDataClasses(index.getFileSymbols(URI)).map(e => e.name);
}

describe('DF-1 — corps vs constructeur primaire', () => {
  it('champ de corps flaggé, param du ctor épargné', () => {
    const fields = fieldsOf([
      'package com.example',
      'data class User(val id: Int, val name: String) {',
      '    val cache: List<String> = emptyList()',
      '}',
    ].join('\n'));
    expect(fields).toEqual(['cache']);
  });
});

describe('DF-2 — propagation du flag parser → index', () => {
  it('isPrimaryCtorParam présent sur les params, absent sur le corps', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, [
      'package com.example',
      'data class User(val id: Int) {',
      '    val cache = 1',
      '}',
    ].join('\n')));
    const symbols = index.getFileSymbols(URI);
    expect(symbols.find(s => s.name === 'id')?.isPrimaryCtorParam).toBe(true);
    expect(symbols.find(s => s.name === 'cache')?.isPrimaryCtorParam).toBeUndefined();
  });
});

describe('DF-3 — classe normale', () => {
  it('champ de corps non flaggé', () => {
    expect(fieldsOf([
      'package com.example',
      'class Repo(val api: Api) {',
      '    val cache: List<String> = emptyList()',
      '}',
    ].join('\n'))).toEqual([]);
  });
});

describe('DF-4 — companion object', () => {
  it('les vals du companion ne sont pas flaggés', () => {
    expect(fieldsOf([
      'package com.example',
      'data class User(val id: Int) {',
      '    companion object {',
      '        val DEFAULT = User(0)',
      '    }',
      '}',
    ].join('\n'))).toEqual([]);
  });
});

describe('DF-5 — var et const', () => {
  it('var de corps flaggé', () => {
    expect(fieldsOf([
      'package com.example',
      'data class State(val id: Int) {',
      '    var dirty: Boolean = false',
      '}',
    ].join('\n'))).toEqual(['dirty']);
  });
});

describe('DF-6 — data class imbriquée', () => {
  it('data class dans une classe normale → champ de corps flaggé', () => {
    expect(fieldsOf([
      'package com.example',
      'class Outer {',
      '    data class Inner(val x: Int) {',
      '        val derived = x * 2',
      '    }',
      '}',
    ].join('\n'))).toEqual(['derived']);
  });
});

describe('DF-7 — classe normale dans une data class', () => {
  it('les champs de la classe interne ne sont pas flaggés', () => {
    expect(fieldsOf([
      'package com.example',
      'data class Outer(val x: Int) {',
      '    class Helper {',
      '        val tmp = 1',
      '    }',
      '}',
    ].join('\n'))).toEqual([]);
  });
});

describe('DF-8 — plusieurs data classes', () => {
  it('chaque data class contribue ses propres champs', () => {
    expect(fieldsOf([
      'package com.example',
      'data class A(val x: Int) {',
      '    val cacheA = 1',
      '}',
      'data class B(val y: Int) {',
      '    val cacheB = 2',
      '}',
      'class C {',
      '    val notFlagged = 3',
      '}',
    ].join('\n'))).toEqual(['cacheA', 'cacheB']);
  });
});
