import { describe, it, expect } from 'vitest';
import { UpgradeSession } from '../../src/providers/UpgradeSession';
import { UpgradeEngine } from '../../src/upgrades/UpgradeEngine';
import { MemoryCacheStore } from '../../src/upgrades/cache';
import type { CacheEntry } from '../../src/upgrades/model';

/**
 * KJ-082, the session between the editor and the engine: which Gradle files a
 * workspace folder holds, their texts, and one evaluation of the whole
 * project at a time. Texts are cached so a hover costs no disk read; a saved
 * file invalidates its own text, a watcher event invalidates the list.
 */

const TOML = '[versions]\nretrofit = "2.9.0"\n\n[libraries]\nr = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }\n';
const SETTINGS = 'dependencyResolutionManagement { repositories { google(); mavenCentral() } }\n';
const WRAPPER = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.2.1-bin.zip\n';

function fakeSource(files: Record<string, string>) {
  const reads: string[] = [];
  const lists: string[] = [];
  const texts = { ...files };
  return {
    reads, lists, texts,
    source: {
      list: async (folder: string) => { lists.push(folder); return Object.keys(texts).filter(p => p.startsWith(`${folder}/`)); },
      read: async (p: string) => { reads.push(p); return texts[p]; },
    },
  };
}

const FILES = { '/w/gradle/libs.versions.toml': TOML, '/w/settings.gradle.kts': SETTINGS, '/w/gradle/wrapper/gradle-wrapper.properties': WRAPPER, '/w/app/build.gradle.kts': 'plugins {}\n', '/w/README.md': 'not gradle' };
const SEED: Record<string, CacheEntry> = {
  'google/_master': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', groups: [] },
  'central/com/squareup/retrofit2/retrofit': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', versions: ['2.9.0', '3.0.0'] },
  'gradle/_versions': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', gradle: { current: '9.8.2' } },
};

function sessionOn(files = FILES) {
  const engine = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => ({ mode: 'on', workspaceDecision: undefined, sessionGrant: false, trusted: true, customReposOptIn: false }) });
  engine.seed(SEED);
  const fake = fakeSource(files);
  return { session: new UpgradeSession(engine, fake.source, { trusted: () => true }), fake, engine };
}

describe('KJ-082 UpgradeSession', () => {
  it('lists the Gradle files of a folder once, reads each text once, and knows which kind each is', async () => {
    const { session, fake } = sessionOn();
    const files = await session.files('/w');
    expect(files.map(f => f.kind).sort()).toEqual(['build', 'settings', 'toml', 'wrapper']);
    await session.files('/w');
    expect(fake.lists).toEqual(['/w']);
    expect(fake.reads.filter(p => p.endsWith('.toml'))).toHaveLength(1);
    expect(session.textOf('/w/gradle/libs.versions.toml')).toBe(TOML);
    expect(session.folderOf('/w/gradle/libs.versions.toml')).toBe('/w');
  });

  it('evaluates the whole project: repositories from the settings, a verdict per site, the wrapper included', async () => {
    const { session } = sessionOn();
    const { report, ctx } = await session.evaluate('/w');
    expect(ctx.repositories.project.map(r => r.kind)).toEqual(['google', 'mavenCentral']);
    const retrofit = report.findings.find(f => f.dependency.name === 'retrofit')!.verdict;
    expect(retrofit.kind === 'newer' && retrofit.to).toBe('3.0.0');
    const wrapper = report.findings.find(f => f.dependency.kind === 'wrapper')!.verdict;
    expect(wrapper.kind === 'newer' && wrapper.to).toBe('9.8.2');
  });

  it('a changed file is read again after invalidation, the list is kept; a folder invalidation lists again', async () => {
    const { session, fake } = sessionOn();
    await session.files('/w');
    fake.texts['/w/gradle/libs.versions.toml'] = TOML.replace('2.9.0', '3.0.0');
    session.invalidate('/w/gradle/libs.versions.toml');
    const files = await session.files('/w');
    expect(files.find(f => f.kind === 'toml')!.text).toContain('3.0.0');
    expect(fake.lists).toEqual(['/w']);
    session.invalidate();
    await session.files('/w');
    expect(fake.lists).toEqual(['/w', '/w']);
  });

  it('a folder without Gradle files evaluates to an empty report', async () => {
    const { session } = sessionOn({ '/w/README.md': 'x' });
    const { report } = await session.evaluate('/w');
    expect(report.findings).toEqual([]);
  });
});
