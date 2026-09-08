import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Uri, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { vectorXmlToSvg } from '../../src/util/vectorToSvg';
import { DrawableXmlPreviewPanel, DrawableXmlPreviewLensProvider } from '../../src/providers/DrawableXmlPreviewPanel';
import { buildWorkspaceNavigation } from '../../src/ui/ScreenFlowPanel';
import { HttpSourcesDownloader } from '../../src/http/HttpSourcesDownloader';
import { missingCoords } from '../../src/http/MavenCoordinatesParser';
import { AndroidProjectViewProvider } from '../../src/ui/AndroidProjectViewProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { NullLogger } from '../../src/util/logger';

// Audit 25 : rendu des drawables, panneau d'aperçu, Screen Flow, sources JAR, vue Android.

afterEach(() => vi.restoreAllMocks());

const VEC = (body: string, attrs = '') =>
  `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"
     android:viewportWidth="24" android:viewportHeight="24" ${attrs}>${body}</vector>`;

describe('vectorXmlToSvg', () => {
  it('garde l\'ordre du document entre groupes et paths (le fond recouvrait le glyphe)', () => {
    const svg = vectorXmlToSvg(VEC('<group><path android:pathData="M0,0h24v24H0z" android:fillColor="#FFF"/></group><path android:pathData="M12,4l8,16H4z" android:fillColor="#000"/>'))!;
    expect(svg.indexOf('<g>')).toBeLessThan(svg.indexOf('fill="#000"'));
    const reversed = vectorXmlToSvg(VEC('<path android:pathData="M12,4l8,16H4z" android:fillColor="#000"/><group><path android:pathData="M0,0h24v24H0z" android:fillColor="#FFF"/></group>'))!;
    expect(reversed.indexOf('fill="#000"')).toBeLessThan(reversed.indexOf('<g>'));
  });

  it('met à l\'échelle autour du pivot comme Android', () => {
    const svg = vectorXmlToSvg(VEC('<group android:scaleX="0.5" android:scaleY="0.5" android:pivotX="12" android:pivotY="12"><path android:pathData="M0,0Z" android:fillColor="#000"/></group>'))!;
    expect(svg).toContain('transform="translate(12,12) scale(0.5,0.5) translate(-12,-12)"');
    const noPivot = vectorXmlToSvg(VEC('<group android:scaleX="2"><path android:pathData="M0,0Z" android:fillColor="#000"/></group>'))!;
    expect(noPivot).toContain('transform="scale(2,1)"');
    const rotated = vectorXmlToSvg(VEC('<group android:rotation="45" android:pivotX="12" android:pivotY="12"><path android:pathData="M0,0Z" android:fillColor="#000"/></group>'))!;
    expect(rotated).toContain('rotate(45,12,12)');
  });

  it('remplit avec la première couleur d\'un dégradé aapt:attr au lieu de rien', () => {
    const svg = vectorXmlToSvg(VEC('<path android:pathData="M0,0h24v24H0z"><aapt:attr name="android:fillColor"><gradient android:startColor="#FFFF0000" android:endColor="#FF0000FF"/></aapt:attr></path>'))!;
    expect(svg).toContain('fill="#FF0000"');
    expect(svg).not.toContain('fill="none"');
  });

  it('traduit strokeLineCap/Join/MiterLimit, lit width hors de viewportWidth et décode les entités une seule fois', () => {
    const svg = vectorXmlToSvg(VEC(
      '<path android:pathData="M1,1 &amp; L2,2" android:strokeColor="#000" android:strokeWidth="3" android:strokeLineCap="round" android:strokeLineJoin="round" android:strokeMiterLimit="4"/>',
      'android:width="48dp" android:height="48dp"',
    ))!;
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('stroke-miterlimit="4"');
    expect(svg).toContain('width="48" height="48"');
    expect(svg).toContain('d="M1,1 &amp; L2,2"');
    expect(svg).not.toContain('&amp;amp;');
  });
});

describe('DrawableXmlPreviewPanel.render', () => {
  it('suit le document même quand il n\'est pas encore convertible', () => {
    const p = new DrawableXmlPreviewPanel();
    const fake = { title: '', webview: { html: '' }, viewColumn: 1, dispose() {} };
    (p as any).panel = fake;
    (p as any).render(mockDocument('file:///res/drawable/ic_a.xml', VEC('<path android:pathData="M0,0Z" android:fillColor="#000"/>')));
    expect(fake.title).toBe('Preview · ic_a.xml');
    expect(fake.webview.html).toContain('<svg');
    (p as any).render(mockDocument('file:///res/drawable/ic_b.xml', '<vector><path android:pathData="M0,0Z"'));
    expect(fake.title).toBe('Preview · ic_b.xml');
    expect((p as any).currentUri.toString()).toBe('file:///res/drawable/ic_b.xml');
    expect(fake.webview.html).toContain('Not a renderable');
    // Une édition invalide du même fichier garde le dernier rendu.
    (p as any).render(mockDocument('file:///res/drawable/ic_b.xml', VEC('<path android:pathData="M1,1Z" android:fillColor="#000"/>')));
    expect(fake.webview.html).toContain('M1,1Z');
    (p as any).render(mockDocument('file:///res/drawable/ic_b.xml', '<vector><path'));
    expect(fake.webview.html).toContain('M1,1Z');
    p.dispose();
  });

  it('le scan des références ignore les entrées de JAR', async () => {
    const index = new SymbolIndex();
    index.add(parse('file:///proj/A.kt', 'package a\nclass A'));
    index.add(parse('kotlin-jar:///cache/lib.jar!/b/B.kt', 'package b\nclass B'));
    index.add(parse('kotlin-stdlib-jar:///stdlib!/c/C.kt', 'package c\nclass C'));
    const read: string[] = [];
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = (async (u: any) => { read.push(u.toString()); return Buffer.from('R.drawable.ic'); }) as any;
    try {
      const lens = new DrawableXmlPreviewLensProvider(index);
      await (lens as any).findDrawableUsages('ic', { isCancellationRequested: false });
      expect(read).toEqual(['file:///proj/A.kt']);
      lens.dispose();
    } finally {
      workspace.fs.readFile = orig;
    }
  });
});

describe('Screen Flow: fusion inter-fichiers', () => {
  const HOME = 'package app\nfun NavGraphBuilder.home(nc: NavHostController) {\n  composable("home") { HomeScreen(onOpen = { nc.navigate("detail/42") }) }\n}';
  const DETAIL = 'package app\nfun NavGraphBuilder.detail() {\n  composable("detail/{id}") { DetailScreen() }\n}';
  const DUP = 'package app\nfun NavGraphBuilder.homeDebug() {\n  composable("home") { HomeScreenDebug() }\n}';
  const DYN = (n: number) => `package app\nfun NavGraphBuilder.g${n}() {\n  composable(Routes.UNKNOWN${n}) { X() }\n}`;

  async function build(files: Record<string, string>) {
    const origFind = workspace.findFiles;
    const origRead = workspace.fs.readFile;
    workspace.findFiles = (async (pattern: any) => typeof pattern === 'string' && pattern.startsWith('**/res') ? [] : Object.keys(files).map(u => Uri.parse(u))) as any;
    workspace.fs.readFile = (async (u: any) => Buffer.from(files[u.toString()] ?? '')) as any;
    try { return await buildWorkspaceNavigation(); }
    finally { workspace.findFiles = origFind; workspace.fs.readFile = origRead; }
  }

  it('une navigation littérale vers un motif déclaré ailleurs devient une flèche', async () => {
    const nav = await build({ 'file:///p/HomeNavigation.kt': HOME, 'file:///p/DetailNavigation.kt': DETAIL });
    expect(nav.edges).toEqual([{ from: 'home', to: 'detail/{id}' }]);
    expect(nav.truncated).toBe(false);
  });

  it('une route déclarée dans deux fichiers ne fait qu\'un nœud avec ses alternatives, les nœuds dynamiques sont uniques par fichier', async () => {
    const nav = await build({ 'file:///p/Main.kt': HOME, 'file:///p/Debug.kt': DUP, 'file:///p/G1.kt': DYN(1), 'file:///p/G2.kt': DYN(2) });
    const home = nav.nodes.filter(n => n.route === 'home');
    expect(home.length).toBe(1);
    expect(home[0].alternatives?.map(a => a.file)).toEqual(['file:///p/Main.kt', 'file:///p/Debug.kt']);
    const dynamic = nav.nodes.filter(n => n.dynamic).map(n => n.route);
    expect(dynamic.length).toBe(2);
    expect(new Set(dynamic).size).toBe(2);
  });
});

describe('Sources JAR', () => {
  it('missingCoords compare par group:artifact avec les JAR réellement indexés', () => {
    const declared = [
      { group: 'com.squareup.okhttp3', artifact: 'okhttp', version: '4.12.0' },
      { group: 'io.coil-kt', artifact: 'coil', version: '2.6.0' },
      { group: 'androidx.core', artifact: 'core-ktx', version: '1.13.0' },
    ];
    const missing = missingCoords(declared, ['com.squareup.okhttp3:okhttp:4.11.0', 'other:lib:1.0', 'androidx.core:core-ktx:1.13.0']);
    expect(missing.map(c => c.artifact)).toEqual(['coil']);
    expect(missingCoords(declared, []).length).toBe(3);
  });

  it('le téléchargeur abandonne après 5 redirections et refuse une page HTML à la place du zip', async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/loop')) { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>captive portal</html>');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const dl = new HttpSourcesDownloader(new NullLogger() as any);
    try {
      await expect((dl as any).fetchBuffer(`http://127.0.0.1:${port}/loop`)).rejects.toThrow('too many redirects');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a25-'));
      vi.spyOn(dl as any, 'fetchBuffer').mockImplementation(async () => Buffer.from('<html>captive portal</html>'));
      const result = await (dl as any).downloadOne({ group: 'g', artifact: 'a', version: '1' }, root);
      expect(result.error).toContain('not a zip');
      expect(fs.existsSync(path.join(root, 'g', 'a', '1'))).toBe(false);
    } finally {
      server.close();
    }
  }, 20_000);
});

describe('Vue Android', () => {
  it('le nœud anim ne liste plus animator/ et un plafond atteint se voit', async () => {
    const provider = new AndroidProjectViewProvider();
    const patterns: string[] = [];
    const origFind = workspace.findFiles;
    const origFolders = (workspace as any).workspaceFolders;
    (workspace as any).workspaceFolders = [{ uri: Uri.file('/proj'), name: 'proj', index: 0 }];
    workspace.findFiles = (async (pattern: any, _ex: any, max: number) => {
      patterns.push(pattern.pattern);
      return Array.from({ length: max }, (_, i) => Uri.file(`/proj/app/src/main/res/anim/a${i}.xml`));
    }) as any;
    try {
      const nodes = await provider.getChildren({ kind: 'resType', label: 'anim', resType: 'anim', modulePath: '/proj/app' } as any);
      expect(patterns[0]).toBe('**/res/{anim,anim-*}/**/*.*');
      expect(nodes.length).toBe(5001);
      expect(nodes[nodes.length - 1].label).toContain('more files');
    } finally {
      workspace.findFiles = origFind;
      (workspace as any).workspaceFolders = origFolders;
    }
  });
});
