import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';
import { findUnusedMembers } from '../../../src/providers/unusedMembers';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';
import { suppressesDiagnostic, UNUSED_DECLARATION, UNUSED_PRIVATE_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE } from '../../../src/util/kotlinScan';

/**
 * `@SuppressWarnings("all")` fait taire tout, et `"UnusedDeclaration"` est
 * l ancien nom IntelliJ de `"unused"`.
 *
 * G59 (2026-10-14) : la directive unused ne protege plus aucune declaration,
 * fichier compris ; ces cas en sont les temoins. `"all"` et
 * `"UnusedDeclaration"` ne protegent plus les declarations non plus ; `"all"`
 * tait encore les parametres et les locales.
 *
 * Historique, avant G59 :
 * Jusqu a 1.42.319 n importe quelle annotation protegeait une declaration
 * privee. 1.42.320 puis 1.42.333 ont exige que la directive NOMME le
 * diagnostic, avec une liste qui ignorait ces deux formes : un champ prive mort
 * sous `@SuppressWarnings("all")`, ou une methode sous
 * `@SuppressWarnings("UnusedDeclaration")`, sortaient de nouveau et « Remove
 * Everything Unused » les effacait. Le projet de reference porte les deux
 * (`CirclePageWithMarginIndicator`, `variantMainLayout`).
 */

const noms = (src: string, lang: 'kotlin' | 'java') => (findUnusedDeclarations(src, lang) as any[]).map(d => d.name).sort();

describe('all et UnusedDeclaration ne protegent plus les declarations', () => {
  it('Java : @SuppressWarnings("all") sur la classe, le champ et la methode sortent', () => {
    expect(noms('package p;\n\n@SuppressWarnings("all")\npublic class C {\n    private int mort = 1;\n    private void morte() {}\n    public void vivant() {}\n}\n', 'java')).toEqual(['mort', 'morte']);
  });

  it('Java : sur la declaration, all et UnusedDeclaration ne la gardent pas', () => {
    expect(noms('package p;\n\npublic class D {\n    @SuppressWarnings("UnusedDeclaration")\n    private void morte() {}\n    @SuppressWarnings({"all"})\n    private int mort = 1;\n    public void vivant() {}\n}\n', 'java')).toEqual(['mort', 'morte']);
  });

  it('Kotlin : @Suppress("ALL") sur la classe, les membres prives morts sortent', () => {
    expect(noms('package p\n\n@Suppress("ALL")\nclass E {\n    private val mort = 1\n    private fun morte() = 2\n    fun vivant() = 3\n}\n', 'kotlin')).toEqual(['mort', 'morte']);
  });

  it('temoin : un autre diagnostic ne protege toujours pas', () => {
    expect(noms('package p;\n\npublic class D {\n    @SuppressWarnings("rawtypes")\n    private void morte() {}\n    public void vivant() {}\n}\n', 'java')).toEqual(['morte']);
  });

  it('un membre et une entree d enum sous all sortent', () => {
    const MAIN = '/w/app/src/main/kotlin/com/x';
    const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
    const classe = { path: `${MAIN}/C.kt`, text: 'package com.x\n\nclass C {\n    @Suppress("all")\n    fun garde() = 2\n    fun vivante() = 3\n}\n' };
    const enumeration = { path: `${MAIN}/E.kt`, text: 'package com.x\n\n@Suppress("all")\nenum class E {\n    VIVANT,\n    MORT,\n}\n' };
    const appel = { path: `${MAIN}/Main.kt`, text: 'package com.x\n\nfun main() { println(C().vivante()); println(E.VIVANT) }\n' };
    const sources = [classe, enumeration, appel, GRADLE];
    expect((findUnusedMembers({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(m => m.name)).toContain('garde');
    expect((findUnusedEnumEntries({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(e => e.name)).toContain('MORT');
  });

  it('all tait les parametres et les locales, jamais les declarations, sans avaler un mot qui contient all', () => {
    for (const liste of [UNUSED_DECLARATION, UNUSED_PRIVATE_DECLARATION]) {
      expect(suppressesDiagnostic('"all"', liste)).toBe(false);
      expect(suppressesDiagnostic('"TooManyFunctions", "ALL"', liste)).toBe(false);
    }
    for (const liste of [UNUSED_PARAMETER, UNUSED_VARIABLE]) {
      expect(suppressesDiagnostic('"all"', liste)).toBe(true);
      expect(suppressesDiagnostic('"TooManyFunctions", "ALL"', liste)).toBe(true);
    }
    for (const liste of [UNUSED_DECLARATION, UNUSED_PRIVATE_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE]) {
      expect(suppressesDiagnostic('"SwallowedException"', liste)).toBe(false);
      expect(suppressesDiagnostic('"CallToAllMethod"', liste)).toBe(false);
    }
    expect(suppressesDiagnostic('"UnusedDeclaration"', UNUSED_DECLARATION)).toBe(false);
    expect(suppressesDiagnostic('"UnusedDeclaration"', UNUSED_PRIVATE_DECLARATION)).toBe(false);
  });
});
