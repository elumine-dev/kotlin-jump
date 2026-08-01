import { describe, it, expect } from 'vitest';
import { findWriteOnlyKeys } from '../../../src/providers/writeOnlyKeys';

/**
 * KJ-045 — les clés écrites jamais lues : extras d'Intent, préférences,
 * permissions. Des bugs plus que du poids mort : la moitié productrice d'un
 * passage de main dont la moitié consommatrice n'existe plus.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const scan = (sources: any[], extra: Record<string, unknown> = {}) =>
  findWriteOnlyKeys({ sources, testSourceSets: TEST_SETS, ...extra });
const keys = (sources: any[]) => scan(sources).findings.map(x => `${x.kind}:${x.key}`);

describe('les extras d’Intent', () => {
  it('un extra écrit jamais lu est signalé, même dans un apply {}', () => {
    // La forme réelle du bug trouvé : putExtra sans receveur explicite.
    const writer = f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      'class A {',
      '    companion object {',
      '        private const val EXTRA_LEVEL_ID = "EXTRA_LEVEL_ID"',
      '    }',
      '    fun launch(intent: Intent, id: String) {',
      '        intent.apply {',
      '            putExtra(EXTRA_LEVEL_ID, id)',
      '        }',
      '    }',
      '}',
    ].join('\n'));
    expect(keys([writer])).toEqual(['intentExtra:EXTRA_LEVEL_ID']);
  });

  it('un extra lu quelque part est vivant, la constante pouvant vivre ailleurs', () => {
    const writer = f(`${MAIN}/A.kt`,
      'package com.x\n\nfun w(i: Intent) {\n    i.putExtra("deep_link", "x")\n}\n');
    const reader = f(`${MAIN}/B.kt`, [
      'package com.x',
      '',
      'object Keys { const val DEEP_LINK = "deep_link" }',
      '',
      'fun r(i: Intent) = i.getStringExtra(Keys.DEEP_LINK)',
    ].join('\n'));
    expect(keys([writer, reader])).toEqual([]);
  });

  it('un extra du SDK a son lecteur dans une autre app : jamais signalé', () => {
    const writer = f(`${MAIN}/A.kt`,
      'package com.x\n\nfun share(i: Intent, t: String) {\n    i.putExtra(Intent.EXTRA_STREAM, t)\n}\n');
    expect(keys([writer])).toEqual([]);
  });

  it('une LECTURE à clé irrésoluble empoisonne la catégorie', () => {
    // Les posts sont la preuve : une lecture qui pourrait lire n'importe quoi
    // interdit d'affirmer qu'une clé n'est jamais lue.
    const writer = f(`${MAIN}/A.kt`,
      'package com.x\n\nfun w(i: Intent) {\n    i.putExtra("orphan", 1)\n}\n');
    const dynamicReader = f(`${MAIN}/B.kt`,
      'package com.x\n\nfun r(i: Intent, k: String) = i.getStringExtra(k)\n');
    const result = scan([writer, dynamicReader]);
    expect(result.findings.filter(x => x.kind === 'intentExtra')).toEqual([]);
    expect(result.poisoned.some(p => p.kind === 'intentExtra')).toBe(true);
  });

  it('une écriture à constante AMBIGUË est abandonnée, pas devinée', () => {
    const a = f(`${MAIN}/A.kt`, 'package com.x\n\nobject K1 { const val KEY_X = "one" }\n');
    const b = f(`${MAIN}/B.kt`, 'package com.x\n\nobject K2 { const val KEY_X = "two" }\n');
    const writer = f(`${MAIN}/W.kt`, 'package com.x\n\nfun w(i: Intent) {\n    i.putExtra(KEY_X, 1)\n}\n');
    expect(keys([a, b, writer]).filter(k => k.startsWith('intentExtra'))).toEqual([]);
  });

  it('une écriture depuis un test ne revendique rien', () => {
    const testWriter = f('/w/app/src/test/kotlin/com/x/T.kt',
      'package com.x\n\nfun t(i: Intent) {\n    i.putExtra("test_only", 1)\n}\n');
    expect(keys([testWriter])).toEqual([]);
  });
});

describe('les préférences', () => {
  it('une clé écrite jamais relue est signalée', () => {
    const writer = f(`${MAIN}/P.kt`,
      'package com.x\n\nfun save(prefs: Editor) {\n    prefs.putBoolean("migrated_v1", true)\n}\n');
    expect(keys([writer])).toEqual(['preferenceKey:migrated_v1']);
  });

  it('lue ailleurs : vivante', () => {
    const writer = f(`${MAIN}/P.kt`,
      'package com.x\n\nfun save(prefs: Editor) {\n    prefs.putBoolean("migrated_v1", true)\n}\n');
    const reader = f(`${MAIN}/R.kt`,
      'package com.x\n\nfun read(prefs: Prefs) = prefs.getBoolean("migrated_v1", false)\n');
    expect(keys([writer, reader])).toEqual([]);
  });

  it('un wrapper à clé paramétrée empoisonne la catégorie, honnêtement', () => {
    // Le patron du corpus réel : `getString(source, key, default)` où la clé
    // est un paramètre par construction. La catégorie devient non prouvable.
    const writer = f(`${MAIN}/P.kt`,
      'package com.x\n\nfun save(prefs: Editor) {\n    prefs.putBoolean("orphan", true)\n}\n');
    const wrapper = f(`${MAIN}/Svc.kt`,
      'package com.x\n\nclass Svc(private val prefs: Prefs) {\n' +
      '    fun read(key: String) = prefs.getString(key, null)\n}\n');
    const result = scan([writer, wrapper]);
    expect(result.findings.filter(x => x.kind === 'preferenceKey')).toEqual([]);
    expect(result.poisoned.some(p => p.kind === 'preferenceKey')).toBe(true);
  });
});

describe('les permissions', () => {
  const manifest = (perms: string[]) => f('/w/app/src/main/AndroidManifest.xml',
    '<manifest>\n' + perms.map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n') + '\n</manifest>');

  it('une permission que rien n’exerce est signalée', () => {
    expect(keys([manifest(['RECEIVE_BOOT_COMPLETED'])]))
      .toEqual(['permission:android.permission.RECEIVE_BOOT_COMPLETED']);
  });

  it('les permissions autosuffisantes ne sont jamais signalées', () => {
    expect(keys([manifest(['INTERNET', 'VIBRATE', 'WAKE_LOCK', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK'])]))
      .toEqual([]);
  });

  it('nommée dans le code : vivante', () => {
    const user = f(`${MAIN}/Perm.kt`,
      'package com.x\n\nval p = Manifest.permission.CAMERA\n');
    expect(keys([manifest(['CAMERA']), user])).toEqual([]);
  });

  it('un manifest de debug déclare de l’outillage : hors périmètre', () => {
    const debug = f('/w/app/src/debug/AndroidManifest.xml',
      '<manifest>\n    <uses-permission android:name="android.permission.GET_TASKS" />\n</manifest>');
    expect(keys([debug])).toEqual([]);
  });
});

describe('le contrat', () => {
  it('un corpus tronqué ne produit rien', () => {
    const m = f('/w/app/src/main/AndroidManifest.xml',
      '<manifest><uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" /></manifest>');
    expect(scan([m], { truncated: true }).findings).toEqual([]);
  });

  it('le marqueur inline tait le fichier', () => {
    const writer = f(`${MAIN}/A.kt`,
      '// kotlin-jump:ignore write-only-key\npackage com.x\n\nfun w(i: Intent) {\n    i.putExtra("orphan", 1)\n}\n');
    expect(keys([writer])).toEqual([]);
  });
});
