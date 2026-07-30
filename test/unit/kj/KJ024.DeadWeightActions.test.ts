import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { DeadWeightActionProvider } from '../../../src/providers/DeadWeightActionProvider';

/**
 * KJ-024 — "Remove unused …" quick fixes.
 *
 * Kevin, 2026-07-25: reporting dead weight without offering to remove it
 * leaves the work to the reader. Every badge that says "0 usages" must come
 * with an action that deletes the entry.
 */

function makeDoc(path: string, lines: string[]) {
  return {
    languageId: path.endsWith('.xml') ? 'xml' : 'kotlin',
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (i: number) => ({
      text: lines[i],
      range: new vscodeMock.Range(i, 0, i, lines[i].length),
    }),
    uri: { fsPath: path, toString: () => `file://${path}` },
  } as any;
}

const at = (line: number) => new vscodeMock.Range(line, 0, line, 0) as any;

/**
 * Workspace stub: `sources` drives usage counting, `files` drives findFiles.
 *
 * `settings` overrides individual `kotlinJump.*` values. KJ-031 took ownership
 * of `res/values*` entries, so the resource cases here have to say which world
 * they are testing.
 */
function stubWorkspace(
  sources: { path: string; text: string }[],
  settings: Record<string, unknown> = {},
) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (k: string, d?: unknown) => (k in settings ? settings[k] : d ?? true),
  } as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((pattern: any) =>
    Promise.resolve(
      String(pattern).includes('toml')
        ? []
        : sources.map(s => ({ fsPath: s.path, toString: () => `file://${s.path}` })),
    ) as any,
  );
  (vscodeMock.workspace as any).fs = {
    readFile: (uri: any) => {
      const hit = sources.find(s => s.path === uri.fsPath);
      return Promise.resolve(new TextEncoder().encode(hit?.text ?? ''));
    },
  };
}

beforeEach(() => vi.restoreAllMocks());

/** KJ-031 covers nine kinds and every qualifier variant, so it owns values*. */
const KJ031_OFF = { unusedResourceKeys: false };

describe('KJ-024 — unused resources', () => {
  it('yields res/values* to KJ-031 when it is enabled', async () => {
    stubWorkspace([]);
    const doc = makeDoc('/w/src/main/res/values/strings.xml', [
      '<resources>',
      '    <string name="dead_one">Nobody uses me</string>',
      '</resources>',
    ]);
    // Two lightbulbs deleting different amounts of text under near-identical
    // titles is the worst outcome available, so this one stands down.
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });

  it('offers removal for a string with zero usages when KJ-031 is off', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'val x = R.string.used_one' }], KJ031_OFF);
    const doc = makeDoc('/w/src/main/res/values/strings.xml', [
      '<resources>',
      '    <string name="dead_one">Nobody uses me</string>',
      '</resources>',
    ]);
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Remove unused string dead_one');
  });

  it('stays silent when the resource is used', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'val x = R.string.alive' }], KJ031_OFF);
    const doc = makeDoc('/w/src/main/res/values/strings.xml', [
      '<resources>',
      '    <string name="alive">Used</string>',
      '</resources>',
    ]);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });

  it('deletes the whole line, not a fragment', async () => {
    stubWorkspace([], KJ031_OFF);
    const doc = makeDoc('/w/src/main/res/values/colors.xml', [
      '<resources>',
      '    <color name="dead">#FF0000</color>',
      '</resources>',
    ]);
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    const entries = (actions[0].edit as any).entries();
    expect(entries[0].range.start.line).toBe(1);
    expect(entries[0].range.end.line).toBe(2);
    expect(entries[0].newText).toBe('');
  });
});

describe('KJ-024 — unused dependencies', () => {
  it('offers removal for a dependency nothing imports', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'import retrofit2.Retrofit' }]);
    const doc = makeDoc('/w/build.gradle.kts', [
      'dependencies {',
      '    implementation("com.google.code.gson:gson:2.10.1")',
      '}',
    ]);
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain('com.google.code.gson:gson');
  });

  it('stays silent when the dependency is imported', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'import retrofit2.Retrofit' }]);
    const doc = makeDoc('/w/build.gradle.kts', [
      'dependencies {',
      '    implementation("com.squareup.retrofit2:retrofit:2.9.0")',
      '}',
    ]);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });

  it('never offers removal for a BOM (no imports of its own by design)', async () => {
    stubWorkspace([]);
    const doc = makeDoc('/w/build.gradle.kts', [
      'dependencies {',
      '    implementation("androidx.compose:compose-bom:2024.02.00")',
      '}',
    ]);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });
});

describe('KJ-024 — manifest', () => {
  const manifest = (extra: string[]) =>
    makeDoc('/w/src/main/AndroidManifest.xml', [
      '<manifest package="com.example">',
      ...extra,
      '</manifest>',
    ]);

  it('offers removal for a permission with no matching API call', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'class App' }]);
    const doc = manifest(['    <uses-permission android:name="android.permission.READ_SMS" />']);
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Remove unused permission READ_SMS');
  });

  it('offers a CAUTIOUS removal for a permission libraries commonly pull in', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'class App' }]);
    const doc = manifest(['    <uses-permission android:name="android.permission.INTERNET" />']);
    // Décision produit (Kevin, 25/07) : le badge dit « no usage found »
    // pour maybe-lib aussi, l'ampoule doit donc offrir la suppression,
    // avec un libellé qui garde la nuance bibliothèque.
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe(
      'Remove permission INTERNET (no usage in project code; a library may need it)',
    );
  });

  it('offers removal for a component whose class does not exist', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'class RealActivity' }]);
    const doc = manifest(['    <activity android:name=".GhostActivity" />']);
    const actions = await new DeadWeightActionProvider().provideCodeActions(doc, at(1));
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Remove .GhostActivity (class not found)');
  });

  it('stays silent for a component whose class exists', async () => {
    stubWorkspace([{ path: '/w/src/App.kt', text: 'class RealActivity' }]);
    const doc = manifest(['    <activity android:name=".RealActivity" />']);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });
});

describe('KJ-024 — scope', () => {
  it('returns nothing on unrelated files', async () => {
    stubWorkspace([]);
    const doc = makeDoc('/w/src/App.kt', ['class App']);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(0))).toEqual([]);
  });

  it('honours the disable setting', async () => {
    stubWorkspace([]);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (k: string, d?: unknown) => (k === 'deadWeightQuickFixes' ? false : d),
    } as any);
    const doc = makeDoc('/w/src/main/res/values/strings.xml', [
      '<resources>',
      '    <string name="dead">x</string>',
      '</resources>',
    ]);
    expect(await new DeadWeightActionProvider().provideCodeActions(doc, at(1))).toEqual([]);
  });
});
