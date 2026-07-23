/**
 * PermissionHoverProvider + permissionDescriptions
 *
 * Vecteurs :
 *   PH-1  Manifest.permission.CAMERA → hover avec description + protection
 *   PH-2  Forme string "android.permission.X" (Kotlin et XML manifest)
 *   PH-3  Position du curseur : dans la ref → hover, hors ref → null
 *   PH-4  Permission inconnue → null (pas de hover vide)
 *   PH-5  android.Manifest.permission.X (FQN) → hover
 *   PH-6  Deux permissions sur une ligne → la bonne selon le curseur
 *   PH-7  lookupPermission accepte les deux formes de nom
 *   PH-8  Notes de dépréciation présentes sur les permissions legacy
 *   PH-9  Ligne sans permission → quick reject (null)
 *   PH-10 Cohérence du dictionnaire : descriptions non vides, protection valide
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { PermissionHoverProvider } from '../../src/providers/PermissionHoverProvider';
import { PERMISSION_DESCRIPTIONS, lookupPermission } from '../../src/data/permissionDescriptions';

function makeDoc(lines: string[], languageId = 'kotlin'): vscode.TextDocument {
  return {
    languageId,
    lineAt: (n: number) => ({ text: lines[n] }),
    lineCount: lines.length,
  } as unknown as vscode.TextDocument;
}

function hoverAt(line: string, character: number, languageId = 'kotlin') {
  const provider = new PermissionHoverProvider();
  return provider.provideHover(makeDoc([line], languageId), new vscode.Position(0, character) as any);
}

function hoverText(h: vscode.Hover | null): string {
  if (!h) return '';
  const md = h.contents as any;
  return Array.isArray(md) ? md.map(m => m.value ?? m).join('') : (md.value ?? String(md));
}

describe('PH-1 — constante Manifest.permission', () => {
  it('CAMERA → description + niveau dangerous', () => {
    const line = 'val p = Manifest.permission.CAMERA';
    const h = hoverAt(line, line.indexOf('CAMERA') + 2);
    expect(h).not.toBeNull();
    const text = hoverText(h);
    expect(text).toContain('CAMERA');
    expect(text).toContain('dangerous');
    expect(text).toContain('camera');
  });

  it('INTERNET → niveau normal', () => {
    const line = 'val p = Manifest.permission.INTERNET';
    const text = hoverText(hoverAt(line, line.indexOf('INTERNET')));
    expect(text).toContain('normal');
  });
});

describe('PH-2 — forme string', () => {
  it('checkSelfPermission("android.permission.RECORD_AUDIO") → hover', () => {
    const line = 'checkSelfPermission(ctx, "android.permission.RECORD_AUDIO")';
    const h = hoverAt(line, line.indexOf('RECORD_AUDIO') + 3);
    expect(hoverText(h)).toContain('microphone');
  });

  it('AndroidManifest.xml uses-permission → hover', () => {
    const line = '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />';
    const h = hoverAt(line, line.indexOf('ACCESS_FINE') + 4, 'xml');
    expect(hoverText(h)).toContain('precise location');
  });
});

describe('PH-3 — sensibilité à la position', () => {
  const line = 'val p = Manifest.permission.CAMERA // comment';

  it('curseur sur la ref complète → hover', () => {
    expect(hoverAt(line, line.indexOf('Manifest') + 1)).not.toBeNull();
  });
  it('curseur sur le commentaire → null', () => {
    expect(hoverAt(line, line.indexOf('comment'))).toBeNull();
  });
  it('curseur avant la ref → null', () => {
    expect(hoverAt(line, 0)).toBeNull();
  });
});

describe('PH-4 — permission inconnue', () => {
  it('MADE_UP_PERMISSION → null', () => {
    const line = 'val p = Manifest.permission.MADE_UP_PERMISSION';
    expect(hoverAt(line, line.indexOf('MADE_UP') + 2)).toBeNull();
  });
});

describe('PH-5 — FQN android.Manifest.permission', () => {
  it('android.Manifest.permission.VIBRATE → hover', () => {
    const line = 'val p = android.Manifest.permission.VIBRATE';
    expect(hoverText(hoverAt(line, line.indexOf('VIBRATE')))).toContain('vibrator');
  });
});

describe('PH-6 — deux permissions sur une ligne', () => {
  const line = 'arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)';

  it('curseur sur la 1re → CAMERA', () => {
    expect(hoverText(hoverAt(line, line.indexOf('CAMERA') + 1))).toContain('CAMERA');
  });
  it('curseur sur la 2e → RECORD_AUDIO', () => {
    expect(hoverText(hoverAt(line, line.indexOf('RECORD_AUDIO') + 1))).toContain('RECORD_AUDIO');
  });
});

describe('PH-7 — lookupPermission', () => {
  it('accepte le nom court et le nom complet', () => {
    expect(lookupPermission('CAMERA')).toBeDefined();
    expect(lookupPermission('android.permission.CAMERA')).toBeDefined();
    expect(lookupPermission('android.permission.CAMERA')).toBe(lookupPermission('CAMERA'));
  });
  it('inconnu → undefined', () => {
    expect(lookupPermission('NOT_A_PERMISSION')).toBeUndefined();
  });
});

describe('PH-8 — notes de migration sur les permissions legacy', () => {
  it.each([
    ['WRITE_EXTERNAL_STORAGE', 'API 30'],
    ['READ_EXTERNAL_STORAGE', 'READ_MEDIA'],
    ['BLUETOOTH', 'BLUETOOTH_CONNECT'],
    ['USE_FINGERPRINT', 'USE_BIOMETRIC'],
  ])('%s mentionne %s', (perm, expected) => {
    expect(PERMISSION_DESCRIPTIONS[perm].note).toContain(expected);
  });
});

describe('PH-9 — quick reject', () => {
  it('ligne sans permission → null', () => {
    expect(hoverAt('val x = computeThing(42)', 5)).toBeNull();
  });
  it('permission() fonction quelconque → null', () => {
    expect(hoverAt('val p = permission.check()', 10)).toBeNull();
  });
});

describe('PH-10 — cohérence du dictionnaire', () => {
  const VALID = new Set(['normal', 'dangerous', 'special', 'signature']);

  it('toutes les entrées ont description + protection valide', () => {
    for (const [name, info] of Object.entries(PERMISSION_DESCRIPTIONS)) {
      expect(info.description.length, name).toBeGreaterThan(20);
      expect(VALID.has(info.protection), `${name}: ${info.protection}`).toBe(true);
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('au moins 50 permissions couvertes', () => {
    expect(Object.keys(PERMISSION_DESCRIPTIONS).length).toBeGreaterThanOrEqual(50);
  });
});
