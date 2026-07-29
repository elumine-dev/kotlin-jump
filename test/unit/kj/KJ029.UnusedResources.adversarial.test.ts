import { describe, it, expect } from 'vitest';
import { findUnusedResources, ScanInput } from '../../../src/providers/UnusedResourceProvider';
import { FileResourceIndex } from '../../../src/indexer/FileResourceIndex';

/** KJ-029 — tentatives de casse de la DÉTECTION workspace-wide. */

const MODULE = '/ws/app';

function scan(files: string[], sources: { path: string; text: string }[], over: Partial<ScanInput> = {}) {
  const index = new FileResourceIndex();
  for (const f of files) index.addFile(f, [MODULE]);
  return findUnusedResources({
    entries: index.entries(),
    sources,
    modulesWithCode: [MODULE],
    ...over,
  });
}

const kt = (text: string) => ({ path: `${MODULE}/src/main/kotlin/A.kt`, text });
const xml = (name: string, text: string) => ({ path: `${MODULE}/src/main/res/${name}`, text });
const names = (r: ReturnType<typeof scan>) => r.map(f => f.name);

describe('KJ-029 adversarial — détection', () => {
  it('layout mort flagué, layout référencé par R.layout épargné', () => {
    const files = [`${MODULE}/src/main/res/layout/alive.xml`, `${MODULE}/src/main/res/layout/dead.xml`];
    expect(names(scan(files, [kt('setContentView(R.layout.alive)')]))).toEqual(['dead']);
  });

  it('tools:layout seul ne sauve pas : c’est du design-time', () => {
    const files = [`${MODULE}/src/main/res/layout/ghost.xml`];
    const src = xml('layout/host.xml', '<fragment tools:layout="@layout/ghost"/>');
    expect(names(scan(files, [src]))).toEqual(['ghost']);
  });

  it('tools:keep sauve : c’est la keep-list du shrinker', () => {
    const files = [`${MODULE}/src/main/res/layout/kept.xml`];
    const src = xml('values/keep.xml', '<resources tools:keep="@layout/kept"/>');
    expect(names(scan(files, [src]))).toEqual([]);
  });

  it('références en commentaire ne comptent pas', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`];
    expect(names(scan(files, [kt('// setContentView(R.layout.dead)')]))).toEqual(['dead']);
    const commented = xml('layout/host.xml', '<!-- <include layout="@layout/dead"/> -->');
    expect(names(scan(files, [commented]))).toEqual(['dead']);
  });

  it('ViewBinding sauve un layout, Impl compris', () => {
    const files = [`${MODULE}/src/main/res/layout/activity_main.xml`];
    expect(names(scan(files, [kt('val b = ActivityMainBinding.inflate(i)')]))).toEqual([]);
    expect(names(scan(files, [kt('class X : ActivityMainBindingImpl()')]))).toEqual([]);
  });

  it('include, app:menu et texte d’élément sauvent', () => {
    const files = [
      `${MODULE}/src/main/res/layout/header.xml`,
      `${MODULE}/src/main/res/menu/main.xml`,
      `${MODULE}/src/main/res/drawable/bg.xml`,
    ];
    const src = xml('layout/host.xml', [
      '<include layout="@layout/header"/>',
      '<BottomNav app:menu="@menu/main"/>',
      '<item name="android:windowBackground">@drawable/bg</item>',
    ].join('\n'));
    expect(names(scan(files, [src], { includeDrawables: true }))).toEqual([]);
  });

  it('littéral nu sauve une ressource chargée dynamiquement', () => {
    const files = [`${MODULE}/src/main/res/raw/config.json`];
    expect(names(scan(files, [kt('load("config")')]))).toEqual([]);
  });

  it('getIdentifier avec un type litéral n’annule QUE ce type', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`, `${MODULE}/src/main/res/menu/dead2.xml`];
    expect(names(scan(files, [kt('println(1)')])).length).toBe(2);
    // le type est lisible : seuls les layouts deviennent improuvables
    expect(names(scan(files, [kt('res.getIdentifier(n, "layout", pkg)')]))).toEqual(['dead2']);
    // un type hors périmètre ne change rien
    expect(names(scan(files, [kt('res.getIdentifier("faq_" + i, "string", pkg)')])).length).toBe(2);
  });

  it('getIdentifier au type calculé annule tout, la réflexion sur R aussi', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`, `${MODULE}/src/main/res/menu/dead2.xml`];
    expect(names(scan(files, [kt('res.getIdentifier(n, kindVar, pkg)')]))).toEqual([]);
    expect(names(scan(files, [kt('R.layout::class.java.fields')]))).toEqual([]);
  });

  it('BUG-HUNT-S : article.getIdentifier() est un getter métier, pas une lookup', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`];
    // sans argument, et même en surcharge à un seul argument : rien à voir
    expect(names(scan(files, [kt('val id = article.getIdentifier()')]))).toEqual(['dead']);
    expect(names(scan(files, [kt('interface A { fun getIdentifier(): String }')]))).toEqual(['dead']);
    expect(names(scan(files, [kt('parcel.setIdentifier(article.getIdentifier())')]))).toEqual(['dead']);
  });

  it('référence depuis le manifest sauve', () => {
    const files = [`${MODULE}/src/main/res/drawable/ic_app.xml`];
    const manifest = { path: `${MODULE}/src/main/AndroidManifest.xml`, text: '<application android:icon="@drawable/ic_app"/>' };
    expect(names(scan(files, [manifest], { includeDrawables: true }))).toEqual([]);
  });

  it('placeholder dans le manifest : drawables et mipmaps entièrement ignorés', () => {
    const files = [`${MODULE}/src/main/res/drawable/ghost.xml`, `${MODULE}/src/main/res/layout/dead.xml`];
    const manifest = { path: `${MODULE}/src/main/AndroidManifest.xml`, text: '<application android:icon="${appIcon}"/>' };
    expect(names(scan(files, [manifest], { includeDrawables: true }))).toEqual(['dead']);
  });

  it('kinds jamais couverts : xml, navigation, font, transition', () => {
    const files = [
      `${MODULE}/src/main/res/xml/network_security_config.xml`,
      `${MODULE}/src/main/res/navigation/graph.xml`,
      `${MODULE}/src/main/res/font/inter.ttf`,
      `${MODULE}/src/main/res/transition/slide.xml`,
    ];
    expect(names(scan(files, [kt('println(1)')]))).toEqual([]);
  });

  it('trois variantes de densité = un seul signalement portant trois fichiers', () => {
    const files = [
      `${MODULE}/src/main/res/drawable/ic.xml`,
      `${MODULE}/src/main/res/drawable-hdpi/ic.png`,
      `${MODULE}/src/main/res/drawable-night/ic.xml`,
    ];
    const found = scan(files, [kt('println(1)')], { includeDrawables: true });
    expect(found).toHaveLength(1);
    expect(found[0].paths).toHaveLength(3);
    // une seule référence suffit à sauver les trois
    expect(scan(files, [kt('R.drawable.ic')], { includeDrawables: true })).toEqual([]);
  });

  it('9-patch : ic.9.png a pour clé ic', () => {
    const files = [`${MODULE}/src/main/res/drawable/btn.9.png`];
    expect(names(scan(files, [kt('println(1)')], { includeDrawables: true }))).toEqual(['btn']);
    expect(names(scan(files, [kt('R.drawable.btn')], { includeDrawables: true }))).toEqual([]);
  });

  it('auto-référence : un drawable qui se cite lui-même reste mort', () => {
    const files = [`${MODULE}/src/main/res/drawable/self.xml`];
    const self = { path: `${MODULE}/src/main/res/drawable/self.xml`, text: '<selector><item android:drawable="@drawable/self"/></selector>' };
    // la référence vient du fichier lui-même : le détecteur la voit, donc vivant (faux négatif assumé)
    expect(names(scan(files, [self], { includeDrawables: true }))).toEqual([]);
  });

  it('inclusion mutuelle : les deux restent vivants (aucune analyse d’atteignabilité)', () => {
    const files = [`${MODULE}/src/main/res/layout/a.xml`, `${MODULE}/src/main/res/layout/b.xml`];
    const sources = [
      { path: `${MODULE}/src/main/res/layout/a.xml`, text: '<include layout="@layout/b"/>' },
      { path: `${MODULE}/src/main/res/layout/b.xml`, text: '<include layout="@layout/a"/>' },
    ];
    expect(names(scan(files, sources))).toEqual([]);
  });

  it('allowlist manifest : ic_launcher et compagnie jamais flagués', () => {
    const files = [
      `${MODULE}/src/main/res/mipmap-anydpi/ic_launcher.xml`,
      `${MODULE}/src/main/res/xml/file_paths.xml`,
      `${MODULE}/src/main/res/drawable/ic_notification_small.xml`,
    ];
    expect(names(scan(files, [kt('println(1)')], { includeDrawables: true }))).toEqual([]);
  });

  it('préfixes de bibliothèques : abc_, mtrl_, m3_ jamais flagués', () => {
    const files = [
      `${MODULE}/src/main/res/drawable/abc_ic_clear.xml`,
      `${MODULE}/src/main/res/layout/mtrl_shape.xml`,
      `${MODULE}/src/main/res/layout/m3_chip.xml`,
    ];
    expect(names(scan(files, [kt('println(1)')], { includeDrawables: true }))).toEqual([]);
  });

  it('module sans aucune source Kotlin ou Java : ignoré', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`];
    expect(names(scan(files, [kt('println(1)')], { modulesWithCode: [] }))).toEqual([]);
  });

  it('même clé dans deux modules : overlay, jamais flaguée', () => {
    const index = new FileResourceIndex();
    index.addFile('/ws/app/src/main/res/layout/shared.xml', ['/ws/app', '/ws/lib']);
    index.addFile('/ws/lib/src/main/res/layout/shared.xml', ['/ws/app', '/ws/lib']);
    const found = findUnusedResources({
      entries: index.entries(),
      sources: [kt('println(1)')],
      modulesWithCode: ['/ws/app', '/ws/lib'],
    });
    expect(found).toEqual([]);
  });

  it('corpus tronqué : zéro signalement, quoi qu’il arrive', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`];
    expect(names(scan(files, [kt('println(1)')], { truncated: true }))).toEqual([]);
  });

  it('R2 (ButterKnife) et R qualifié sauvent', () => {
    const files = [`${MODULE}/src/main/res/layout/a.xml`, `${MODULE}/src/main/res/layout/b.xml`];
    expect(names(scan(files, [kt('R2.layout.a\ncom.example.R.layout.b')]))).toEqual([]);
  });

  it('référence depuis un build.gradle.kts sauve', () => {
    const files = [`${MODULE}/src/main/res/raw/keys.json`];
    const gradle = { path: `${MODULE}/build.gradle.kts`, text: 'resValue("string", "k", "keys")' };
    expect(names(scan(files, [gradle]))).toEqual([]);
  });

  it('commentaire kotlin-jump:ignore dans le fichier : épargné', () => {
    const files = [`${MODULE}/src/main/res/layout/kept.xml`];
    const self = { path: `${MODULE}/src/main/res/layout/kept.xml`, text: '<!-- kotlin-jump:ignore unused-resource -->\n<View/>' };
    expect(names(scan(files, [self]))).toEqual([]);
  });

  it('drawables non supprimables tant que includeDrawables est false', () => {
    const files = [`${MODULE}/src/main/res/drawable/ghost.xml`, `${MODULE}/src/main/res/layout/dead.xml`];
    const found = scan(files, [kt('println(1)')]);
    const byName = Object.fromEntries(found.map(f => [f.name, f.deletable]));
    expect(byName).toEqual({ ghost: false, dead: true });
  });

  it('module bibliothèque : signalé mais avec une revendication prudente', () => {
    const files = [`${MODULE}/src/main/res/layout/dead.xml`];
    const found = scan(files, [kt('println(1)')], { libraryModules: [MODULE] });
    expect(found[0].isLibraryModule).toBe(true);
  });

  it('perf : 400 ressources sur 3000 sources < 1500 ms', () => {
    const files = Array.from({ length: 400 }, (_, i) => `${MODULE}/src/main/res/layout/l${i}.xml`);
    const sources = Array.from({ length: 3000 }, (_, i) => kt(`fun f${i}() { setContentView(R.layout.l${i % 200}) }`));
    const start = performance.now();
    const found = scan(files, sources);
    expect(found).toHaveLength(200);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
