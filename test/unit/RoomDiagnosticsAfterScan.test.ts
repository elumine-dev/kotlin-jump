/**
 * Les diagnostics Room etaient publies apres coup, eux aussi.
 *
 * Meme forme que les trois fournisseurs de pastilles corriges en v1.42.211,
 * v1.42.218 et v1.42.219, mais du cote du panneau Problemes : `_scanWorkspace`
 * lit le reglage, puis `await` la lecture de tout le projet, puis publie.
 *
 * Couper la detection de derive Room pendant ce balayage republiait donc les
 * avertissements que l utilisateur venait d eteindre. Et le fournisseur n
 * avait aucun drapeau de destruction : un balayage qui atterrit apres
 * `dispose()` appelle `clear()` puis `set()` sur une collection detruite, ce
 * que VS Code refuse.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { RoomMigrationProvider } from '../../src/providers/RoomMigrationProvider';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

// Entite, migration et @Database dans UN fichier : c est la forme que le
// detecteur relie, un decoupage en trois fichiers ne lie rien.
const SOURCE = [
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
  '    db.execSQL("ALTER TABLE foo ADD COLUMN migre TEXT NOT NULL DEFAULT " + vide)',
  '  }',
  '}',
  '',
  '@Database(entities = [Foo::class], version = 6)',
  'abstract class SynthDb : RoomDatabase()',
].join(NL);

afterEach(() => vi.restoreAllMocks());

function balayageSuspendu(reglage: { actif: boolean }) {
  let relacher!: () => void;
  const barriere = new Promise<void>(r => { relacher = r; });
  vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: () => {} } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: () => {} } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => ([
    { toString: () => 'file:///w/src/SynthDb.kt', fsPath: '/w/src/SynthDb.kt' },
  ])) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
    await barriere;
    return encode(SOURCE);
  }) as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (cle === 'roomMigrationDrift' ? reglage.actif : def),
  } as any);
  return relacher;
}

const publies = (p: any) => (p._diag._entries?.size ?? 0);

describe('RoomMigrationProvider - la publication apres le balayage', () => {
  it('temoin : un balayage qui aboutit publie bien un avertissement', async () => {
    const relacher = balayageSuspendu({ actif: true });
    const p: any = new RoomMigrationProvider();
    relacher();
    await attendre();
    expect(publies(p), 'sans avertissement les deux tests suivants ne prouveraient rien')
      .toBeGreaterThan(0);
    p.dispose();
  });

  it('couper le reglage pendant le balayage ne republie pas', async () => {
    const reglage = { actif: true };
    const relacher = balayageSuspendu(reglage);
    const p: any = new RoomMigrationProvider();
    await attendre();
    reglage.actif = false;
    relacher();
    await attendre();
    expect(publies(p), 'la detection coupee ne doit pas revenir toute seule').toBe(0);
    p.dispose();
  });

  it('un fournisseur detruit ne publie plus rien', async () => {
    const relacher = balayageSuspendu({ actif: true });
    const p: any = new RoomMigrationProvider();
    await attendre();
    // La doublure ne leve pas apres `dispose`, la vraie collection si : ce qui
    // se verifie ici, c est qu aucune ecriture n est meme tentee.
    const collection = p._diag;
    const set = vi.spyOn(collection, 'set');
    const clear = vi.spyOn(collection, 'clear');
    p.dispose();
    relacher();
    await attendre();
    expect(set.mock.calls.length + clear.mock.calls.length,
      'ecrire dans une collection de diagnostics detruite').toBe(0);
  });
});
