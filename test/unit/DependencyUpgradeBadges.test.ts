import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { DependencyUpgradeProvider } from '../../src/providers/DependencyUpgradeProvider';
import { DependencyUpgradeBadgeProvider } from '../../src/providers/DependencyUpgradeBadgeProvider';
import { collectCatalogDependencies } from '../../src/upgrades/catalogDependencies';
import { probeSnapshot, probeTexts } from '../../src/util/demoProbe';
import type { Finding } from '../../src/upgrades/model';

/**
 * KJ-082, the end of line badges: `↑ 3.0.0` after a version that can move,
 * `pin 4.12.0` after a dynamic one. Decorations are cheap and the demo probe
 * can count them, which an inlay hint cannot offer. They follow the findings
 * the provider holds, repaint when those change, and go away with the
 * setting.
 */

const FILE = '/w/gradle/libs.versions.toml';
const TEXT = '[versions]\nretrofit = "2.9.0"\ngson = "2.10.1"\nokhttp = "4.+"\n\n[libraries]\nr = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }\ng = { module = "com.google.code.gson:gson", version.ref = "gson" }\no = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }\n';
const deps = collectCatalogDependencies(TEXT, FILE).dependencies;
const dep = (name: string) => deps.find(d => d.name === name)!;
const candidate = (versions: string[], pick: string | undefined) => ({ latest: versions[versions.length - 1], latestStable: pick, pick, versions, newerCount: 1, currentKnown: true, fetchedAt: 1, stale: false, repository: 'mavenCentral' as const });
const FINDINGS: Finding[] = [
  { dependency: dep('retrofit'), verdict: { kind: 'newer', to: '3.0.0', stability: 'stable', candidate: candidate(['2.9.0', '3.0.0'], '3.0.0') } },
  { dependency: dep('gson'), verdict: { kind: 'upToDate', candidate: candidate(['2.10.1'], undefined) } },
  { dependency: dep('okhttp'), verdict: { kind: 'rich', form: 'dynamic', pin: '4.12.0' } },
];

function editorFor(path: string, text: string) {
  const painted: { type: unknown; decorations: vscode.DecorationOptions[] }[] = [];
  const lines = text.split('\n');
  const editor = {
    document: { uri: vscode.Uri.file(path), fileName: path, getText: () => text, lineCount: lines.length, lineAt: (l: number) => ({ text: lines[l], range: new vscode.Range(l, 0, l, lines[l].length) }) },
    setDecorations: (type: unknown, decorations: vscode.DecorationOptions[]) => { painted.push({ type, decorations }); },
  };
  return { editor, painted };
}

let enabled = true;
let provider: DependencyUpgradeProvider;

beforeEach(() => {
  enabled = true;
  provider = new DependencyUpgradeProvider({ policy: () => 'preferStable', bump: () => [], textOf: () => TEXT });
  (vscode.window as any).visibleTextEditors = [];
});
afterEach(() => vi.restoreAllMocks());

describe('KJ-082 badges', () => {
  it('paints one badge per reported finding, at the end of its line, with the target version', () => {
    const { editor, painted } = editorFor(FILE, TEXT);
    (vscode.window as any).visibleTextEditors = [editor];
    const badges = new DependencyUpgradeBadgeProvider(provider, () => enabled);
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    const last = painted[painted.length - 1];
    expect(last.decorations).toHaveLength(2);
    expect(last.decorations.map(d => (d.renderOptions as any).after.contentText)).toEqual(['↑ 3.0.0', 'pin 4.12.0']);
    expect(last.decorations[0].range.start.line).toBe(1);
    expect(last.decorations[0].range.start.character).toBe('retrofit = "2.9.0"'.length);
    expect(probeSnapshot().dependencyUpgrades).toBe(2);
    expect(probeTexts('dependencyUpgrades')).toEqual(['↑ 3.0.0', 'pin 4.12.0']);
    badges.dispose();
  });

  it('repaints to nothing when the findings go, and paints nothing when the setting is off', () => {
    const { editor, painted } = editorFor(FILE, TEXT);
    (vscode.window as any).visibleTextEditors = [editor];
    const badges = new DependencyUpgradeBadgeProvider(provider, () => enabled);
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    provider.clear();
    expect(painted[painted.length - 1].decorations).toEqual([]);
    expect(probeSnapshot().dependencyUpgrades).toBe(0);
    enabled = false;
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    expect(painted[painted.length - 1].decorations).toEqual([]);
    badges.dispose();
  });

  it('an editor on another file gets no badge from this one', () => {
    const { editor, painted } = editorFor('/w/app/build.gradle.kts', 'plugins {}\n');
    (vscode.window as any).visibleTextEditors = [editor];
    const badges = new DependencyUpgradeBadgeProvider(provider, () => enabled);
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    expect(painted.every(p => p.decorations.length === 0)).toBe(true);
    badges.dispose();
  });
});
