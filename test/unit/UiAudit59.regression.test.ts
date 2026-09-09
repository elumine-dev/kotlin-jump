import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { buildSnapshotFile, restoreSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { SNAPSHOT_VERSION } from '../../src/indexer/IndexStore';

// Audit 59 : la v1.42.82 a ajoute `superQualifiers` a SymbolEntry pour tenir
// un qualificateur (`RecyclerView` dans `: RecyclerView.Adapter`) hors de la
// hierarchie. Le champ n'etait pas ecrit dans l'instantane, donc au
// redemarrage suivant `bySuper` se reconstruisait sans l'exclusion et le
// correctif s'annulait, en silence et jusqu'a la prochaine edition du fichier.

const URI = 'file:///a59/Adapter.kt';
const CODE = 'package p\n\nclass MonAdapter : RecyclerView.Adapter()\n';

function indexNeuf(): SymbolIndex {
  const index = new SymbolIndex();
  index.add(parse(URI, CODE));
  index.finalize();
  return index;
}

/** Sauvegarde puis restaure, comme un redemarrage de VS Code. */
function apresRedemarrage(): SymbolIndex {
  const parsed = parse(URI, CODE);
  const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 1, parsed.imports);
  const restaure = new SymbolIndex();
  restoreSnapshotFile(URI, sf, restaure);
  restaure.finalize();
  return restaure;
}

describe('Le qualificateur survit a la sauvegarde de l\'index', () => {
  it('un instantane restaure classe comme un index frais', () => {
    const frais = indexNeuf();
    const restaure = apresRedemarrage();
    expect(frais.lookupImplementations('RecyclerView')).toEqual([]);
    expect(restaure.lookupImplementations('RecyclerView')).toEqual([]);
    expect(restaure.lookupImplementations('Adapter').map(e => e.name)).toEqual(['MonAdapter']);
  });

  it('la regle de resolution qualifiee tient aussi apres restauration', () => {
    const restaure = new SymbolIndex();
    for (const [uri, code] of Object.entries({
      'file:///a59/Contract.kt': 'package p\n\ninterface Nav {\n    interface View {\n        fun r()\n    }\n}\n',
      'file:///a59/Vue.kt': 'package p\n\nclass MaVue : View.OnAttachStateChangeListener\n',
    })) {
      const parsed = parse(uri, code);
      const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 1, parsed.imports);
      restoreSnapshotFile(uri, sf, restaure);
    }
    restaure.finalize();
    const vue = restaure.lookup('View').find(e => e.fqn === 'p.Nav.View')!;
    expect(vue).toBeDefined();
    expect(restaure.lookupImplementationsDeep(vue)).toEqual([]);
  });

  it('la version d\'instantane a ete montee, sinon un ancien fichier revient sans le champ', () => {
    // Tout champ ajoute a SymbolEntry doit invalider les instantanes ecrits
    // avant lui : sans cela, l'utilisateur qui met a jour restaure un index
    // depourvu du champ et garde le bug.
    expect(SNAPSHOT_VERSION).toBeGreaterThanOrEqual(25);
  });
});

describe('Gardien : tout champ de SymbolEntry survit a un aller retour', () => {
  // Le meme oubli s'est produit deux fois (isExpect/isActual/isPrimaryCtorParam
  // en v24, superQualifiers en v25). Ce test compare un index frais a un index
  // restaure sur une fixture qui exerce chaque champ : le prochain champ ajoute
  // sans etre persiste casse la CI au lieu de disparaitre en silence.
  const URI_RICHE = 'file:///a59/Riche.kt';
  const RICHE = [
    'package p',
    '',
    'import kotlin.collections.List',
    '',
    'typealias Noms = List<String>',
    '',
    '@Deprecated("x")',
    'abstract class Base : RecyclerView.Adapter(), Listener {',
    '    companion object : Factory {',
    '        const val CLE = "v2"',
    '    }',
    '    protected abstract suspend fun charger(): Noms',
    '    override fun toString() = "b"',
    '    private lateinit var cache: Noms',
    '    inline fun <reified T> map(): T = TODO()',
    '    infix fun plus(o: Base): Base = this',
    '    operator fun get(i: Int): String = ""',
    '}',
    '',
    'expect class Multi',
    'actual class Autre',
    'enum class Couleur { ROUGE, VERT }',
    'data class Point(val x: Int, val y: Int)',
    'fun String.etendu(): Int = length',
    '',
    'class AvecAnon {',
    '    val h = object : Handler {}',
    '}',
  ].join('\n');

  it('index frais et index restaure produisent des entrees identiques', () => {
    const parsed = parse(URI_RICHE, RICHE);
    const frais = new SymbolIndex();
    frais.add(parsed);
    frais.finalize();

    const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 1, parsed.imports);
    const restaure = new SymbolIndex();
    restoreSnapshotFile(URI_RICHE, sf, restaure);
    restaure.finalize();

    const sansUri = (e: any) => {
      const { uri, ...reste } = e;
      // Les cles undefined ne comptent pas : `{a: undefined}` et `{}` decrivent
      // la meme entree.
      return JSON.parse(JSON.stringify({ ...reste, uri: String(uri) }));
    };
    const a = frais.getFileSymbols(URI_RICHE).map(sansUri);
    const b = restaure.getFileSymbols(URI_RICHE).map(sansUri);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(15);
  });

  it('la fixture exerce bien superQualifiers, sinon le gardien serait aveugle', () => {
    const parsed = parse(URI_RICHE, RICHE);
    expect(parsed.symbols.some(s => s.superQualifiers?.includes('RecyclerView'))).toBe(true);
  });
});
