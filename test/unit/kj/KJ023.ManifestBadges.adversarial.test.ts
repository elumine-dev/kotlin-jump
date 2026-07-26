import { describe, it, expect } from 'vitest';
import { analyzeManifest } from '../../../src/providers/ManifestNecessityProvider';

/** KJ-023 — tentatives de casse au-delà du contrat. */

const stub = (classes: string[] = [], usages: Record<string, string[]> = {}) => ({
  classExists: (fqn: string) => classes.includes(fqn),
  searchApiUsage: (patterns: string[]) => patterns.flatMap(p => usages[p] ?? []),
});

describe('KJ-023 adversarial', () => {
  it('INTERNET jamais « unused » : maybe-lib (les libs réseau la tirent)', () => {
    const xml = '<manifest package="com.x"><uses-permission android:name="android.permission.INTERNET"/></manifest>';
    const r = analyzeManifest(xml, stub());
    expect(r.permissions[0].status).toBe('maybe-lib');
  });

  it('permission inconnue de la table : maybe-lib, jamais un faux unused', () => {
    const xml = '<manifest package="com.x"><uses-permission android:name="com.vendor.CUSTOM_PERM"/></manifest>';
    expect(analyzeManifest(xml, stub()).permissions[0].status).toBe('maybe-lib');
  });

  it('nom de classe COMPLET (non relatif) résolu tel quel', () => {
    const xml = '<manifest package="com.x"><application>' +
      '<service android:name="com.other.SyncService"/></application></manifest>';
    const r = analyzeManifest(xml, stub(['com.other.SyncService'], { SyncService: ['App.kt'] }));
    expect(r.components[0].status).toBe('ok');
  });

  it('permission déclarée dans un COMMENTAIRE : ignorée', () => {
    const xml = '<manifest package="com.x"><!-- <uses-permission android:name="android.permission.READ_SMS"/> --></manifest>';
    expect(analyzeManifest(xml, stub()).permissions).toHaveLength(0);
  });

  it('composant existant, sans intent-filter, jamais cité : unreferenced', () => {
    const xml = '<manifest package="com.x"><application>' +
      '<activity android:name=".Hidden"/></application></manifest>';
    const r = analyzeManifest(xml, stub(['com.x.Hidden']));
    expect(r.components[0].status).toBe('unreferenced');
  });

  it('BUG-HUNT-15 : <activity-alias> analysé via sa targetActivity, jamais comme classe', () => {
    const xml = '<manifest package="com.x"><application>' +
      '<activity android:name=".Real"/>' +
      '<activity-alias android:name=".Shortcut" android:targetActivity=".Real">' +
      '<intent-filter><action android:name="android.intent.action.MAIN"/></intent-filter>' +
      '</activity-alias></application></manifest>';
    const r = analyzeManifest(xml, stub(['com.x.Real'], { Real: ['App.kt'] }));
    const alias = r.components.find((c: any) => c.name === '.Shortcut');
    // l'alias n'a pas de classe propre : jamais « missing-class » si la cible existe
    expect(alias?.status).toBe('ok');
  });

  it('receiver avec intent-filter et classe existante : ok', () => {
    const xml = '<manifest package="com.x"><application>' +
      '<receiver android:name=".BootReceiver"><intent-filter>' +
      '<action android:name="android.intent.action.BOOT_COMPLETED"/>' +
      '</intent-filter></receiver></application></manifest>';
    const r = analyzeManifest(xml, stub(['com.x.BootReceiver']));
    expect(r.components[0].status).toBe('ok');
  });
});
