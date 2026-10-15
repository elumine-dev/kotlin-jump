import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';
import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';
import { explainMembers, findUnusedMembers } from '../../../src/providers/unusedMembers';
import { findUnusedContracts } from '../../../src/providers/unusedContracts';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';
import { androidApi, AndroidApiIndex } from '../../../src/util/androidApi';

/**
 * G61, ce que la plateforme Android declare vraiment.
 *
 * Oracle : `9b514d8dc2` sur LaPresse (AND-2340). Kevin y retire une trentaine
 * de methodes de vues personnalisees que personne n appelle
 * (`OverlayImageButton.setOverlayColor`, `DossierCarouselContainer.getViewDarken`,
 * `ReplicaHorizontalScrollView.setSmoothScrollingEnabled`...) et les methodes
 * de `ImageService` dont l implementation implemente aussi
 * `ComponentCallbacks2`. KJ les gardait toutes (M3, M2) : un ancetre hors du
 * corpus pouvait declarer le meme nom.
 *
 * Un index des noms que chaque type public de `android.jar` declare repond a
 * la question pour la plateforme. Un ancetre que l index ne connait pas
 * (AndroidX, une bibliotheque) garde la reponse prudente d avant.
 *
 * Ici un petit index ecrit a la main, pour que chaque cas dise ce qu il prouve.
 */

const INDEX: AndroidApiIndex = {
  level: 'test',
  names: ['setOrientation', 'getVisibility', 'setAlpha', 'onTrimMemory', 'onLowMemory', 'toString', 'hashCode', 'newTaskFor', 'execute', 'start'],
  types: {
    'java.lang.Object': [null, [], [5, 6]],
    'android.view.View': ['java.lang.Object', [], [1, 2]],
    'android.view.ViewGroup': ['android.view.View', [], []],
    'android.widget.LinearLayout': ['android.view.ViewGroup', [], [0]],
    'android.content.ComponentCallbacks': [null, [], [4]],
    'android.content.ComponentCallbacks2': [null, ['android.content.ComponentCallbacks'], [3]],
    'java.util.concurrent.AbstractExecutorService': ['java.lang.Object', [], [7]],
    'java.util.concurrent.ThreadPoolExecutor': ['java.util.concurrent.AbstractExecutorService', [], [8]],
    'java.lang.Runnable': [null, [], []],
    'android.animation.Animator': ['java.lang.Object', [], [9]],
  },
};
const API = androidApi(INDEX);
const SEGS = ['test/java'];
const P = '/w/app/src/main/java/p';
const src = (path: string, ...lines: string[]) => ({ path: `${P}/${path}`, text: lines.join('\n') + '\n' });

const view = (extra: string[] = [], base = 'LinearLayout', imp = 'android.widget.LinearLayout') => src('OverlayLayout.java',
  'package p;',
  '',
  'import android.content.Context;',
  `import ${imp};`,
  '',
  `public class OverlayLayout extends ${base} {`,
  '\tpublic OverlayLayout(Context c) { super(c); }',
  '',
  '\tpublic void setOverlayColor(int color) {',
  '\t\tsetAlpha(color);',
  '\t}',
  ...extra,
  '}',
);
const MAIN = src('Main.java', 'package p;', '', 'public class Main {', '\tpublic static void main(String[] a) { new OverlayLayout(null); }', '}');

// `null` says « no index »: `undefined` would fall back to the default.
const members = (sources: { path: string; text: string }[], api: typeof API | null = API) =>
  findUnusedMembers({ sources, testSourceSets: SEGS, androidApi: api ?? undefined } as any).filter(m => m.verdict === 'unreferenced').map(m => m.name);

describe('G61, les membres', () => {
  it('une methode d une vue que la plateforme ne declare pas, et que personne n appelle', () => {
    expect(members([view(), MAIN])).toContain('setOverlayColor');
  });

  it('temoin : sans index, la reponse prudente d avant', () => {
    expect(members([view(), MAIN], null)).not.toContain('setOverlayColor');
  });

  it('garde : un nom que la plateforme declare (vraie surcharge possible)', () => {
    const v = view(['', '\tpublic void setOrientation(int o) {', '\t\tsuper.setOrientation(o);', '\t}']);
    expect(members([v, MAIN])).not.toContain('setOrientation');
  });

  it('garde : un ancetre que l index ne connait pas (AndroidX)', () => {
    const v = view([], 'AppCompatImageView', 'androidx.appcompat.widget.AppCompatImageView');
    expect(members([v, MAIN])).not.toContain('setOverlayColor');
  });

  it('garde : un setter atteint par reflexion sous son nom nu', () => {
    const anim = src('Anim.java', 'package p;', '', 'class Anim {', '\tvoid go(Object v) { android.animation.ObjectAnimator.ofInt(v, "overlayColor", 1); }', '}');
    expect(members([view(), MAIN, anim])).not.toContain('setOverlayColor');
  });
});

describe('G61, les contrats', () => {
  const SERVICE = src('ImageService.java', 'package p;', '', 'public interface ImageService {', '\tvoid load();', '', '\tvoid loadBitmapFromNet(String url);', '}');
  const impl = (extra: string[] = []) => src('ImageServiceImpl.java',
    'package p;',
    '',
    'import android.content.ComponentCallbacks2;',
    '',
    'public class ImageServiceImpl implements ImageService, ComponentCallbacks2 {',
    '\t@Override',
    '\tpublic void load() {}',
    '',
    '\t@Override',
    '\tpublic void loadBitmapFromNet(String url) {',
    '\t\tSystem.out.println(url);',
    '\t}',
    '',
    '\t@Override',
    '\tpublic void onTrimMemory(int level) {}',
    ...extra,
    '}',
  );
  const USER = src('User.java', 'package p;', '', 'public class User {', '\tpublic static void main(String[] a) { ImageService s = new ImageServiceImpl(); s.load(); }', '}');
  const contracts = (sources: { path: string; text: string }[], api: typeof API | null = API) =>
    findUnusedContracts({ sources, testSourceSets: SEGS, androidApi: api ?? undefined }).map(c => `${c.interfaceName}.${c.name}`);

  it('une implementation qui implemente aussi ComponentCallbacks2 n interdit plus le contrat', () => {
    expect(contracts([SERVICE, impl(), USER])).toEqual(['ImageService.loadBitmapFromNet']);
  });

  it('temoin : sans index, la paire reste', () => {
    expect(contracts([SERVICE, impl(), USER], null)).toEqual([]);
  });

  it('garde : un nom de contrat que la plateforme declare aussi', () => {
    const service = src('ImageService.java', 'package p;', '', 'public interface ImageService {', '\tvoid load();', '', '\tvoid onLowMemory();', '}');
    const i = src('ImageServiceImpl.java', 'package p;', '', 'import android.content.ComponentCallbacks2;', '',
      'public class ImageServiceImpl implements ImageService, ComponentCallbacks2 {', '\t@Override', '\tpublic void load() {}', '',
      '\t@Override', '\tpublic void onLowMemory() {}', '', '\t@Override', '\tpublic void onTrimMemory(int level) {}', '}');
    expect(contracts([service, i, USER])).toEqual([]);
  });
});

describe('G61, ce que la porte a attrape sur LaPresse', () => {
  it('un setter appele par ObjectAnimator sous son nom nu ne part pas, meme en ilot', () => {
    // CrossFadeBackgroundCellAnimator.setCellAlpha, seul appelant de
    // GridCell.setHighlightAlpha : compte comme mention, le setter vivait pour
    // les membres et mourait dans un ilot. C'est une garde, M13.
    const anim = src('CrossFade.java', 'package p;', '', 'import android.animation.Animator;', '',
      'public class CrossFade extends Animator {',
      '\tprivate final Cell cell = new Cell();',
      '\tpublic void go() { android.animation.ObjectAnimator.ofFloat(this, "cellAlpha", 1F, 0F).start(); }',
      '',
      '\tpublic void setCellAlpha(float value) {',
      '\t\tcell.setHighlightAlpha(value);',
      '\t}',
      '}');
    const cell = src('Cell.java', 'package p;', '', 'public class Cell {', '\tvoid setHighlightAlpha(float v) {}', '}');
    const main = src('Go.java', 'package p;', '', 'public class Go {', '\tpublic static void main(String[] a) { new CrossFade().go(); }', '}');
    const { parFichier } = collecterUnePasse([anim, cell, main], SEGS, { androidApi: API });
    const cuts = [...parFichier.values()].flat().map(c => c.quoi);
    expect(cuts).not.toContain('setCellAlpha');
    expect(cuts).not.toContain('setHighlightAlpha');
  });

  it('une vraie surcharge sous un en tete generique reste gardee', () => {
    // PriorityExecutor<T extends Runnable> extends ThreadPoolExecutor : le
    // parseur prenait la borne pour le parent, et newTaskFor semblait morte.
    const exec = src('PriorityExecutor.java', 'package p;', '', 'import java.util.concurrent.ThreadPoolExecutor;', '',
      'public class PriorityExecutor<T extends Runnable> extends ThreadPoolExecutor {',
      '\t@Override',
      '\tprotected Object newTaskFor(Runnable r, Object v) {',
      '\t\treturn null;',
      '\t}',
      '}');
    const main = src('Go.java', 'package p;', '', 'public class Go {', '\tpublic static void main(String[] a) { new PriorityExecutor<Runnable>(); }', '}');
    expect(members([exec, main])).not.toContain('newTaskFor');
  });

  it('une fabrique statique, meme surchargee, n est pas gardee par M3', () => {
    // Une fois le vrai parent lu, les deux fabriques statiques de
    // PriorityExecutor sortaient M3 et la reference les perdait. Une methode
    // statique n implemente rien.
    const exec = src('PriorityExecutor.java', 'package p;', '', 'import java.util.concurrent.ThreadPoolExecutor;', '',
      'public class PriorityExecutor<T extends Runnable> extends ThreadPoolExecutor {',
      '\tpublic static PriorityExecutor newFixed(int n) { return new PriorityExecutor(); }',
      '',
      '\tpublic static PriorityExecutor newFixed(int n, int m) { return new PriorityExecutor(); }',
      '}');
    const main = src('Go.java', 'package p;', '', 'public class Go {', '\tpublic static void main(String[] a) { new PriorityExecutor<Runnable>(); }', '}');
    expect(members([exec, main], null).filter(n => n === 'newFixed')).toHaveLength(2);
  });
});

describe('G61, l index traverse toute la chaine', () => {
  // Deux vues dont les methodes ne s appellent qu entre elles : chacune est
  // nommee hors de sa classe, donc seuls les ilots voient le cycle mort, et
  // seulement si l index rend les deux chaines visibles.
  const PAIRE = src('Pair.java', 'package p;', '', 'import android.widget.LinearLayout;', '',
    'public class Pair extends LinearLayout {',
    '\tpublic Pair() { super(null); }',
    '\tpublic void ping(Other o, int n) { if (n > 0) o.pong(this, n - 1); }',
    '}');
  const AUTRE = src('Other.java', 'package p;', '', 'import android.widget.LinearLayout;', '',
    'public class Other extends LinearLayout {',
    '\tpublic Other() { super(null); }',
    '\tpublic void pong(Pair p, int n) { if (n > 0) p.ping(this, n - 1); }',
    '}');
  const RACINE = src('Root.java', 'package p;', '', 'public class Root {', '\tpublic static void main(String[] a) { new Pair(); new Other(); new OverlayLayout(null); }', '}');
  // A contract that only the index unlocks: its implementation also
  // implements ComponentCallbacks2.
  const CONTRAT = [
    src('Store.java', 'package p;', '', 'public interface Store {', '\tvoid open();', '', '\tvoid wipe();', '}'),
    src('StoreImpl.java', 'package p;', '', 'import android.content.ComponentCallbacks2;', '',
      'public class StoreImpl implements Store, ComponentCallbacks2 {',
      '\t@Override', '\tpublic void open() {}', '',
      '\t@Override', '\tpublic void wipe() {}', '',
      '\t@Override', '\tpublic void onTrimMemory(int level) {}', '}'),
    src('Opener.java', 'package p;', '', 'public class Opener {', '\tpublic static void main(String[] a) { Store s = new StoreImpl(); s.open(); }', '}'),
  ];
  const coupes = (api: typeof API | undefined) => {
    const { parFichier } = collecterUnePasse([view(), PAIRE, AUTRE, RACINE], SEGS, { androidApi: api });
    return [...parFichier.values()].flat().map(c => `${c.famille}:${c.quoi}`);
  };

  it('explain dit pareil que find', () => {
    const row = (explainMembers({ sources: [view(), MAIN], testSourceSets: SEGS, androidApi: API } as any) as any[])
      .find(r => r.name === 'setOverlayColor');
    expect(row?.outcome).toBe('unreferenced');
  });

  it('collecterUnePasse passe l index aux membres et aux ilots', () => {
    expect(coupes(undefined)).toEqual([]);
    const avec = coupes(API);
    expect(avec).toContain('membres:setOverlayColor');
    expect(avec.filter(c => c.startsWith('ilots:'))).toEqual(expect.arrayContaining(['ilots:ping', 'ilots:pong']));
  });

  it('collecterUnePasse passe l index aux contrats', () => {
    const service = src('ImageService.java', 'package p;', '', 'public interface ImageService {', '\tvoid load();', '', '\tvoid loadBitmapFromNet(String url);', '}');
    const impl = src('ImageServiceImpl.java', 'package p;', '', 'import android.content.ComponentCallbacks2;', '',
      'public class ImageServiceImpl implements ImageService, ComponentCallbacks2 {',
      '\t@Override', '\tpublic void load() {}', '',
      '\t@Override', '\tpublic void loadBitmapFromNet(String url) {', '\t\tSystem.out.println(url);', '\t}', '',
      '\t@Override', '\tpublic void onTrimMemory(int level) {}', '}');
    const user = src('User.java', 'package p;', '', 'public class User {', '\tpublic static void main(String[] a) { ImageService s = new ImageServiceImpl(); s.load(); }', '}');
    const contrats = (api: typeof API | undefined) => [...collecterUnePasse([service, impl, user], SEGS, { androidApi: api }).parFichier.values()]
      .flat().filter(c => c.famille === 'contrats').length;
    expect(contrats(undefined)).toBe(0);
    expect(contrats(API)).toBe(2);
  });

  afterEach(() => { vi.restoreAllMocks(); delete (vscodeMock.workspace as any).workspaceFolders; });

  const harnais = () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    const messages: string[] = [];
    win.showInformationMessage = async (m: string, ...rest: any[]) => {
      if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) return 'Apply all';
      messages.push(m);
      return undefined;
    };
    win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
    const editions: any[] = [];
    w.applyEdit = async (e: any) => { editions.push(e); return true; };
    const corpus: any = {
      invalidate: () => {},
      get: async () => ({
        sources: [view(), RACINE, PAIRE, AUTRE, ...CONTRAT], moduleDirs: [], modulesWithCode: [], libraryModules: [],
        index: { entries: () => [] }, truncated: false, sourcesTruncated: false,
      }),
    };
    return { corpus, messages, editions };
  };

  it('Remove All charge l index et s en sert', async () => {
    const sans = harnais();
    await removeEverythingUnusedCommand(sans.corpus, async () => undefined);
    const avec = harnais();
    await removeEverythingUnusedCommand(avec.corpus, async () => API);
    const operations = (h: ReturnType<typeof harnais>) => h.editions.reduce((t, e) => t + e._entries.length + e._fileDeletes.length, 0);
    expect(operations(sans)).toBe(0);
    expect(operations(avec)).toBeGreaterThan(0);
  });

  it('Find Everything Unused charge l index et s en sert', async () => {
    const stub: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };
    const lancer = async (api: typeof API | undefined) => {
      const h = harnais();
      await findEverythingUnusedCommand(h.corpus, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, async () => api);
      return h.messages.join(' | ');
    };
    const avec = await lancer(API);
    const sans = await lancer(undefined);
    // One assertion per section: each one receives the index on its own.
    expect(avec).toContain('1 class member');
    expect(avec).toContain('1 dead island');
    expect(avec).toContain('interface method nobody calls');
    expect(sans).toContain('Nothing unused found');
  });
});

