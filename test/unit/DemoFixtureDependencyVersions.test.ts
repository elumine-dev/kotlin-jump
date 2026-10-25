import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UpgradeEngine, fileKindOf, readProjectContext, type GradleFile } from '../../src/upgrades/UpgradeEngine';
import { MemoryCacheStore } from '../../src/upgrades/cache';
import { isReported, tierOf } from '../../src/providers/dependencyUpgrades';
import type { CacheEntry } from '../../src/upgrades/model';
import matrix from '../../src/data/agp-gradle-matrix.json';

/**
 * KJ-082, the recorded answers behind the dependency-upgrades demo.
 *
 * The demo asserts six underlines, a hover with "versions behind", a shared
 * bump that moves four libraries and a bulk of two patch bumps. Those numbers
 * live here, against the real demo catalog, so a change to the fixture TOML or
 * to the seed file breaks a unit test long before a recording does. Every seed
 * key must be one the engine would request: a key with a typo would be an
 * answer nobody reads.
 */

const DEMO = path.join(__dirname, '../kotlin-jump-demo');
const read = (rel: string): GradleFile => ({ path: path.join(DEMO, rel), text: fs.readFileSync(path.join(DEMO, rel), 'utf8'), kind: fileKindOf(rel)! });
const FILES = [read('gradle/libs.versions.toml'), read('settings.gradle.kts'), read('gradle/wrapper/gradle-wrapper.properties'), read('build.gradle.kts')];
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/demo/fixtures/dependency-versions.json'), 'utf8')) as { entries: Record<string, CacheEntry> };

function seeded() {
  const engine = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => ({ mode: 'off', workspaceDecision: undefined, sessionGrant: false, trusted: true, customReposOptIn: false }), matrix });
  engine.seed(SEED.entries);
  const ctx = readProjectContext(FILES, true);
  return { engine, ctx, report: engine.evaluate(FILES, ctx) };
}

describe('KJ-082 demo fixture', () => {
  it('lights exactly the six entries the demo counts, and nothing else', () => {
    const { report } = seeded();
    const lit = report.findings.filter(isReported).map(f => f.dependency.name).sort();
    expect(lit).toEqual(['appcompat', 'compose', 'compose-material3', 'gson', 'navigation', 'retrofit']);
  });

  it('retrofit is three behind with a date, compose moves four libraries, two bumps are patches', () => {
    const { report } = seeded();
    const by = (name: string) => report.findings.find(f => f.dependency.name === name)!;
    const retrofit = by('retrofit').verdict;
    expect(retrofit.kind === 'newer' && retrofit.to).toBe('3.0.0');
    expect(retrofit.kind === 'newer' && retrofit.candidate.newerCount).toBe(3);
    expect(retrofit.kind === 'newer' && retrofit.candidate.releasedAt).toBe('2025-05-27');
    expect(by('compose').dependency.sharedBy).toHaveLength(4);
    const compose = by('compose').verdict;
    expect(compose.kind === 'newer' && compose.to).toBe('1.7.0');
    const patches = report.findings.filter(f => f.verdict.kind === 'newer' && tierOf(f.dependency.currentVersion!, f.verdict.to) === 'patch').map(f => f.dependency.name).sort();
    expect(patches).toEqual(['compose-material3', 'navigation']);
  });

  it('glide is pinned in the catalog, the two plugin versions of the build file carry the marker', () => {
    const { report } = seeded();
    expect(report.findings.find(f => f.dependency.name === 'glide')!.verdict).toEqual({ kind: 'pinned', by: 'pin-comment' });
    const pinnedPlugins = report.findings.filter(f => f.dependency.source === 'build-plugin' && f.verdict.kind === 'pinned');
    expect(pinnedPlugins.map(f => f.dependency.name).sort()).toEqual(['org.jetbrains.compose', 'org.jetbrains.kotlin.jvm']);
  });

  it('every seeded key is one the engine would ask for, first or as a second opinion', () => {
    const { engine, ctx } = seeded();
    const wanted = new Set(engine.keysFor(FILES, ctx));
    for (const key of Object.keys(SEED.entries)) expect(wanted.has(key), key).toBe(true);
  });
});
