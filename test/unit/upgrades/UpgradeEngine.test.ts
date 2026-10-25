import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UpgradeEngine, fileKindOf, readProjectContext, type GradleFile } from '../../../src/upgrades/UpgradeEngine';
import { MemoryCacheStore } from '../../../src/upgrades/cache';
import type { FetchRequest, FetchResponse } from '../../../src/upgrades/fetchQueue';
import type { ConsentInput } from '../../../src/upgrades/consent';
import type { CacheEntry, Finding } from '../../../src/upgrades/model';
import matrix from '../../../src/data/agp-gradle-matrix.json';

/**
 * KJ-082, the engine end to end on the demo project, against recorded
 * answers: no network in `npm test`.
 *
 * What a user gets: before anything is fetched every version is pending and
 * nothing is said; after one refresh under consent, retrofit, gson, the
 * shared compose entry (moved only as far as every member allows), the Compose
 * BOM on Google Maven, the Kotlin plugins through one request for the whole
 * family, the Android Gradle plugin and the wrapper each get a verdict. A
 * refusal of consent fetches nothing and says why; without a fetcher nothing
 * is fetched either; a stale mirror is given a second opinion; a shared entry
 * whose members disagree is explained instead of moved.
 */

const DEMO = path.join(__dirname, '../../kotlin-jump-demo');
const read = (rel: string): GradleFile => ({ path: path.join(DEMO, rel), text: fs.readFileSync(path.join(DEMO, rel), 'utf8'), kind: fileKindOf(rel)! });
const FILES: GradleFile[] = [read('gradle/libs.versions.toml'), read('settings.gradle.kts'), read('gradle/wrapper/gradle-wrapper.properties')];

const metadata = (g: string, a: string, versions: string[], lastUpdated = '20260527101500') =>
  `<?xml version="1.0" encoding="UTF-8"?><metadata><groupId>${g}</groupId><artifactId>${a}</artifactId><versioning><latest>${versions[versions.length - 1]}</latest><release>${versions[versions.length - 1]}</release><versions>${versions.map(v => `<version>${v}</version>`).join('')}</versions><lastUpdated>${lastUpdated}</lastUpdated></versioning></metadata>`;
const groupIndex = (group: string, artifacts: Record<string, string[]>) =>
  `<?xml version='1.0' encoding='UTF-8'?><${group}>${Object.entries(artifacts).map(([a, v]) => `<${a} versions="${v.join(',')}"/>`).join('')}</${group}>`;
const MASTER = `<?xml version='1.0' encoding='UTF-8'?><metadata><androidx.compose.ui/><androidx.compose.foundation/><androidx.compose/><androidx.core/><androidx.appcompat/><androidx.activity/><androidx.fragment/><androidx.lifecycle/><androidx.navigation/><androidx.compose.material3/><androidx.room/><androidx.test.espresso/><com.android.tools.build/><com.android.application/><com.android.library/><com.google.dagger.hilt.android/></metadata>`;

/** A repository on paper: url to body, plus a call log. */
function recorded(bodies: Record<string, string | number>) {
  const calls: string[] = [];
  const fetcher = async (req: FetchRequest): Promise<FetchResponse> => {
    calls.push(req.url);
    const hit = Object.entries(bodies).find(([k]) => req.url.includes(k));
    if (!hit) return { status: 404, headers: {}, body: 'not found' };
    if (typeof hit[1] === 'number') return { status: hit[1], headers: {}, body: '' };
    return { status: 200, headers: { etag: `"${hit[0]}"` }, body: hit[1] };
  };
  return { fetcher, calls };
}

const BODIES: Record<string, string> = {
  'master-index.xml': MASTER,
  'androidx/compose/ui/group-index.xml': groupIndex('androidx.compose.ui', { ui: ['1.6.2', '1.6.8', '1.7.0'], 'ui-tooling': ['1.6.2', '1.6.8', '1.7.0'], 'ui-tooling-preview': ['1.6.2', '1.6.8', '1.7.0'] }),
  'androidx/compose/foundation/group-index.xml': groupIndex('androidx.compose.foundation', { foundation: ['1.6.2', '1.6.8'] }),
  'androidx/compose/group-index.xml': groupIndex('androidx.compose', { 'compose-bom': ['2024.02.00', '2024.09.03'] }),
  'com/android/tools/build/group-index.xml': groupIndex('com.android.tools.build', { gradle: ['8.2.0', '8.7.0', '9.0.0-alpha01'] }),
  'com/squareup/retrofit2/retrofit/maven-metadata.xml': metadata('com.squareup.retrofit2', 'retrofit', ['2.9.0', '2.11.0', '3.0.0']),
  'com/squareup/retrofit2/converter-gson/maven-metadata.xml': metadata('com.squareup.retrofit2', 'converter-gson', ['2.9.0', '2.11.0', '3.0.0']),
  'com/google/code/gson/gson/maven-metadata.xml': metadata('com.google.code.gson', 'gson', ['2.10.1', '2.11.0', '2.12.0-rc1']),
  'org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml': metadata('org.jetbrains.kotlin', 'kotlin-gradle-plugin', ['1.9.22', '2.0.21', '2.1.0-Beta1']),
  'services.gradle.org/versions/current': '{"version":"9.8.2","current":true,"snapshot":false,"nightly":false,"activeRc":false,"rcFor":""}',
};

const consent = (over: Partial<ConsentInput> = {}): ConsentInput => ({ mode: 'on', workspaceDecision: undefined, sessionGrant: false, trusted: true, customReposOptIn: false, ...over });
const quiet = { spacingMs: 0, sleep: async () => {} };

function engineOn(bodies = BODIES, over: Partial<ConsentInput> = {}, now = () => 1_700_000_000_000) {
  const { fetcher, calls } = recorded(bodies);
  const engine = new UpgradeEngine({ store: new MemoryCacheStore(), fetcher, now, policy: () => 'preferStable', consent: () => consent(over), matrix, queue: quiet });
  return { engine, calls };
}

const verdictOfName = (findings: Finding[], name: string) => findings.find(f => f.dependency.name === name)!.verdict;

describe('KJ-082 UpgradeEngine on the demo project', () => {
  const ctx = readProjectContext(FILES, true);

  it('before any refresh, every exact version is pending and nothing is reported', () => {
    const { engine } = engineOn();
    const report = engine.evaluate(FILES, ctx);
    expect(report.catalogUnparsed).toBe(false);
    expect(report.pendingKeys.length).toBeGreaterThan(10);
    expect(report.findings.every(f => f.verdict.kind !== 'newer')).toBe(true);
    expect(verdictOfName(report.findings, 'retrofit')).toEqual({ kind: 'unknown', reason: 'pending' });
  });

  it('one refresh under consent fetches the master index first, one group index per Google group, one request for the Kotlin family, and fires onDidChange once', async () => {
    const { engine, calls } = engineOn();
    const fired: number[] = [];
    engine.onDidChange(keys => fired.push(keys.size));
    const r = await engine.refresh(FILES, ctx);
    expect(r.skipped).toBeUndefined();
    expect(calls[0]).toContain('master-index.xml');
    expect(calls.filter(u => u.includes('androidx/compose/ui/group-index.xml'))).toHaveLength(1);
    expect(calls.filter(u => u.includes('kotlin-gradle-plugin/maven-metadata.xml'))).toHaveLength(1);
    expect(calls.some(u => u.includes('services.gradle.org/versions/current'))).toBe(true);
    expect(fired).toHaveLength(1);
    expect(r.fetched).toBeGreaterThan(5);

    const report = engine.evaluate(FILES, ctx);
    const retrofit = verdictOfName(report.findings, 'retrofit');
    expect(retrofit.kind).toBe('newer');
    if (retrofit.kind === 'newer') {
      expect(retrofit.to).toBe('3.0.0');
      expect(retrofit.stability).toBe('stable');
      expect(retrofit.candidate.newerCount).toBe(2);
      expect(retrofit.candidate.releasedAt).toBe('2026-05-27');
      expect(retrofit.candidate.repository).toBe('mavenCentral');
    }
    // gson: a preview exists but the policy prefers stable.
    const gson = verdictOfName(report.findings, 'gson');
    expect(gson.kind === 'newer' && gson.to).toBe('2.11.0');
    // compose: the shared entry moves only as far as foundation allows.
    const compose = verdictOfName(report.findings, 'compose');
    expect(compose.kind === 'newer' && compose.to).toBe('1.6.8');
    // the BOM lives on Google Maven under androidx.compose.
    expect(verdictOfName(report.findings, 'compose-bom').kind === 'newer').toBe(true);
    // the Kotlin plugins, one family request.
    const kotlin = verdictOfName(report.findings, 'kotlin');
    expect(kotlin.kind === 'newer' && kotlin.to).toBe('2.0.21');
    // AGP and the wrapper.
    expect(verdictOfName(report.findings, 'agp').kind === 'newer' && (verdictOfName(report.findings, 'agp') as any).to).toBe('8.7.0');
    const wrapper = verdictOfName(report.findings, 'Gradle');
    expect(wrapper.kind === 'newer' && wrapper.to).toBe('9.8.2');
    // a library the recorded repositories never heard of stays unknown, not reported.
    expect(verdictOfName(report.findings, 'turbine')).toEqual({ kind: 'unknown', reason: 'notFound' });
    expect(report.pendingKeys).toEqual([]);
  });

  it('a second refresh serves everything from the cache and fetches nothing', async () => {
    const { engine, calls } = engineOn();
    await engine.refresh(FILES, ctx);
    const before = calls.length;
    const r = await engine.refresh(FILES, ctx);
    expect(calls.length).toBe(before);
    expect(r.fetched).toBe(0);
    expect(r.fromCache).toBeGreaterThan(5);
  });

  it('without consent nothing is fetched and the verdicts say so; without a fetcher likewise', async () => {
    const { engine, calls } = engineOn(BODIES, { mode: 'ask' });
    const r = await engine.refresh(FILES, ctx);
    expect(r.skipped).toBe('noConsent');
    expect(calls).toEqual([]);
    expect(verdictOfName(engine.evaluate(FILES, ctx).findings, 'retrofit')).toEqual({ kind: 'unknown', reason: 'noConsent' });

    const offline = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => consent(), matrix });
    expect((await offline.refresh(FILES, ctx)).skipped).toBe('noFetcher');
    expect(verdictOfName(offline.evaluate(FILES, ctx).findings, 'retrofit')).toEqual({ kind: 'unknown', reason: 'noFetcher' });
  });

  it('the explicit command grants consent for the session', async () => {
    const { engine, calls } = engineOn(BODIES, { mode: 'ask' });
    engine.grantConsentForSession();
    expect((await engine.refresh(FILES, ctx)).skipped).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('a mirror that does not list the version in use gets a second opinion from the other repository', async () => {
    const TOML = '[versions]\nksp = "2.2.21-2.0.5"\n\n[libraries]\nksp-api = { module = "com.google.devtools.ksp:symbol-processing-api", version.ref = "ksp" }\n';
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: TOML, kind: 'toml' }];
    const bodies = {
      'master-index.xml': `<?xml version='1.0'?><metadata><com.google.devtools.ksp/></metadata>`,
      'com/google/devtools/ksp/group-index.xml': groupIndex('com.google.devtools.ksp', { 'symbol-processing-api': ['1.5.30-1.0.0'] }),
      'com/google/devtools/ksp/symbol-processing-api/maven-metadata.xml': metadata('com.google.devtools.ksp', 'symbol-processing-api', ['1.5.30-1.0.0', '2.2.21-2.0.5', '2.3.12']),
    };
    const { engine, calls } = engineOn(bodies);
    const c = readProjectContext(files, true);
    await engine.refresh(files, c);
    expect(calls.some(u => u.includes('symbol-processing-api/maven-metadata.xml'))).toBe(true);
    const v = verdictOfName(engine.evaluate(files, c).findings, 'ksp');
    expect(v.kind === 'newer' && v.to).toBe('2.3.12');
  });

  it('a shared entry whose members disagree is explained, never moved', async () => {
    const TOML = '[versions]\nkiosk = "1.0.0"\n\n[libraries]\ncore = { module = "com.example.kiosk:core", version.ref = "kiosk" }\nui = { module = "com.example.kiosk:ui", version.ref = "kiosk" }\n';
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: TOML, kind: 'toml' }];
    const bodies = {
      'master-index.xml': `<?xml version='1.0'?><metadata><androidx.core/></metadata>`,
      'com/example/kiosk/core/maven-metadata.xml': metadata('com.example.kiosk', 'core', ['1.0.0', '1.1.0', '1.2.0']),
      'com/example/kiosk/ui/maven-metadata.xml': metadata('com.example.kiosk', 'ui', ['1.0.0']),
    };
    const { engine } = engineOn(bodies);
    const c = readProjectContext(files, true);
    await engine.refresh(files, c);
    const v = verdictOfName(engine.evaluate(files, c).findings, 'kiosk');
    expect(v).toEqual({ kind: 'unknown', reason: 'membersDisagree', detail: 'com.example.kiosk:core 1.2.0' });
  });

  it('the rails read the project: a KSP built for another Kotlin is reported with the matching one', async () => {
    const TOML = '[versions]\nkotlin = "1.9.22"\nksp = "1.9.20-1.0.14"\n\n[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }\nksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }\n';
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: TOML, kind: 'toml' }];
    const bodies = {
      'kotlin-gradle-plugin/maven-metadata.xml': metadata('org.jetbrains.kotlin', 'kotlin-gradle-plugin', ['1.9.20', '1.9.22']),
      'symbol-processing-gradle-plugin/maven-metadata.xml': metadata('com.google.devtools.ksp', 'symbol-processing-gradle-plugin', ['1.9.20-1.0.14', '1.9.22-1.0.17', '1.9.22-1.0.18', '2.0.21-1.0.28']),
    };
    const { engine } = engineOn(bodies);
    const c = readProjectContext(files, true);
    await engine.refresh(files, c);
    const report = engine.evaluate(files, c);
    expect(report.rails).toHaveLength(1);
    expect(report.rails[0].rail).toBe('ksp-kotlin');
    expect(report.rails[0].compatiblePick).toBe('1.9.22-1.0.18');
    expect(report.rails[0].edits?.[0].newText).toBe('1.9.22-1.0.18');
  });

  it('a site read by libraries and a Kotlin plugin routes the plugin member through the Kotlin family, not as a library', async () => {
    // On the reference project `kotlin` is read by kotlin-reflect, kotlin-test-junit AND the
    // compose compiler plugin; the plugin marker asked as a library returned 404 and the
    // whole site went unknown.
    const TOML = '[versions]\nkotlin = "2.0.21"\n\n[libraries]\nreflect = { module = "org.jetbrains.kotlin:kotlin-reflect", version.ref = "kotlin" }\n\n[plugins]\ncompose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }\n';
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: TOML, kind: 'toml' }];
    const bodies = {
      'master-index.xml': `<?xml version='1.0'?><metadata><androidx.core/></metadata>`,
      'org/jetbrains/kotlin/kotlin-reflect/maven-metadata.xml': metadata('org.jetbrains.kotlin', 'kotlin-reflect', ['2.0.21', '2.1.0']),
      'org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml': metadata('org.jetbrains.kotlin', 'kotlin-gradle-plugin', ['2.0.21', '2.1.0']),
    };
    const { engine, calls } = engineOn(bodies);
    const c = readProjectContext(files, true);
    await engine.refresh(files, c);
    expect(calls.some(u => u.includes('kotlin-gradle-plugin/maven-metadata.xml'))).toBe(true);
    expect(calls.some(u => u.includes('plugin/compose/org.jetbrains.kotlin.plugin.compose.gradle.plugin'))).toBe(false);
    const v = verdictOfName(engine.evaluate(files, c).findings, 'kotlin');
    expect(v.kind === 'newer' && v.to).toBe('2.1.0');
  });

  it('a plugin the portal does not know is looked up on Maven Central and then on Google Maven, as a marker', async () => {
    // google-services, firebase-perf and crashlytics are published on Google Maven only.
    const TOML = '[versions]\ngms = "4.4.2"\n\n[plugins]\ngoogle-services = { id = "com.google.gms.google-services", version.ref = "gms" }\n';
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: TOML, kind: 'toml' }];
    const bodies = {
      'com/google/gms/google-services/group-index.xml': groupIndex('com.google.gms.google-services', { 'com.google.gms.google-services.gradle.plugin': ['4.4.2', '4.4.3', '4.5.0'] }),
    };
    const { engine, calls } = engineOn(bodies);
    const c = readProjectContext(files, true);
    await engine.refresh(files, c);
    expect(calls.filter(u => u.includes('google-services')).length).toBeGreaterThanOrEqual(2);
    const v = verdictOfName(engine.evaluate(files, c).findings, 'gms');
    expect(v.kind === 'newer' && v.to).toBe('4.5.0');
  });

  it('seeded answers serve the demo without a fetcher, and the ignore list holds an entry back', () => {
    const seed: Record<string, CacheEntry> = {
      'google/_master': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', groups: ['androidx.compose.ui'] },
      'central/com/squareup/retrofit2/retrofit': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', versions: ['2.9.0', '3.0.0'], lastUpdated: '20250527000000' },
      'central/com/squareup/retrofit2/converter-gson': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', versions: ['2.9.0', '3.0.0'] },
    };
    const engine = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => consent({ mode: 'off' }), matrix, ignore: () => ['com.google.code.gson:gson'] });
    engine.seed(seed);
    const report = engine.evaluate(FILES, ctx);
    const retrofit = verdictOfName(report.findings, 'retrofit');
    expect(retrofit.kind === 'newer' && retrofit.to).toBe('3.0.0');
    expect(retrofit.kind === 'newer' && retrofit.candidate.releasedAt).toBe('2025-05-27');
    expect(verdictOfName(report.findings, 'gson')).toEqual({ kind: 'pinned', by: 'ignore-marker' });
  });

  it('evaluates a warm 160 entry catalog in a few milliseconds', () => {
    const versions = Array.from({ length: 160 }, (_, i) => `k${i} = "1.${i}.0"`).join('\n');
    const libs = Array.from({ length: 160 }, (_, i) => `lib${i} = { module = "com.example.kiosk:lib${i}", version.ref = "k${i}" }`).join('\n');
    const files: GradleFile[] = [{ path: '/w/gradle/libs.versions.toml', text: `[versions]\n${versions}\n\n[libraries]\n${libs}\n`, kind: 'toml' }];
    const seed: Record<string, CacheEntry> = { 'google/_master': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', groups: [] } };
    for (let i = 0; i < 160; i++) seed[`central/com/example/kiosk/lib${i}`] = { v: 1, url: 'x', fetchedAt: 1, status: 'ok', versions: [`1.${i}.0`, `1.${i}.1`, `2.0.0`] };
    const engine = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => consent(), matrix });
    engine.seed(seed);
    const c = readProjectContext(files, true);
    engine.evaluate(files, c);
    const t0 = performance.now();
    const report = engine.evaluate(files, c);
    const ms = performance.now() - t0;
    expect(report.findings.filter(f => f.verdict.kind === 'newer')).toHaveLength(160);
    // The budget is 5 ms on a quiet machine; the guard leaves room for a loaded CI runner.
    expect(ms).toBeLessThan(40);
  });

  it('a wrapper bump writes the URL, and refuses when a checksum line exists and no checksum is given', () => {
    const { engine } = engineOn();
    const wrapper = FILES[2];
    const finding: Finding = { dependency: engine.collect([wrapper]).dependencies[0], verdict: { kind: 'unknown', reason: 'pending' } };
    const edits = engine.bumpEdits(finding, '9.8.2', f => (f === wrapper.path ? wrapper.text : undefined));
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe('9.8.2');
    const withSum = `${wrapper.text}distributionSha256Sum=abc\n`;
    expect(engine.bumpEdits(finding, '9.8.2', () => withSum)).toEqual([]);
    expect(engine.bumpEdits(finding, '9.8.2', () => withSum, { wrapperSha256: 'f'.repeat(64) })).toHaveLength(2);
  });
});
