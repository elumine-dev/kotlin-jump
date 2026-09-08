// Regression tests for the fifth audit (2026-09-08): Java locals, the adb
// watcher on a missing binary, Google's Maven for AndroidX, the sources bar.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as vscodeMock from './__mocks__/vscode';
import { resolveLocalScope } from '../../src/providers/DefinitionProvider';
import { isJavaMethodHeader, buildLocalScopeIndex } from '../../src/util/LocalScopeIndex';
import { defaultRepoFor, sourcesJarUrl, sourcesJarSha1Url } from '../../src/http/MavenCoordinatesParser';
import { SourcesStatusBar } from '../../src/ui/SourcesStatusBar';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const spawned: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void; pid: number }> = [];
vi.mock('../../src/android/AdbBinary', () => ({
  spawnAdb: () => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {}, pid: 1 });
    spawned.push(proc);
    return proc;
  },
  listConnectedDevices: async () => [],
  invalidateAdbPathCache: () => {},
}));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Java local scope (was: FUN_RE only knew `fun`, so a Java parameter resolved to a workspace symbol and F2 renamed the workspace)', () => {
  it('recognises method headers and rejects statements', () => {
    for (const ok of ['    public static void main(String[] args) {', '    private List<User> load(int page, @Nullable String q) throws IOException {', '    public Foo(int a) {', '    @Override public void onStart() {', '    void run() {'])
      expect(isJavaMethodHeader(ok), ok).toBe(true);
    for (const no of ['        if (x > 0) {', '        int y = compute(a);', '        foo.bar(x);', '        return build(a, b);', '        } else if (y) {', '        list.forEach(item -> print(item));'])
      expect(isJavaMethodHeader(no), no).toBe(false);
  });

  it('resolves parameters, locals and lambda parameters to their declaration inside the method', () => {
    const code = [
      'public class Repo {',
      '    private final Api api;',
      '    public User load(int id, final String name) {',
      '        User user = api.get(id);',
      '        items.forEach(item -> log(item, name));',
      '        for (String tag : tags) { log(tag, user); }',
      '        return user;',
      '    }',
      '    private String name = "field";',
      '}',
    ].join('\n');
    const doc = mockDocument('file:///Repo.java', code);
    const at = (line: number, col: number, word: string) => resolveLocalScope(doc, new vscodeMock.Position(line, col), word);
    expect(at(3, 23, 'id')?.range.start).toMatchObject({ line: 2 });
    expect(at(4, 38, 'name')?.range.start).toMatchObject({ line: 2 });
    expect(at(6, 15, 'user')?.range.start).toMatchObject({ line: 3, character: 13 });
    expect(at(4, 33, 'item')?.range.start).toMatchObject({ line: 4 });
    expect(at(5, 43, 'tag')?.range.start).toMatchObject({ line: 5 });
    expect(at(8, 20, 'name')).toBeUndefined(); // the field, outside any method
    expect(at(3, 20, 'api')).toBeUndefined();  // a field, never local
  });

  it('keeps the Kotlin behaviour when the language is kotlin', () => {
    const idx = buildLocalScopeIndex(['fun f(a: Int) {', '  val b = a', '}'], 'kotlin');
    expect(Array.from(idx.enclosingFun)).toEqual([0, 0, -1]); // the closing brace line is outside the function
  });
});

describe('AdbDeviceWatcher — missing binary (was: spawn() does not throw, the banner never showed and the watcher retried every 3 s)', () => {
  it('emits adb-missing on ENOENT, falls back to polling, and adb-found once a spawn succeeds', async () => {
    vi.useFakeTimers();
    const { AdbDeviceWatcher } = await import('../../src/android/AdbDeviceWatcher');
    const events: string[] = [];
    const w = new AdbDeviceWatcher();
    w.on('adb-missing', () => events.push('missing'));
    w.on('adb-found', () => events.push('found'));
    w.start();
    const first = spawned.at(-1)!;
    first.emit('error', Object.assign(new Error('spawn adb ENOENT'), { code: 'ENOENT' }));
    first.emit('close', null);
    expect(events).toEqual(['missing']);
    const before = spawned.length;
    await vi.advanceTimersByTimeAsync(3_500);
    expect(spawned.length).toBe(before); // no 3 s retry storm: polling took over
    w.start();
    spawned.at(-1)!.emit('spawn');
    expect(events).toEqual(['missing', 'found']);
    w.dispose();
  });
});

describe('Sources download — repository per coordinate (was: androidx always 404 on Maven Central)', () => {
  it('routes AndroidX and Google libraries to Google\'s Maven, jar and sha1 alike', () => {
    const androidx = { group: 'androidx.compose.ui', artifact: 'ui', version: '1.6.0' };
    const central = { group: 'com.squareup.okhttp3', artifact: 'okhttp', version: '4.12.0' };
    expect(defaultRepoFor(androidx)).toBe('https://dl.google.com/dl/android/maven2');
    expect(sourcesJarUrl(androidx)).toBe('https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui/1.6.0/ui-1.6.0-sources.jar');
    expect(sourcesJarSha1Url(androidx)).toContain('dl.google.com');
    expect(sourcesJarUrl(central)).toContain('repo.maven.apache.org');
  });
});

describe('Sources status bar (was: "3/10 libs missing" for 7 missing, and no reaction to the setting)', () => {
  it('shows missing/total and hides when indexSourcesJars goes off', () => {
    const bar = new SourcesStatusBar();
    const item = (bar as any).item;
    bar.setState({ scanning: false, libsIndexed: 3, missingCoords: 7, jdk: 'ok', bundledStdlib: true, networkError: false });
    expect(item.text).toContain('7/10 libs missing');
    let enabled = false;
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => k === 'indexSourcesJars' ? enabled : d } as any);
    const hide = vi.spyOn(item, 'hide');
    bar.onConfigurationChanged({ affectsConfiguration: (k: string) => k === 'kotlinJump.indexSourcesJars' } as any);
    expect(hide).toHaveBeenCalled();
    enabled = true;
    const show = vi.spyOn(item, 'show');
    bar.onConfigurationChanged({ affectsConfiguration: (k: string) => k === 'kotlinJump.indexSourcesJars' } as any);
    expect(show).toHaveBeenCalled();
    bar.dispose();
  });
});
