import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { DeadIslandProvider, findDeadIslands } from '../../../src/providers/DeadIslandProvider';
import { findUnusedImports } from '../../../src/providers/unusedImports';

/**
 * L ampoule d un ilot mort emporte les imports que ses corps laissent sans
 * utilisateur, et le fichier qu elle vide.
 *
 * Vu sur le projet de reference, dans `adminV2/theme/Color.kt` : l ilot
 * `rainbowColors` + `adminRainbowColors` est parti, `import
 * androidx.compose.runtime.Composable` est reste, et detekt a refuse le build
 * (`NoUnusedImports`). Les trois autres ampoules de la famille passent par la
 * cascade de KJ-048 ; celle des ilots ne retirait que les imports de ses NOMS
 * dans les autres fichiers.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const APPEL = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(primary) }\n');

function document(path: string, text: string) {
  const lignes = text.split('\n');
  return { uri: vscodeMock.Uri.file(path), getText: () => text, isDirty: false, lineAt: (l: number) => ({ text: lignes[l] ?? '' }) } as any;
}

/** Le texte de `path` une fois l edition appliquee, ou null si le fichier est supprime. */
function applique(edit: any, path: string, text: string): string | null {
  if ((edit._fileDeletes ?? []).some((d: any) => String(d.uri.fsPath ?? d.uri) === path)) return null;
  const lignes = text.split('\n');
  const offset = (p: any) => lignes.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
  const plages = (edit._entries ?? []).filter((e: any) => String(e.uri.fsPath ?? e.uri) === path)
    .map((e: any) => ({ start: offset(e.range.start), end: offset(e.range.end), texte: e.newText }))
    .sort((a: any, b: any) => b.start - a.start);
  let out = text;
  for (const p of plages) out = out.slice(0, p.start) + p.texte + out.slice(p.end);
  return out;
}

function ampoule(sources: Array<{ path: string; text: string }>, path: string) {
  vi.spyOn(DeadIslandProvider, 'isEnabled').mockReturnValue(true);
  const iles = findDeadIslands({ sources, testSourceSets: ['/src/test/'], maxIslandSize: 8 } as any) as any[];
  const provider = new DeadIslandProvider();
  provider.setFindings(iles, new Map(sources.map(s => [s.path, s.text])));
  const text = sources.find(s => s.path === path)!.text;
  const membre = iles.flatMap(i => i.members).find((m: any) => m.path === path);
  expect(membre, 'un ilot est trouve dans le fichier').toBeDefined();
  const actions = provider.provideCodeActions(document(path, text), new vscodeMock.Range(membre.line, 0, membre.line, 0) as any);
  provider.dispose();
  expect(actions.length, 'une ampoule est offerte').toBe(1);
  return { edit: actions[0].edit as any, text };
}

afterEach(() => vi.restoreAllMocks());

describe('KJ-046 l ampoule d un ilot emporte ses imports', () => {
  it('le cas du projet de reference : l import de Composable part avec l ilot', () => {
    const path = `${MAIN}/Color.kt`;
    const color = f(path, 'package com.x\n\nimport androidx.compose.runtime.Composable\nimport kotlin.math.abs\n\nval primary = abs(1)\n\nval adminRainbowColors = listOf(1, 2)\n\n@Composable\nfun rainbowColors() = adminRainbowColors\n');
    const { edit, text } = ampoule([color, APPEL, GRADLE], path);
    const apres = applique(edit, path, text)!;
    expect(apres).not.toContain('rainbowColors');
    expect(apres).toContain('import kotlin.math.abs');
    expect(findUnusedImports(apres)).toEqual([]);
  });

  it('un fichier qui ne garde que son paquet est supprime, sans plage dedans', () => {
    const path = `${MAIN}/Rainbow.kt`;
    const seul = f(path, 'package com.x\n\nimport androidx.compose.runtime.Composable\n\nval adminRainbowColors = listOf(1, 2)\n\n@Composable\nfun rainbowColors() = adminRainbowColors\n');
    const vivant = f(`${MAIN}/Color.kt`, 'package com.x\n\nval primary = 1\n');
    const { edit } = ampoule([seul, vivant, APPEL, GRADLE], path);
    expect((edit._fileDeletes ?? []).map((d: any) => String(d.uri.fsPath ?? d.uri))).toEqual([path]);
    expect((edit._entries ?? []).filter((e: any) => String(e.uri.fsPath ?? e.uri) === path)).toEqual([]);
  });

  it('un import qu un membre fait d un autre membre n est coupe qu une fois', () => {
    // Il est a la fois orphelin par la cascade et import perime d un nom de
    // l ilot : deux suppressions de la meme ligne font rejeter l edition entiere.
    const a = f(`${MAIN}/a/A.kt`, 'package com.x.a\n\nimport com.x.b.deux\n\nfun un() = deux()\n\nval vivant = 1\n');
    const b = f(`${MAIN}/b/B.kt`, 'package com.x.b\n\nimport com.x.a.un\n\nfun deux(): Int = un()\n\nval autre = 2\n');
    const appel = f(`${MAIN}/Main.kt`, 'package com.x\n\nimport com.x.a.vivant\nimport com.x.b.autre\n\nfun main() { println(vivant + autre) }\n');
    const { edit, text } = ampoule([a, b, appel, GRADLE], a.path);
    const lignes = (edit._entries ?? []).map((e: any) => `${String(e.uri.fsPath ?? e.uri)}:${e.range.start.line}`);
    expect(new Set(lignes).size).toBe(lignes.length);
    const apresA = applique(edit, a.path, text)!;
    const apresB = applique(edit, b.path, b.text)!;
    expect(findUnusedImports(apresA)).toEqual([]);
    expect(findUnusedImports(apresB)).toEqual([]);
    expect(apresA).toContain('val vivant');
    expect(apresB).toContain('val autre');
  });
});
