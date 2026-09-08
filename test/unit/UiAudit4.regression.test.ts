// Regression tests for the leftovers of the third display audit (2026-09-08).
import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { buildRecentLocationItems } from '../../src/commands/recentLocations';
import { findManifestPermissionsInText } from '../../src/providers/ManifestPermissionProvider';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { analyzeRoomSchema } from '../../src/indexer/RoomSchemaIndex';
import { KotlinSemanticTokensProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/providers/SemanticTokensProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Recent Locations — labels (was: the URI-encoded file name, Caf%C3%A9.kt)', () => {
  it('decodes the file name and keeps the 1-based line', () => {
    const items = buildRecentLocationItems(
      [{ file: 'file:///w/src/Caf%C3%A9.kt', line: 11, character: 0, timestamp: 2 }, { file: 'file:///w/My%20File.kt', line: 7, character: 0, timestamp: 1 }],
      () => '',
    );
    expect(items.map(i => i.label)).toEqual(['Café.kt:12', 'My File.kt:8']);
  });
});

describe('Manifest permission pills — multi-line tags (was: line-by-line scan, no pill when android:name sits on its own line)', () => {
  it('puts the pill at the end of the line holding android:name, once per tag', () => {
    const xml = [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <uses-permission android:name="android.permission.CAMERA" />',
      '    <uses-permission',
      '        android:name="android.permission.WRITE_EXTERNAL_STORAGE"',
      '        android:maxSdkVersion="28" />',
      '    <uses-permission-sdk-23',
      '        android:name="android.permission.INTERNET" />',
      '</manifest>',
    ].join('\n');
    const badges = findManifestPermissionsInText(xml);
    expect(badges.map(b => [b.line, b.risk])).toEqual([[1, 'dangerous'], [3, 'dangerous'], [6, 'normal']]);
    expect(badges[1]!.column).toBe('        android:name="android.permission.WRITE_EXTERNAL_STORAGE"'.length);
  });
});

describe('VersionCatalogIndex — one catalog per project (was: the last toml read won, and deleting any toml emptied all)', () => {
  const tomlA = '[versions]\nkotlin = "1.9.0"\n[libraries]\nkotlin-stdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }\n';
  const tomlB = '[versions]\nkotlin = "2.0.0"\n[libraries]\nkotlin-stdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }\nokhttp = { module = "com.squareup.okhttp3:okhttp", version = "4.12.0" }\n';

  it('answers from the catalog of the project that contains the build file', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(tomlA, 'file:///ws/projA/gradle/libs.versions.toml');
    idx.reindexFile(tomlB, 'file:///ws/projB/gradle/libs.versions.toml');
    expect(idx.getByAccessor('kotlin.stdlib', '/ws/projA/app/build.gradle.kts')?.version).toBe('1.9.0');
    expect(idx.getByAccessor('kotlin.stdlib', '/ws/projB/feature/build.gradle.kts')?.version).toBe('2.0.0');
    expect(idx.getByAccessor('okhttp', '/ws/projA/app/build.gradle.kts')).toBeUndefined();
    expect(idx.getByAccessor('okhttp', '/ws/projB/app/build.gradle.kts')?.version).toBe('4.12.0');
  });

  it('deleting one toml keeps the other, and a single catalog serves every file', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(tomlA, 'file:///ws/projA/gradle/libs.versions.toml');
    idx.reindexFile(tomlB, 'file:///ws/projB/gradle/libs.versions.toml');
    idx.removeFile('file:///ws/projB/gradle/libs.versions.toml');
    expect(idx.getByAccessor('kotlin.stdlib', '/elsewhere/build.gradle.kts')?.version).toBe('1.9.0');
    expect(idx.getByAccessor('kotlin.stdlib')?.version).toBe('1.9.0');
  });
});

describe('Room — @Ignore and @Embedded (was: reported as "no ADD COLUMN")', () => {
  const entity = (extra: string) => `package p
import androidx.room.*
@Entity data class User(@PrimaryKey val id: Int, val name: String, ${extra})
val MIGRATION_1_2 = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) { db.execSQL("ALTER TABLE User ADD COLUMN name TEXT") } }
`;
  it('skips @Ignore and @Embedded fields', () => {
    const r = analyzeRoomSchema([{ path: 'a.kt', text: entity('@Ignore val cached: Boolean, @Embedded val address: Address, val age: Int') }]);
    expect(r.missingFieldMigrations.map(m => m.field)).toEqual(['age']);
  });
});

describe('Semantic highlighting — kotlinJump.semanticHighlighting toggles live (was: read once at activation)', () => {
  it('returns no tokens while the setting is off, and tokens again after refresh() once it is on', () => {
    const legend = new (vscodeMock as any).SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
    const index = new SymbolIndex();
    const code = 'package p\nclass Foo\nval x = Foo()';
    index.add(parse('file:///S.kt', code));
    const doc = mockDocument('file:///S.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, legend);
    const token = { isCancellationRequested: false } as any;
    let enabled = false;
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => k === 'semanticHighlighting' ? enabled : d } as any);
    expect(provider.provideDocumentSemanticTokens(doc, token).data.length).toBe(0);
    enabled = true;
    provider.refresh();
    expect(provider.provideDocumentSemanticTokens(doc, token).data.length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});
