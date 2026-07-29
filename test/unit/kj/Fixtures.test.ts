import { describe, it, expect } from 'vitest';
import { fixture, fixtureExists } from './harness';

/**
 * Garde-fous des fixtures KJ — TOUJOURS actifs.
 * Si quelqu'un renomme/supprime une fixture du demo project, ces tests
 * cassent immédiatement (les suites contractuelles en dépendent toutes).
 */

const KOTLIN_FIXTURES = [
  'src/main/kotlin/com/example/kj/stubs/AndroidStubs.kt',
  'src/main/kotlin/com/example/kj/g1edition/NamedArgumentsDemo.kt',
  'src/main/kotlin/com/example/kj/g1edition/PostfixCompletionDemo.kt',
  'src/main/kotlin/com/example/kj/g1edition/LiveTemplatesDemo.kt',
  'src/main/kotlin/com/example/kj/g1edition/SurroundWithDemo.kt',
  'src/main/kotlin/com/example/kj/g1edition/SmartJoinLinesDemo.kt',
  'src/main/kotlin/com/example/kj/g2resources/ExtractStringResourceDemo.kt',
  'src/main/kotlin/com/example/kj/g2resources/ResourceShadowingDemo.kt',
  'src/main/kotlin/com/example/kj/g2resources/ReverseStringMapDemo.kt',
  'src/main/kotlin/com/example/kj/g3navigation/Routes.kt',
  'src/main/kotlin/com/example/kj/g3navigation/NavGraphDemo.kt',
  'src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt',
  'src/main/kotlin/com/example/kj/g3navigation/OutlineTreeDemo.kt',
  'src/main/kotlin/com/example/kj/g4runtime/UdfXrayViewModel.kt',
  'src/main/kotlin/com/example/kj/g4runtime/LifecyclePairingDemo.kt',
  'src/main/kotlin/com/example/kj/g4runtime/DispatcherLensDemo.kt',
  'src/main/kotlin/com/example/kj/g4runtime/RoomMigrationDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/UnusedImportsDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/UnusedParamsDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/UnusedDeclarationsDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/UnusedLocalsDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/WriteOnlyDemo.kt',
  'src/main/kotlin/com/example/kj/g5deadweight/DependencyUsageDemo.kt',
  'src/main/kotlin/com/example/kj/g6editor/SqlQueryDao.kt',
  'src/main/kotlin/com/example/kj/g6editor/MethodSeparatorDemo.kt',
];

describe('KJ fixtures — présence', () => {
  for (const f of KOTLIN_FIXTURES) {
    it(`existe : ${f.split('/').pop()}`, () => {
      expect(fixtureExists(f), `fixture manquante: ${f}`).toBe(true);
    });
  }

  it('module feature-battle complet (settings + build + res)', () => {
    expect(fixture('settings.gradle.kts')).toContain('include(":feature-battle")');
    expect(fixtureExists('feature-battle/build.gradle.kts')).toBe(true);
    expect(fixtureExists('feature-battle/src/main/res/values/colors.xml')).toBe(true);
    expect(fixtureExists('feature-battle/src/main/res/values/strings.xml')).toBe(true);
  });

  it('layout KJ-021 présent avec les 3 refs attendues', () => {
    const layout = fixture('src/main/res/layout/view_kj_banner.xml');
    expect(layout).toContain('@string/banner_caption');
    expect(layout).toContain('tools:text="@string/legacy_subtitle"');
    expect(layout).toContain('@color/banner_backdrop');
  });
});

describe('KJ fixtures — marqueurs clés', () => {
  it('KJ-017 : primary défini dans les DEUX modules', () => {
    expect(fixture('src/main/res/values/colors.xml')).toContain('name="primary"');
    expect(fixture('feature-battle/src/main/res/values/colors.xml')).toContain('name="primary"');
  });

  it('KJ-021 : entrées mortes présentes', () => {
    const strings = fixture('src/main/res/values/strings.xml');
    expect(strings).toContain('unused_promo_banner');
    expect(strings).toContain('legacy_subtitle');
    expect(fixture('src/main/res/values/colors.xml')).toContain('unused_neon');
  });

  it('KJ-022 : gson/okhttp sans import, retrofit avec 1 import', () => {
    const gradle = fixture('build.gradle.kts');
    expect(gradle).toContain('implementation(libs.gson)');
    expect(gradle).toContain('implementation(libs.okhttp.core)');
    expect(gradle).toContain('implementation(libs.retrofit.core)');
    const usage = fixture('src/main/kotlin/com/example/kj/g5deadweight/DependencyUsageDemo.kt');
    expect(usage).toContain('import retrofit2.Retrofit');
  });

  it('KJ-023 : READ_SMS, GhostActivity et DeepLinkActivity dans le manifest', () => {
    const manifest = fixture('src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.permission.READ_SMS');
    expect(manifest).toContain('.GhostActivity');
    expect(manifest).toContain('.DeepLinkActivity');
    expect(manifest).toContain('android:maxSdkVersion="30"');
  });

  it('KJ-025 : les trois morts attendus et leurs call sites présents', () => {
    const demo = fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedParamsDemo.kt');
    expect(demo).toContain('retryCount: Int');
    expect(demo).toContain('private val wallClock');
    expect(demo).toContain('verbose: Boolean');
    expect(demo).toContain('ReportService("Q3", 3,');
    expect(demo).toContain('retryCount = 5');
  });

  it('KJ-026 : les cinq morts attendus et les pièges vivants présents', () => {
    const demo = fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedDeclarationsDemo.kt');
    for (const dead of ['staleCache', 'legacyFormat', 'countdown', 'LegacyEncoder', 'compute()']) {
      expect(demo).toContain(dead);
    }
    expect(demo).toContain('::handler');
    expect(demo).toContain('"value: $label"');
    expect(demo).toContain('init { println(helper) }');
  });

  it('KJ-027 : les six morts et les pièges vivants présents', () => {
    const demo = fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedLocalsDemo.kt');
    for (const dead of ['staleTotal', 'labels', 'report', 'cached', 'index', 'IllegalStateException']) {
      expect(demo).toContain(dead);
    }
    expect(demo).toContain('throw wrap(cause)');
    expect(demo).toContain('rows.map { it.trim() }');
    expect(demo).toContain('val (first, second)');
    expect(demo).toContain('"total: $count"');
  });

  it('KJ-028 : les trois morts et les pièges vivants présents', () => {
    const demo = fixture('src/main/kotlin/com/example/kj/g5deadweight/WriteOnlyDemo.kt');
    for (const dead of ['isPlaying', 'lastError', 'discarded']) expect(demo).toContain(dead);
    expect(demo).toContain('"session: $sessionLabel"');
    expect(demo).toContain('consume(handedOff++)');
    expect(demo).toContain('source.apply { total = 1 }');
    expect(demo).toContain('class Snapshot : Serializable');
  });

  it('KJ-029 : les ressources mortes et les pièges vivants présents', () => {
    for (const f of [
      'src/main/res/layout/view_kj_dead.xml',
      'src/main/res/layout/view_kj_tools_only.xml',
      'src/main/res/layout/view_kj_included.xml',
      'src/main/res/layout/view_kj_bound.xml',
      'src/main/res/layout/view_kj_kept.xml',
      'src/main/res/menu/menu_kj_main.xml',
      'src/main/res/menu/menu_kj_dead.xml',
      'src/main/res/anim/fade_kj_in.xml',
      'src/main/res/anim/fade_kj_dead.xml',
      'src/main/res/raw/config_kj_dynamic.json',
      'src/main/res/drawable/ic_kj_ghost.xml',
      'src/main/res/drawable-hdpi/ic_kj_ghost.png',
      'src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      'src/main/res/values/keep.xml',
    ]) {
      expect(fixtureExists(f), `fixture manquante: ${f}`).toBe(true);
    }
    const banner = fixture('src/main/res/layout/view_kj_banner.xml');
    expect(banner).toContain('<include layout="@layout/view_kj_included"');
    expect(banner).toContain('app:menu="@menu/menu_kj_main"');
    expect(banner).toContain('tools:layout="@layout/view_kj_tools_only"');
    expect(fixture('src/main/res/values/keep.xml')).toContain('tools:keep="@layout/view_kj_kept"');
  });

  it('KJ-020 : trou de migration 2→3 (aucune Migration(2, 3) déclarée)', () => {
    const room = fixture('src/main/kotlin/com/example/kj/g4runtime/RoomMigrationDemo.kt');
    expect(room).toMatch(/object\s*:\s*Migration\(1,\s*2\)/);
    // Aucune DÉCLARATION Migration(2, 3) — la mention en commentaire est permise.
    expect(room).not.toMatch(/object\s*:\s*Migration\(2,\s*3\)/);
    expect(room).toContain('AutoMigration(from = 3, to = 4)');
  });
});
