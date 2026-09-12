/**
 * What the Room drift analysis claims, against the project's own migrations.
 *
 *   node_modules/.bin/esbuild scripts/verify-room-drift.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/room.cjs
 *   node dist/perf/room.cjs <project-root>
 *
 * A real project usually has a short, clean migration chain, so zero findings
 * says almost nothing on its own. `KJ_TEMOIN=1` therefore injects one file
 * holding an entity, a migration and its `@Database`: it must produce the two
 * gaps that the injected version opens, and flag the one field no migration
 * adds while leaving the covered one alone.
 *
 * That file has to be ONE file. Splitting the entity, the migration and the
 * `@Database` across three links nothing, and the first version of this probe
 * read the resulting zero as a blind detector before checking the shape the
 * repository's own fixture uses.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { analyzeRoomSchema } from '../src/indexer/RoomSchemaIndex';

const RACINE = process.argv[2];
const ROOM = /@Entity\b|@Database\b|(?<!\w)Migration\s*\(|\bdatabaseBuilder\s*\(/;
const fichiers = execSync(
  `find ${RACINE} -type f -name '*.kt' -not -path '*/build/*' -not -path '*/.gradle/*'`,
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
).trim().split('\n').filter(Boolean);

const inputs: { path: string; text: string }[] = [];
for (const p of fichiers) {
  let t: string;
  try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
  if (!ROOM.test(t)) continue;
  inputs.push({ path: p, text: t });
}
// Le corpus reel ne porte qu une chaine 1->2->3 : un zero n y prouve rien.
// On injecte donc un trou et un champ non migre, et on verifie que
// l analyseur les voit. Sans ce temoin, « 0 trou » peut vouloir dire
// « detecteur aveugle ».
const TEMOIN = process.env.KJ_TEMOIN;
if (TEMOIN) {
  // Un seul fichier, comme la fixture du depot : entite, migrations et
  // @Database ensemble. Les repartir sur trois fichiers ne relie rien, et la
  // premiere version de ce temoin s est trompee la dessus avant d aller lire
  // la fixture qui marche.
  inputs.push({ path: '/synth/SynthDb.kt', text: [
    'package synth',
    '@Entity(tableName = "foo")',
    'data class Foo(',
    '    @PrimaryKey val id: Int,',
    '    val migre: String,',
    '    val jamaisMigre: String,',
    ')',
    '',
    'val M56 = object : Migration(5, 6) {',
    '  override fun migrate(db: SupportSQLiteDatabase) {',
    '    db.execSQL("ALTER TABLE foo ADD COLUMN migre TEXT NOT NULL DEFAULT \'\'")',
    '  }',
    '}',
    '',
    '@Database(entities = [Foo::class], version = 6)',
    'abstract class SynthDb : RoomDatabase()',
  ].join('\n') });
}
const a = analyzeRoomSchema(inputs);
console.log(JSON.stringify({
  fichiersRoom: inputs.length,
  trous: a.migrationGaps.length,
  champsSansMigration: a.missingFieldMigrations.length,
  champsCouverts: a.coveredFields.length,
}));

// Oracle independant : toutes les versions de migration ecrites dans le corpus.
const MIG = /Migration\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
const paires = new Set<string>();
const versions = new Set<number>();
for (const { text } of inputs) {
  MIG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MIG.exec(text)) !== null) {
    paires.add(`${m[1]}->${m[2]}`);
    versions.add(Number(m[1])); versions.add(Number(m[2]));
  }
}
console.log('paires de migration vues :', [...paires].sort().join(', ') || '(aucune)');
for (const g of a.migrationGaps) {
  const existe = paires.has(`${g.from}->${g.to}`);
  console.log(`  TROU annonce ${g.from} -> ${g.to}${existe ? '   <-- POURTANT PRESENT' : ''}  (${inputs[g.fileIndex]?.path.slice(RACINE.length + 1)})`);
}
for (const f of a.missingFieldMigrations.slice(0, 8)) {
  console.log(`  CHAMP ${f.entity}.${f.field}  (${inputs[f.fileIndex]?.path.slice(RACINE.length + 1)})`);
}
