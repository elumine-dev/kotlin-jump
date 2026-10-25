import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { DependencyUpgradeProvider } from '../../src/providers/DependencyUpgradeProvider';
import { collectCatalogDependencies } from '../../src/upgrades/catalogDependencies';
import type { Dependency, Finding, RailFinding } from '../../src/upgrades/model';

/**
 * KJ-082, the VS Code shell of dependency upgrades: diagnostics, quick fixes,
 * hover, and what happens when the file changes under them.
 *
 * Only a newer version or a dynamic version with a pin is underlined; the
 * quiet verdicts (up to date, unknown, pinned, rich, managed by a BOM) only
 * answer in the hover. A quick fix is offered against the CURRENT text and
 * replaces the bare literal through a Position based edit. After an edit the
 * findings of the file are re-anchored by key: the entry that changed loses
 * its underline, the others keep theirs at their new line. Findings published
 * for an open file are forgotten when it closes; findings the command
 * published for the whole workspace stay until they are cleared.
 */

const FILE = '/w/gradle/libs.versions.toml';
const TEXT = [
  '[versions]',
  'retrofit = "2.9.0"',
  'gson = "2.10.1"',
  'okhttp = "4.+"',
  'navigation = "2.7.6"',
  'material3 = "1.2.0"',
  'ksp = "1.9.20-1.0.14"',
  '',
  '[libraries]',
  'retrofit-core = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }',
  'gson = { module = "com.google.code.gson:gson", version.ref = "gson" }',
  'okhttp-core = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }',
  'navigation-ui = { module = "androidx.navigation:navigation-ui-ktx", version.ref = "navigation" }',
  'material3 = { module = "androidx.compose.material3:material3", version.ref = "material3" }',
  '',
  '[plugins]',
  'ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }',
  '',
].join('\n');

function doc(path: string, text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const positionAt = (offset: number) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
    return new vscode.Position(line, offset - starts[line]);
  };
  const offsetAt = (p: vscode.Position) => starts[p.line] + p.character;
  const lines = text.split('\n');
  return {
    uri: vscode.Uri.file(path), fileName: path, lineCount: lines.length,
    getText: (range?: vscode.Range) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    positionAt, offsetAt,
    lineAt: (line: number) => ({ text: lines[line], lineNumber: line }),
  } as unknown as vscode.TextDocument;
}

const deps = collectCatalogDependencies(TEXT, FILE).dependencies;
const dep = (name: string): Dependency => deps.find(d => d.name === name)!;
const candidate = (versions: string[], pick: string | undefined) => ({ latest: versions[versions.length - 1], latestStable: pick, pick, versions, newerCount: versions.length - 1, currentKnown: true, fetchedAt: 1_000, stale: false, repository: 'mavenCentral' as const });
const newer = (name: string, to: string, versions: string[]): Finding => ({ dependency: dep(name), verdict: { kind: 'newer', to, stability: 'stable', candidate: candidate(versions, to) } });

const FINDINGS: Finding[] = [
  newer('retrofit', '3.0.0', ['2.9.0', '2.11.0', '3.0.0']),
  { dependency: dep('gson'), verdict: { kind: 'upToDate', candidate: candidate(['2.10.1'], undefined) } },
  { dependency: dep('okhttp'), verdict: { kind: 'rich', form: 'dynamic', pin: '4.12.0' } },
  newer('navigation', '2.7.7', ['2.7.6', '2.7.7']),
  newer('material3', '1.2.1', ['1.2.0', '1.2.1']),
  newer('ksp', '2.0.21-1.0.28', ['1.9.20-1.0.14', '1.9.22-1.0.18', '2.0.21-1.0.28']),
];
const ksp = dep('ksp');
const RAILS: RailFinding[] = [{
  rail: 'ksp-kotlin', dependency: ksp, expected: '1.9.22', actual: '1.9.20', compatiblePick: '1.9.22-1.0.18',
  message: 'ksp 1.9.20-1.0.14 targets Kotlin 1.9.20, this build uses Kotlin 1.9.22. Latest for Kotlin 1.9.22 is 1.9.22-1.0.18',
  edits: [{ file: FILE, start: ksp.versionSite!.start, end: ksp.versionSite!.end, newText: '1.9.22-1.0.18' }],
}];

const bump = (f: Finding, to: string) => (f.dependency.versionSite ? [{ file: FILE, start: f.dependency.versionSite.start, end: f.dependency.versionSite.end, newText: to }] : []);
let provider: DependencyUpgradeProvider;
let texts: Map<string, string>;
const entries = () => (provider as any).collection._entries as Map<string, vscode.Diagnostic[]>;

beforeEach(() => {
  texts = new Map([[FILE, TEXT]]);
  provider = new DependencyUpgradeProvider({ policy: () => 'preferStable', bump, textOf: f => texts.get(f), now: () => 1_000 + 7_200_000 });
});

describe('KJ-082 provider: diagnostics', () => {
  it('underlines the newer versions and the dynamic version, nothing else, with the right severity, code and range', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, RAILS, 'open');
    const diags = entries().get(FILE)!;
    const byLine = new Map(diags.map(d => [d.range.start.line, d]));
    expect([...byLine.keys()].sort()).toEqual([1, 3, 4, 5, 6]);
    const retrofit = byLine.get(1)!;
    expect(retrofit.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(retrofit.message).toBe('retrofit 2.9.0: newer stable 3.0.0, 2 versions behind');
    expect((retrofit.code as any).value).toBe('outdated-dependency');
    expect(retrofit.source).toBe('kotlin-jump');
    expect(TEXT.split('\n')[1].slice(retrofit.range.start.character, retrofit.range.end.character)).toBe('"2.9.0"');
    expect(byLine.get(3)!.severity).toBe(vscode.DiagnosticSeverity.Information);
    expect((byLine.get(3)!.code as any).value).toBe('dynamic-version');
    // The KSP rail is a diagnostic of its own, on top of the plain bump.
    const onKsp = diags.filter(d => d.range.start.line === 6);
    expect(onKsp.map(d => (d.code as any).value).sort()).toEqual(['incompatible-upgrade', 'outdated-dependency']);
  });

  it('a file without a reported finding has no entry, and clear empties the panel', () => {
    provider.setFindings(FILE, 'toml', TEXT, [FINDINGS[1]], [], 'open');
    expect(entries().has(FILE)).toBe(false);
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    expect(entries().get(FILE)!.length).toBeGreaterThan(0);
    provider.clear();
    expect(entries().size).toBe(0);
    expect(provider.findingsFor(FILE)).toBeUndefined();
  });
});

describe('KJ-082 provider: quick fixes', () => {
  it('offers the bump first, preferred, with a Position based edit on the bare literal, then the pin comment', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    const actions = provider.provideCodeActions(doc(FILE, TEXT), new vscode.Range(1, 12, 1, 12));
    expect(actions.map(a => a.title)).toEqual(['Bump retrofit to 3.0.0', 'Pin retrofit at 2.9.0 with # @pin']);
    expect(actions[0].isPreferred).toBe(true);
    const e = (actions[0].edit as any)._entries[0];
    expect(e.range.start.line).toBe(1);
    expect(TEXT.split('\n')[1].slice(e.range.start.character, e.range.end.character)).toBe('2.9.0');
    expect(e.newText).toBe('3.0.0');
    expect(e.metadata).toBeUndefined();
  });

  it('two patch bumps in the file add a bulk action that runs the apply command', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    const actions = provider.provideCodeActions(doc(FILE, TEXT), new vscode.Range(4, 14, 4, 14));
    const bulk = actions.find(a => a.title === 'Bump all 2 patch versions in this file')!;
    expect(bulk.command).toEqual({ command: 'kotlin-jump.applyDependencyUpgrades', title: bulk.title, arguments: [FILE, 'patch'] });
    expect(bulk.edit).toBeUndefined();
  });

  it('nothing is offered when the literal no longer matches the text, or on a quiet line', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    const edited = TEXT.replace('retrofit = "2.9.0"', 'retrofit = "2.9.1"');
    expect(provider.provideCodeActions(doc(FILE, edited), new vscode.Range(1, 12, 1, 12))).toEqual([]);
    expect(provider.provideCodeActions(doc(FILE, TEXT), new vscode.Range(2, 8, 2, 8))).toEqual([]);
  });

  it('a KSP rail offers the matching KSP as the preferred action and not the plain bump', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, RAILS, 'open');
    const actions = provider.provideCodeActions(doc(FILE, TEXT), new vscode.Range(6, 8, 6, 8));
    expect(actions[0].title).toBe('Bump ksp to 1.9.22-1.0.18, matches Kotlin 1.9.22');
    expect(actions[0].isPreferred).toBe(true);
    expect(actions.some(a => a.title === 'Bump ksp to 2.0.21-1.0.28')).toBe(false);
  });
});

describe('KJ-082 provider: hover, edits, lifecycle', () => {
  it('answers in the hover for a quiet verdict, and nothing off an entry', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    const hover = provider.provideHover(doc(FILE, TEXT), new vscode.Position(2, 9))!;
    expect((hover.contents[0] as vscode.MarkdownString).value).toContain('gson 2.10.1 is the latest stable, checked 2 hours ago');
    expect(provider.provideHover(doc(FILE, TEXT), new vscode.Position(7, 0))).toBeUndefined();
  });

  it('after an edit, the changed entry loses its underline and the others keep theirs at their new line', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, RAILS, 'open');
    const updated: string[] = [];
    provider.onDidUpdate(files => updated.push(...files));
    const edited = TEXT.replace('[versions]\n', '[versions]\n# bumped today\n').replace('retrofit = "2.9.0"', 'retrofit = "3.0.0"');
    texts.set(FILE, edited);
    provider.handleChange(doc(FILE, edited));
    const lines = entries().get(FILE)!.map(d => d.range.start.line).sort();
    expect(lines).toEqual([4, 5, 6, 7, 7]);
    expect(provider.findingsFor(FILE)!.findings.map(f => f.dependency.name)).not.toContain('retrofit');
    expect(provider.findingsFor(FILE)!.rails).toHaveLength(1);
    expect(updated).toEqual([FILE]);
  });

  it('forgets an open file when it closes, keeps what the command published', () => {
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'open');
    provider.handleClose(doc(FILE, TEXT));
    expect(provider.findingsFor(FILE)).toBeUndefined();
    expect(entries().has(FILE)).toBe(false);
    provider.setFindings(FILE, 'toml', TEXT, FINDINGS, [], 'command');
    provider.handleClose(doc(FILE, TEXT));
    expect(provider.findingsFor(FILE)).toBeDefined();
  });

  it('a disabled fix reaches the menu greyed out with its reason', () => {
    const agpText = '[versions]\nagp = "8.2.0"\n\n[plugins]\nandroid = { id = "com.android.application", version.ref = "agp" }\n';
    const agp = collectCatalogDependencies(agpText, FILE).dependencies.find(d => d.name === 'agp')!;
    const wrapper: Dependency = { kind: 'wrapper', key: 'wrapper', members: [{ group: 'org.gradle', artifact: 'gradle' }], group: 'org.gradle', artifact: 'gradle', currentVersion: '8.6', literal: 'exact', range: { file: '/w/gradle/wrapper/gradle-wrapper.properties', start: 0, end: 10 }, line: 0, source: 'wrapper', name: 'Gradle', sharedBy: [] };
    const p = new DependencyUpgradeProvider({
      policy: () => 'preferStable', bump, textOf: () => agpText, now: () => 1,
      wrapperRequirement: () => ({ gradle: '8.9', wrapper, checksumRequired: true }),
    });
    const finding: Finding = { dependency: agp, verdict: { kind: 'newer', to: '8.7.0', stability: 'stable', candidate: candidate(['8.2.0', '8.7.0'], '8.7.0') } };
    p.setFindings(FILE, 'toml', agpText, [finding], [], 'open');
    const actions = p.provideCodeActions(doc(FILE, agpText), new vscode.Range(1, 8, 1, 8));
    expect(actions[0].title).toBe('Bump agp to 8.7.0 and the Gradle wrapper to 8.9');
    expect(actions[0].disabled?.reason).toContain('distributionSha256Sum');
  });
});
