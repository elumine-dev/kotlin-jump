import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';
import { importOrNull } from '../kj/harness';
import { collecterUnePasse, sansChevauchement, resumeDesFamilles } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G44, une methode d interface que personne n appelle, et ses surcharges.
 *
 * Oracle : `9b514d8dc2` sur le projet de reference. Kevin y retire a la main la
 * declaration d interface ET la surcharge, par exemple
 * `SystemInfoService.getCurrentMemoryUsage()` et `@Override` dans
 * `SystemInfoServiceImpl`, que rien n appelle. KJ ne voyait ni l une (un membre
 * d interface sans corps n est candidat nulle part) ni l autre (M2, M3, M11 :
 * une surcharge peut etre appelee par son contrat).
 *
 * Quand le contrat et toutes ses implementations sont dans le corpus et que le
 * nom n apparait QUE dans leurs declarations, rien ne peut l appeler. La coupe
 * est liee : la declaration et chaque surcharge partent ensemble, ou rien.
 */

const contracts: any = await importOrNull('src/providers/unusedContracts');

const SEGS = ['test/java', 'test/kotlin', 'androidTest'];
const J = '/w/app/src/main/java/p';
const src = (path: string, ...lines: string[]) => ({ path, text: lines.join('\n') + '\n' });

const SERVICE = src(`${J}/SystemInfoService.java`,
  'package p;',
  '',
  'public interface SystemInfoService {',
  '',
  '\tboolean isChargerConnected();',
  '',
  '\tlong getCurrentMemoryUsage();',
  '}',
);
const IMPL = src(`${J}/SystemInfoServiceImpl.java`,
  'package p;',
  '',
  'public class SystemInfoServiceImpl implements SystemInfoService {',
  '',
  '\t@Override',
  '\tpublic boolean isChargerConnected() {',
  '\t\treturn true;',
  '\t}',
  '',
  '\t@Override',
  '\tpublic long getCurrentMemoryUsage() {',
  '\t\treturn 42L;',
  '\t}',
  '}',
);
const CALLER = src(`${J}/Caller.java`,
  'package p;',
  '',
  'public class Caller {',
  '\t// Une vraie racine : sans elle, tout l ilot est mort et part entier.',
  '\tpublic static void main(String[] args) {',
  '\t\tSystemInfoService s = new SystemInfoServiceImpl();',
  '\t\tSystem.out.println(s.isChargerConnected());',
  '\t}',
  '}',
);

const found = (sources: { path: string; text: string }[]) =>
  (contracts.findUnusedContracts({ sources, testSourceSets: SEGS }) as any[]).map(c => `${c.interfaceName}.${c.name}`);

const applied = (sources: { path: string; text: string }[]) => {
  const { parFichier } = collecterUnePasse(sources, SEGS);
  const out = new Map(sources.map(s => [s.path, s.text]));
  for (const [p, cuts] of parFichier) {
    let t = out.get(p)!;
    for (const c of [...cuts].sort((a, b) => b.start - a.start)) t = t.slice(0, c.start) + c.texte + t.slice(c.end);
    out.set(p, t);
  }
  return out;
};

describe('G44, la paire contrat et surcharge, coupee ensemble', () => {
  it('la paire Java de l oracle est trouvee', () => {
    expect(found([SERVICE, IMPL, CALLER])).toEqual(['SystemInfoService.getCurrentMemoryUsage']);
  });

  it('Remove All coupe la declaration et la surcharge, rien d autre', () => {
    const out = applied([SERVICE, IMPL, CALLER]);
    expect(out.get(SERVICE.path)).not.toContain('getCurrentMemoryUsage');
    expect(out.get(IMPL.path)).not.toContain('getCurrentMemoryUsage');
    expect(out.get(IMPL.path)).not.toContain('42L');
    expect(out.get(SERVICE.path)).toContain('boolean isChargerConnected();');
    expect(out.get(IMPL.path)).toContain('return true;');
    expect((out.get(IMPL.path)!.match(/@Override/g) ?? []).length).toBe(1);
  });

  it('meme forme en Kotlin, deux implementations', () => {
    const k = '/w/app/src/main/java/k';
    const delegate = src(`${k}/MediaPositionDelegate.kt`,
      'package k',
      '',
      'interface MediaPositionDelegate {',
      '    fun currentPosition(): Long',
      '    fun computeSeek(percent: Int): Long',
      '}',
    );
    const a = src(`${k}/A.kt`, 'package k', '', 'class A : MediaPositionDelegate {', '    override fun currentPosition() = 1L', '    override fun computeSeek(percent: Int): Long = percent * 2L', '}');
    const b = src(`${k}/B.kt`, 'package k', '', 'class B : MediaPositionDelegate {', '    override fun currentPosition() = 2L', '', '    override fun computeSeek(percent: Int): Long {', '        return 0L', '    }', '}');
    const user = src(`${k}/User.kt`, 'package k', '', 'fun use(d: MediaPositionDelegate) = d.currentPosition()');
    expect(found([delegate, a, b, user])).toEqual(['MediaPositionDelegate.computeSeek']);
    const out = applied([delegate, a, b, user]);
    for (const p of [delegate.path, a.path, b.path]) expect(out.get(p)).not.toContain('computeSeek');
    expect(out.get(b.path)).not.toContain('return 0L');
  });

  it('garde : un appel, meme d un homonyme ailleurs, garde la paire', () => {
    const other = src(`${J}/Other.java`, 'package p;', '', 'class Other {', '\tlong f(Runtime r) { return getCurrentMemoryUsage(); }', '\tlong getCurrentMemoryUsage() { return 0L; }', '}');
    expect(found([SERVICE, IMPL, CALLER, other])).toEqual([]);
  });

  it('garde : un appel depuis un test garde la paire', () => {
    const test = src('/w/app/src/test/java/p/ImplTest.java', 'package p;', '', 'class ImplTest {', '\tvoid t() { new SystemInfoServiceImpl().getCurrentMemoryUsage(); }', '}');
    expect(found([SERVICE, IMPL, CALLER, test])).toEqual([]);
  });

  it('garde : une implementation dont un ancetre sort du corpus', () => {
    const impl = src(`${J}/SystemInfoServiceImpl.java`, ...IMPL.text.trimEnd().split('\n').map(l =>
      l.replace('implements SystemInfoService', 'extends android.app.Service implements SystemInfoService')));
    expect(found([SERVICE, impl, CALLER])).toEqual([]);
  });

  it('garde : un contrat qui prolonge un type hors du corpus', () => {
    const service = src(`${J}/SystemInfoService.java`, ...SERVICE.text.trimEnd().split('\n').map(l =>
      l.replace('public interface SystemInfoService {', 'public interface SystemInfoService extends java.io.Closeable {')));
    expect(found([service, IMPL, CALLER])).toEqual([]);
  });

  it('garde : une implementation anonyme', () => {
    const anon = src(`${J}/Anon.java`, 'package p;', '', 'class Anon {', '\tSystemInfoService s = new SystemInfoService() {', '\t\tpublic boolean isChargerConnected() { return false; }', '\t\tpublic long getCurrentMemoryUsage() { return 1L; }', '\t};', '}');
    expect(found([SERVICE, IMPL, CALLER, anon])).toEqual([]);
  });

  it('garde : une interface a une seule methode abstraite (lambda possible)', () => {
    const sam = src(`${J}/Listener.java`, 'package p;', '', 'public interface Listener {', '\tvoid onTick();', '}');
    const impl = src(`${J}/ListenerImpl.java`, 'package p;', '', 'class ListenerImpl implements Listener {', '\t@Override', '\tpublic void onTick() {}', '}');
    expect(found([sam, impl])).toEqual([]);
  });

  it('garde : une annotation de cadre sur la declaration (Retrofit, Room...)', () => {
    const api = src(`${J}/Api.java`, 'package p;', '', 'public interface Api {', '\t@GET("a")', '\tString a();', '', '\t@GET("b")', '\tString b();', '}');
    expect(found([api])).toEqual([]);
  });

  it('garde : un getter que Kotlin ou le data binding lisent sous son nom nu', () => {
    const user = src(`${J}/../k/UseIt.kt`, 'package k', '', 'fun show(s: p.SystemInfoService) = s.currentMemoryUsage');
    expect(found([SERVICE, IMPL, CALLER, user])).toEqual([]);
  });

  it('tout ou rien : une coupe de contrat a moitie recouverte retire tout le contrat', () => {
    const coupe = (start: number, end: number, famille: string, quoi: string) => ({ start, end, texte: '', famille, quoi });
    const brut = new Map([
      ['/w/I.java', [coupe(10, 30, 'contrats', 'p.I.f')]],
      ['/w/Impl.java', [coupe(0, 50, 'membres', 'g'), coupe(40, 80, 'contrats', 'p.I.f')]],
    ]);
    const out = sansChevauchement(brut);
    expect(out.get('/w/I.java')).toEqual([]);
    expect(out.get('/w/Impl.java')!.map(c => c.famille)).toEqual(['membres']);
  });

  it('une coupe de contrat entierement contenue part avec la coupe qui l englobe, le reste reste', () => {
    const coupe = (start: number, end: number, famille: string, quoi: string) => ({ start, end, texte: '', famille, quoi });
    const brut = new Map([
      ['/w/I.java', [coupe(10, 30, 'contrats', 'p.I.f')]],
      ['/w/Impl.java', [coupe(0, 100, 'symboles', 'Impl'), coupe(40, 80, 'contrats', 'p.I.f')]],
    ]);
    const out = sansChevauchement(brut);
    expect(out.get('/w/I.java')!.map(c => c.quoi)).toEqual(['p.I.f']);
    expect(out.get('/w/Impl.java')!.map(c => c.famille)).toEqual(['symboles']);
  });

  it('une signature qui finit sur un type nullable ne mange pas la suivante', () => {
    // Projet de reference, ToolbarContainerController : la coupe de `toolbarElevation(): Float?`
    // emportait `setToolbarElevation`, et portal:app ne compilait plus. Un `?`
    // seul en fin de ligne est un type nullable, jamais un operateur.
    const k = '/w/app/src/main/java/k';
    const i = src(`${k}/S.kt`, 'package k', '', 'interface S {', '    fun expand()', '    fun toolbarElevation(): Float?', '    fun setToolbarElevation(elevation: Float)', '}');
    const c = src(`${k}/C.kt`, 'package k', '', 'class C : S {', '    override fun expand() {}', '    override fun toolbarElevation(): Float? {', '        return 1f', '    }', '', '    override fun setToolbarElevation(elevation: Float) {}', '}');
    const u = src(`${k}/U.kt`, 'package k', '', 'fun main() {', '    val s: S = C()', '    s.expand()', '    s.setToolbarElevation(1f)', '}');
    expect(found([i, c, u])).toEqual(['S.toolbarElevation']);
    const out = applied([i, c, u]);
    expect(out.get(i.path)).toContain('fun setToolbarElevation(elevation: Float)');
    expect(out.get(i.path)).not.toContain('toolbarElevation(): Float?');
  });

  it('le compte rendu les compte et les nomme', () => {
    const { tally } = collecterUnePasse([SERVICE, IMPL, CALLER], SEGS);
    expect(tally.contrats).toBe(2);
    expect(resumeDesFamilles({ contrats: 2 } as any)).toBe('2 declarations of interface methods nobody calls');
  });
});

describe('G44 v2, classes et proprietes', () => {
  const B = '/w/app/src/main/java/b';

  it('une methode de classe surchargee par les sous classes, que personne n appelle', () => {
    // Projet de reference : PinchBehavior.setResetSmallAnimScale et ses trois Behavior.
    const base = src(`${B}/PinchBehavior.java`, 'package b;', '', 'public abstract class PinchBehavior {', '\tpublic abstract void apply();', '', '\tpublic void setResetSmallAnimScale(float s) {', '\t}', '}');
    const a = src(`${B}/SimpleBehavior.java`, 'package b;', '', 'public class SimpleBehavior extends PinchBehavior {', '\t@Override', '\tpublic void apply() {}', '', '\t@Override', '\tpublic void setResetSmallAnimScale(float s) {', '\t\tSystem.out.println(s);', '\t}', '}');
    const main = src(`${B}/Main.java`, 'package b;', '', 'public class Main {', '\tpublic static void main(String[] x) {', '\t\tPinchBehavior p = new SimpleBehavior();', '\t\tp.apply();', '\t}', '}');
    expect(found([base, a, main])).toEqual(['PinchBehavior.setResetSmallAnimScale']);
    const out = applied([base, a, main]);
    expect(out.get(base.path)).not.toContain('setResetSmallAnimScale');
    expect(out.get(a.path)).not.toContain('setResetSmallAnimScale');
    expect(out.get(a.path)).toContain('public void apply() {}');
  });

  it('une propriete d interface que personne ne lit, et ses surcharges', () => {
    const i = src(`${B}/Player.kt`, 'package b', '', 'interface Player {', '    val isPlaying: Boolean', '    val videoCurrentPosition: Long?', '    fun play()', '}');
    const impl = src(`${B}/AdPlayer.kt`, 'package b', '', 'class AdPlayer : Player {', '    override val isPlaying: Boolean = true', '    override val videoCurrentPosition: Long?', '        get() = 3L', '', '    override fun play() {}', '}');
    const main = src(`${B}/Run.kt`, 'package b', '', 'fun main() {', '    val p: Player = AdPlayer()', '    p.play()', '    println(p.isPlaying)', '}');
    expect(found([i, impl, main])).toEqual(['Player.videoCurrentPosition']);
    const out = applied([i, impl, main]);
    expect(out.get(i.path)).not.toContain('videoCurrentPosition');
    expect(out.get(impl.path)).not.toContain('videoCurrentPosition');
    expect(out.get(impl.path)).not.toContain('get() = 3L');
    expect(out.get(impl.path)).toContain('override val isPlaying: Boolean = true');
  });

  it('garde : une propriete surchargee par un parametre de constructeur', () => {
    const i = src(`${B}/Player.kt`, 'package b', '', 'interface Player {', '    val videoCurrentPosition: Long?', '    fun play()', '}');
    const impl = src(`${B}/AdPlayer.kt`, 'package b', '', 'class AdPlayer(override val videoCurrentPosition: Long?) : Player {', '    override fun play() {}', '}');
    const main = src(`${B}/Run.kt`, 'package b', '', 'fun main() {', '    val p: Player = AdPlayer(1L)', '    p.play()', '}');
    expect(found([i, impl, main])).toEqual([]);
  });

  it('garde : une propriete lue par Java sous son accesseur', () => {
    const i = src(`${B}/Player.kt`, 'package b', '', 'interface Player {', '    val videoCurrentPosition: Long?', '    fun play()', '}');
    const impl = src(`${B}/AdPlayer.kt`, 'package b', '', 'class AdPlayer : Player {', '    override val videoCurrentPosition: Long? = 1L', '    override fun play() {}', '}');
    const java = src(`${B}/Reader.java`, 'package b;', '', 'class Reader {', '\tLong read(Player p) { return p.getVideoCurrentPosition(); }', '}');
    expect(found([i, impl, java])).not.toContain('Player.videoCurrentPosition');
  });

  it('garde : la methode de classe que la sous classe appelle par super', () => {
    const base = src(`${B}/PinchBehavior.java`, 'package b;', '', 'public abstract class PinchBehavior {', '\tpublic void reset() {}', '}');
    const a = src(`${B}/SimpleBehavior.java`, 'package b;', '', 'public class SimpleBehavior extends PinchBehavior {', '\t@Override', '\tpublic void reset() {', '\t\tsuper.reset();', '\t}', '}');
    expect(found([base, a])).toEqual([]);
  });

  it('garde : une methode de classe qui en surcharge une autre n est pas la racine', () => {
    const top = src(`${B}/Top.java`, 'package b;', '', 'public interface Top {', '\tvoid a();', '\tvoid b();', '}');
    const mid = src(`${B}/Mid.java`, 'package b;', '', 'public abstract class Mid implements Top {', '\t@Override', '\tpublic void a() {}', '}');
    const leaf = src(`${B}/Leaf.java`, 'package b;', '', 'public class Leaf extends Mid {', '\t@Override', '\tpublic void a() {}', '\t@Override', '\tpublic void b() {}', '}');
    const main = src(`${B}/M.java`, 'package b;', '', 'public class M {', '\tpublic static void main(String[] x) { Top t = new Leaf(); t.b(); }', '}');
    // `a` meurt avec Top.a (contrat d interface), une seule fois, pas aussi comme contrat de Mid.
    expect(found([top, mid, leaf, main])).toEqual(['Top.a']);
  });
});

describe('G44 dans Find Everything Unused', () => {
  afterEach(() => { vi.restoreAllMocks(); delete (vscodeMock.workspace as any).workspaceFolders; });

  it('la section nomme le contrat et ses declarations', async () => {
    const corpus: any = { get: async () => ({
      sources: [SERVICE, IMPL, CALLER], moduleDirs: [], modulesWithCode: [], libraryModules: [],
      index: { entries: () => [] }, truncated: false, sourcesTruncated: false,
    }) };
    const stub: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };
    (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w') }];
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, def: any) => def } as any);
    (vscodeMock.window as any).withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    let message = '';
    (vscodeMock.window as any).showInformationMessage = async (m: string) => { message = m; return undefined; };
    (vscodeMock.window as any).showWarningMessage = async (m: string) => { message = m; return undefined; };
    await findEverythingUnusedCommand(corpus, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
    expect(message).toContain('interface method nobody calls');
  });
});
