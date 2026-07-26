import { describe, it, expect } from 'vitest';
import {
  parseIncludedModules,
  groupResByType,
} from '../../../src/ui/AndroidProjectViewProvider';

/** KJ-012 — tentatives de casse au-delà du contrat. */

describe('KJ-012 adversarial — parseIncludedModules', () => {
  it('includeBuild(…) N’EST PAS un module', () => {
    expect(parseIncludedModules('includeBuild("../platform")')).toEqual([]);
  });

  it('module imbriqué :feature:battle', () => {
    expect(parseIncludedModules('include(":feature:battle")')).toEqual([':feature:battle']);
  });

  it('syntaxe Groovy sans parenthèses', () => {
    expect(parseIncludedModules("include ':app', ':core'")).toEqual([':app', ':core']);
  });

  it('include multi-lignes dans les parenthèses', () => {
    expect(parseIncludedModules('include(\n    ":a",\n    ":b",\n)')).toEqual([':a', ':b']);
  });

  it('commentaire en fin de ligne après un include valide', () => {
    expect(parseIncludedModules('include(":a") // module principal')).toEqual([':a']);
  });

  it('fichier vide → []', () => {
    expect(parseIncludedModules('')).toEqual([]);
  });

  it('BUG-HUNT-12 : URL https:// sur la ligne ne mange pas l’include qui suit', () => {
    const s = 'maven(url = "https://repo.example.com") ; include(":core")';
    expect(parseIncludedModules(s)).toEqual([':core']);
  });
});

describe('KJ-012 adversarial — groupResByType', () => {
  it('chemins Windows (backslashes) acceptés', () => {
    const groups = groupResByType(['src\\main\\res\\values-fr\\strings.xml']);
    expect(groups).toEqual([{ type: 'values', base: 'values', qualifiers: ['values-fr'] }]);
  });

  it('qualificatif multi-tirets (values-night-v31) rattaché au bon type', () => {
    const groups = groupResByType(['src/main/res/values-night-v31/themes.xml']);
    expect(groups[0].type).toBe('values');
    expect(groups[0].qualifiers).toEqual(['values-night-v31']);
  });

  it('fichier hors res/ ignoré sans crash', () => {
    expect(groupResByType(['src/main/kotlin/App.kt'])).toEqual([]);
  });

  it('type présent UNIQUEMENT en qualifié (mipmap-hdpi sans mipmap/)', () => {
    const groups = groupResByType(['src/main/res/mipmap-hdpi/ic_launcher.png']);
    expect(groups).toEqual([{ type: 'mipmap', base: 'mipmap', qualifiers: ['mipmap-hdpi'] }]);
  });

  it('doublons de qualificatifs dédupliqués', () => {
    const groups = groupResByType([
      'src/main/res/values-fr/strings.xml',
      'src/main/res/values-fr/plurals.xml',
    ]);
    expect(groups[0].qualifiers).toEqual(['values-fr']);
  });
});
