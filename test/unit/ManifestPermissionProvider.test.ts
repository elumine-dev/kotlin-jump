/**
 * ManifestPermissionProvider — pills de risque sur les uses-permission
 *
 * Vecteurs :
 *   MP-1  normal → 🟢, dangerous → 🟡, special/signature → 🔴
 *   MP-2  Permission inconnue (vendor/custom) → ⚪ unknown, pas d'absence
 *   MP-3  uses-permission-sdk-23 variant → badge aussi
 *   MP-4  Lignes non uses-permission (uses-feature, permission tag) → rien
 *   MP-5  maxSdkVersion et attributs supplémentaires n'empêchent pas le match
 *   MP-6  Colonne = fin de ligne (pill après le tag)
 */

import { describe, it, expect } from 'vitest';
import { findManifestPermissions } from '../../src/providers/ManifestPermissionProvider';

describe('MP-1 — niveaux de risque', () => {
  it.each([
    ['<uses-permission android:name="android.permission.INTERNET" />', '🟢 normal'],
    ['<uses-permission android:name="android.permission.CAMERA" />', '🟡 dangerous'],
    ['<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />', '🔴 special'],
    ['<uses-permission android:name="android.permission.READ_CONTACTS" />', '🟡 dangerous'],
  ])('%s → %s', (line, expected) => {
    const hits = findManifestPermissions(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe(expected);
  });
});

describe('MP-2 — permission inconnue', () => {
  it.each([
    '<uses-permission android:name="com.vendor.custom.PERMISSION" />',
    '<uses-permission android:name="android.permission.NOT_IN_DICT" />',
  ])('%s → ⚪ unknown', (line) => {
    const hits = findManifestPermissions(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('⚪ unknown');
  });
});

describe('MP-3 — variant sdk-23', () => {
  it('uses-permission-sdk-23 → badge', () => {
    const hits = findManifestPermissions(
      '<uses-permission-sdk-23 android:name="android.permission.CAMERA" />',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].risk).toBe('dangerous');
  });
});

describe('MP-4 — autres tags ignorés', () => {
  it.each([
    '<uses-feature android:name="android.hardware.camera" />',
    '<permission android:name="com.example.MY_PERMISSION" />',
    '<application android:name=".App">',
  ])('%s → rien', (line) => {
    expect(findManifestPermissions(line)).toHaveLength(0);
  });
});

describe('MP-5 — attributs supplémentaires', () => {
  it('maxSdkVersion avant name → match quand même', () => {
    const hits = findManifestPermissions(
      '<uses-permission android:maxSdkVersion="29" android:name="android.permission.WRITE_EXTERNAL_STORAGE" />',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].risk).toBe('dangerous');
  });
});

describe('MP-6 — position', () => {
  it('colonne = longueur de la ligne', () => {
    const line = '    <uses-permission android:name="android.permission.NFC" />';
    expect(findManifestPermissions(line)[0].column).toBe(line.length);
  });
});
