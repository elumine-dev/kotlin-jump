import { describe, it, expect } from 'vitest';
import { Position, Range } from './__mocks__/vscode';
import { analyzeLifecyclePairs } from '../../src/providers/LifecyclePairingProvider';
import { LifecycleReleaseActionProvider, buildReleaseCall } from '../../src/providers/DiscoverabilityQuickFixes';
import { analyzeRoomSchema } from '../../src/indexer/RoomSchemaIndex';
import { parseNavigation, findOrphans, gatherRouteConstants } from '../../src/indexer/NavigationIndex';
import { collectStringLiterals } from '../../src/util/xmlRefs';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';
import { mockDocument } from './helpers';

// Audit 21 : détecteurs Android (cycle de vie, Room, navigation, implémentations, ressources).

const orphansOf = (code: string) => analyzeLifecyclePairs(code).orphans.map(o => `${o.resource}@${o.open}`);

describe('Lifecycle pairing', () => {
  it('ViewBinding.bind, lifecycle.addObserver et addCallback(viewLifecycleOwner) ne sont pas des fuites', () => {
    const code = [
      'class F : Fragment() {',
      '    override fun onViewCreated(view: View, s: Bundle?) {',
      '        _binding = FragmentDetailBinding.bind(view)',
      '        onBackPressedDispatcher.addCallback(viewLifecycleOwner) { }',
      '    }',
      '    override fun onCreate(s: Bundle?) {',
      '        lifecycle.addObserver(tracker)',
      '        ProcessLifecycleOwner.get().lifecycle.addObserver(appObserver)',
      '    }',
      '    override fun onDestroyView() { _binding = null }',
      '}',
    ].join('\n');
    expect(orphansOf(code)).toEqual([]);
  });

  it('la ressource est le bon argument (ou le receveur pour acquire), et unsubscribe n\'est pas subscribe', () => {
    const code = [
      'class A : Activity() {',
      '    override fun onStart() {',
      '        wakeLock.acquire(10 * 60 * 1000L)',
      '        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 10f, listener)',
      '        ContextCompat.registerReceiver(this, receiver, filter, flags)',
      '        fusedClient.requestLocationUpdates(request, callback, looper)',
      '        registerReceiver(object : BroadcastReceiver() {}, filter)',
      '    }',
      '    override fun onResume() { bus.unsubscribe(h) }',
      '    override fun onStop() {',
      '        wakeLock.release()',
      '        locationManager.removeUpdates(listener)',
      '        unregisterReceiver(receiver)',
      '        fusedClient.removeLocationUpdates(callback)',
      '    }',
      '}',
    ].join('\n');
    const r = analyzeLifecyclePairs(code);
    // An anonymous receiver has no name to release: it is skipped, not invented.
    expect(r.orphans).toEqual([]);
    expect(r.complete.map(c => c.resource).sort()).toEqual(['listener', 'receiver', 'request', 'wakeLock']);
  });

  it('le miroir est cherché dans la même classe ; un observateur interne n\'est pas onStop', () => {
    const code = [
      'class A : Activity() {',
      '    override fun onStart() { registerReceiver(batteryReceiver, filter) }',
      '    override fun onStop() { unregisterReceiver(batteryReceiver) }',
      '    private val observer = object : DefaultLifecycleObserver {',
      '        override fun onStop(owner: LifecycleOwner) { }',
      '    }',
      '}',
      'class B : Activity() {',
      '    override fun onStart() { registerReceiver(other, filter) }',
      '    override fun onStop() { }',
      '}',
    ].join('\n');
    expect(orphansOf(code)).toEqual(['other@onStart']);
  });

  it('quick fix : super.onX() en tête, miroir sur une ligne, receveur conservé', () => {
    const one = ['class A : Activity() {', '    override fun onStart() {', '        registerReceiver(r, f)', '    }', '    override fun onStop() { super.onStop() }', '}'].join('\n');
    const doc = mockDocument('file:///A.kt', one);
    const actions = new LifecycleReleaseActionProvider().provideCodeActions(doc as any, new Range(new Position(2, 0), new Position(2, 0)));
    expect(actions).toHaveLength(1);
    const e = (actions[0].edit as any).entries()[0];
    expect(e.range.start.line).toBe(4);
    expect(e.newText).toBe('\n        unregisterReceiver(r)\n    ');
    const expr = ['class A : Activity() {', '    override fun onStart() {', '        registerReceiver(r, f)', '    }', '    override fun onStop() = super.onStop()', '}'].join('\n');
    expect(new LifecycleReleaseActionProvider().provideCodeActions(mockDocument('file:///B.kt', expr) as any, new Range(new Position(2, 0), new Position(2, 0)))).toEqual([]);
    expect(buildReleaseCall('        manager.addListener(l)', 'addListener', 'removeListener', 'l')).toBe('manager.removeListener(l)');
    expect(buildReleaseCall('        registerReceiver(r, f)', 'registerReceiver', 'unregisterReceiver', 'r')).toBe('unregisterReceiver(r)');
  });
});

describe('Room', () => {
  it('AutoMigration avec spec, @Entity avec indices ou annotation intermédiaire, couverture par table', () => {
    const db = [
      'package p',
      '@Entity(tableName = "pokemon", indices = [Index(value = ["name"])])',
      '@Parcelize',
      'data class PokemonEntity(@PrimaryKey val id: Int, val name: String, val level: Int, val nickname: String)',
      '@Entity',
      'data class Trainer(@PrimaryKey val id: Int, val updatedAt: Long, val badges: Int)',
      'val M12 = object : Migration(1, 2) {',
      '    override fun migrate(db: SupportSQLiteDatabase) {',
      '        db.execSQL("ALTER TABLE pokemon ADD COLUMN level INTEGER NOT NULL DEFAULT 1")',
      '    }',
      '}',
      'val M23 = object : Migration(2, 3) {',
      '    override fun migrate(db: SupportSQLiteDatabase) {',
      '        db.execSQL("CREATE TABLE pokemon_new (id INTEGER PRIMARY KEY, name TEXT, level INTEGER, nickname TEXT)")',
      '    }',
      '}',
      '@Database(entities = [PokemonEntity::class, Trainer::class], version = 4, autoMigrations = [AutoMigration(from = 3, to = 4, spec = AppDb.RenameSpec::class)])',
      'abstract class AppDb : RoomDatabase()',
    ].join('\n');
    const r = analyzeRoomSchema([{ path: '/w/app/src/main/kotlin/AppDb.kt', text: db }]);
    expect(r.migrationGaps).toEqual([]);
    expect(r.missingFieldMigrations).toEqual([]);
    expect(r.coveredFields).toContain('nickname');
  });

  it('la fixture KJ-020 garde nickname signalé quand rien ne le migre', () => {
    const db = [
      'package p',
      '@Entity(tableName = "pokemon")',
      'data class PokemonEntity(@PrimaryKey val id: Int, val level: Int, val nickname: String)',
      '@Entity',
      'data class Trainer(@PrimaryKey val id: Int, val updatedAt: Long, val badges: Int)',
      'val M12 = object : Migration(1, 2) {',
      '    override fun migrate(db: SupportSQLiteDatabase) {',
      '        db.execSQL("ALTER TABLE pokemon ADD COLUMN level INTEGER NOT NULL DEFAULT 1")',
      '        db.execSQL("ALTER TABLE pokemon ADD COLUMN updatedAt INTEGER")',
      '    }',
      '}',
      '@Database(entities = [PokemonEntity::class, Trainer::class], version = 2)',
      'abstract class AppDb : RoomDatabase()',
    ].join('\n');
    const r = analyzeRoomSchema([{ path: '/w/app/src/main/kotlin/AppDb.kt', text: db }]);
    expect(r.missingFieldMigrations.map(m => `${m.entity}.${m.field}`)).toEqual(['PokemonEntity.nickname']);
  });
});

describe('Screen Flow', () => {
  it('un navigate() hors du bloc composable atteint sa cible, et une route portée par un objet est résolue', () => {
    const graph = 'fun Nav() { NavHost(navController, startDestination = Screen.Home.route) {\n    composable(Screen.Home.route) { HomeScreen(navController) }\n    composable("detail/{id}") { DetailScreen() }\n} }';
    const screen = 'sealed class Screen(val route: String) {\n    object Home : Screen("home")\n}\n@Composable fun HomeScreen(nav: NavController) { Button(onClick = { nav.navigate("detail/42") }) {} }';
    const constants = new Map<string, string>();
    for (const t of [graph, screen]) for (const [k, v] of gatherRouteConstants(t)) constants.set(k, v);
    expect(constants.get('Screen.Home.route')).toBe('home');
    const merged = { nodes: [] as any[], edges: [] as any[], deepLinks: [] as any[], startDestinations: [] as any[], graphs: [] as any[] };
    for (const t of [graph, screen]) {
      const p = parseNavigation(t, constants);
      merged.nodes.push(...p.nodes); merged.edges.push(...p.edges); merged.deepLinks.push(...p.deepLinks); merged.startDestinations.push(...p.startDestinations); merged.graphs.push(...p.graphs);
    }
    expect(merged.nodes.map(n => n.route)).toEqual(['home', 'detail/{id}']);
    expect(merged.edges).toContainEqual({ from: '«global»', to: 'detail/42' });
    expect(findOrphans(merged as any)).toEqual([]);
  });
});

describe('Implémentations', () => {
  it('seuls les overrides directs comptent, et le bon Handler parmi deux packages', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///a/Handler.kt', 'package com.a\ninterface Handler {\n    fun handle()\n}'));
    index.add(parse('file:///b/Handler.kt', 'package com.b\ninterface Handler {\n    fun handle()\n}'));
    index.add(parse('file:///a/AHandler.kt', 'package com.a\nclass AHandler : Handler {\n    override fun handle() {}\n    private fun handle(key: String) {}\n    companion object { fun handle() = 1 }\n}'));
    index.add(parse('file:///c/BHandler.kt', 'package com.c\nimport com.b.Handler\nclass BHandler : Handler {\n    override fun handle() {}\n}'));
    index.finalize();
    const a = index.lookupMethodImplementations('handle', 'file:///a/Handler.kt', 2);
    expect(a.map(e => e.uri.toString())).toEqual(['file:///a/AHandler.kt']);
    const b = index.lookupMethodImplementations('handle', 'file:///b/Handler.kt', 2);
    expect(b.map(e => e.uri.toString())).toEqual(['file:///c/BHandler.kt']);
  });

  it('une implémentation Java sans @Override compte quand même', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///a/Repo.kt', 'package com.a\ninterface Repo {\n    fun load()\n}'));
    index.add(parseJava('file:///a/JRepo.java', 'package com.a;\npublic class JRepo implements Repo {\n    public void load() {}\n}'));
    index.finalize();
    expect(index.lookupMethodImplementations('load', 'file:///a/Repo.kt', 2).map(e => e.name)).toEqual(['load']);
  });
});

describe('Ressources brutes', () => {
  it('un raw nommé dans une URI android.resource est référencé', () => {
    const lits = collectStringLiterals('videoView.setVideoURI(Uri.parse("android.resource://" + packageName + "/raw/intro_video"))');
    expect(lits.has('intro_video')).toBe(true);
  });
});
