import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { clearContentCache } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 54 : signalé par l'usage. Une méthode d'interface avec trois
// implémentations affichait « 3 implementations | 8 usages », et le panneau
// listait cinq lignes `override suspend fun getAudio(…)` parmi ces usages.
// Une implémentation est déjà comptée à gauche ; sa ligne de déclaration
// n'est pas un appel. Le filtre ne retirait que les déclarations du MÊME FQN,
// or un override porte sa propre classe dans son FQN.

const IFACE_URI = 'file:///a54/AudioRepository.kt';
const IFACE = [
  'package p',
  '',
  'interface AudioRepository {',
  '    suspend fun getAudio(uuid: String): AudioEntity?',
  '}',
].join('\n');

const IMPL_URI = 'file:///a54/AudioRepositoryImpl.kt';
const IMPL = [
  'package p',
  '',
  'class AudioRepositoryImpl : AudioRepository {',
  '    override suspend fun getAudio(uuid: String): AudioEntity? {',
  '        return null',
  '    }',
  '}',
].join('\n');

const NOOP_URI = 'file:///a54/AudioRepositoryNoop.kt';
const NOOP = [
  'package p',
  '',
  'class AudioRepositoryNoop : AudioRepository {',
  '    override suspend fun getAudio(uuid: String): AudioEntity? = null',
  '}',
].join('\n');

const APPEL_URI = 'file:///a54/AudioViewModel.kt';
const APPEL = [
  'package p',
  '',
  'class AudioViewModel(private val audioRepository: AudioRepository) {',
  '    suspend fun charger() {',
  '        val entity = audioRepository.getAudio("x")',
  '    }',
  '}',
].join('\n');

const FICHIERS: Record<string, string> = {
  [IFACE_URI]: IFACE, [IMPL_URI]: IMPL, [NOOP_URI]: NOOP, [APPEL_URI]: APPEL,
};

describe('Une implémentation n\'est pas un usage de la méthode d\'interface', () => {
  let provider: KotlinCodeLensProvider;
  let index: SymbolIndex;
  const origRead = workspace.fs.readFile;

  beforeEach(() => {
    index = new SymbolIndex();
    for (const [uri, code] of Object.entries(FICHIERS)) index.add(parse(uri, code));
    index.finalize();
    provider = new KotlinCodeLensProvider(index);
    workspace.fs.readFile = (async (u: any) => Buffer.from(FICHIERS[String(u)] ?? '')) as any;
  });

  afterEach(() => {
    workspace.fs.readFile = origRead;
    clearContentCache();
    provider.dispose();
  });

  it('le compte ne retient que les appels', async () => {
    // Trois déclarations du nom : l'interface et ses deux overrides.
    expect(index.lookup('getAudio').length).toBe(3);
    expect(index.lookup('getAudio').filter(e => e.isOverride).length).toBe(2);

    const doc = mockDocument(IFACE_URI, IFACE);
    const lenses = provider.provideCodeLenses(doc);
    const cible = lenses.find(l => (l as any).data?.entry?.name === 'getAudio');
    expect(cible).toBeDefined();

    const resolu = await provider.resolveCodeLens(cible as any, { isCancellationRequested: false } as any);
    // Avant : « 3 usages », les deux lignes `override` comptées avec l'appel.
    expect(resolu.command?.title).toBe('1 usage');
  });

  it('les implémentations restent comptées de leur côté', () => {
    expect(index.lookupImplementations('AudioRepository').length).toBe(2);
  });

  it('un appel écrit sur la ligne d\'une déclaration homonyme survit', async () => {
    // `withoutDeclaration` retire l'occurrence à la colonne de la déclaration,
    // donc un appel plus loin sur la même ligne doit rester compté.
    const RECURSIF = 'package p\n\nclass B : AudioRepository {\n    override suspend fun getAudio(uuid: String) = getAudio(uuid)\n}\n';
    const uri = 'file:///a54/B.kt';
    const idx = new SymbolIndex();
    for (const [u, c] of Object.entries({ ...FICHIERS, [uri]: RECURSIF })) idx.add(parse(u, c));
    idx.finalize();
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = (async (u: any) => Buffer.from(({ ...FICHIERS, [uri]: RECURSIF })[String(u)] ?? '')) as any;
    const p2 = new KotlinCodeLensProvider(idx);
    try {
      const lenses = p2.provideCodeLenses(mockDocument(IFACE_URI, IFACE));
      const cible = lenses.find(l => (l as any).data?.entry?.name === 'getAudio');
      const resolu = await p2.resolveCodeLens(cible as any, { isCancellationRequested: false } as any);
      // L'appel récursif compte, la déclaration qui le porte non.
      expect(resolu.command?.title).toBe('2 usages');
    } finally {
      workspace.fs.readFile = orig;
      clearContentCache();
      p2.dispose();
    }
  });
});
