import { describe, it, expect } from 'vitest';
import { StateProvenanceProvider } from '../../src/providers/StateProvenanceProvider';

// Audit 50 : signalé par l'usage. Le lens de provenance affichait
// « ✎ 7 writes (+3 indirect) · 👁 1 reader in this file » en UN SEUL lens, donc
// une seule commande : cliquer sur la partie droite ouvrait la même liste de
// références que la partie gauche, et il fallait choisir dans un panneau même
// pour un unique lecteur. Deux lens désormais, et une cible unique ouvre
// directement à sa position.

const URI = 'file:///a50/VM.kt';
const doc = (text: string): any => ({
  uri: { toString: () => URI, fsPath: '/a50/VM.kt', path: '/a50/VM.kt', scheme: 'file' },
  languageId: 'kotlin',
  version: 1,
  getText: () => text,
});

const lensesDe = (text: string) => new StateProvenanceProvider().provideCodeLenses(doc(text));

describe('Le lens de provenance est cliquable des deux côtés', () => {
  const UN_LECTEUR = [
    'package p',
    '',
    'class PlayerViewModel : ViewModel() {',
    '    private val _mutablePlayerState = MutableStateFlow(UiState.Idle)',
    '    val playerState = _mutablePlayerState.asStateFlow()',
    '',
    '    fun play() { _mutablePlayerState.value = UiState.Playing }',
    '    fun pause() { _mutablePlayerState.value = UiState.Paused }',
    '',
    '    fun render() = playerState.collectAsState()',
    '}',
  ].join('\n');

  it('produit deux lens sur la même ligne, un par côté', () => {
    const lenses = lensesDe(UN_LECTEUR);
    expect(lenses.length).toBe(2);
    expect(lenses[0].range.start.line).toBe(lenses[1].range.start.line);
    expect(lenses[0].command?.title).toMatch(/^✎ \d+ writes?/);
    expect(lenses[1].command?.title).toMatch(/^👁 \d+ readers? in this file$/);
  });

  it('un lecteur unique ouvre directement à sa position', () => {
    const lecteur = lensesDe(UN_LECTEUR)[1];
    expect(lecteur.command?.title).toBe('👁 1 reader in this file');
    // Avant : `editor.action.showReferences`, donc un panneau pour un seul choix.
    expect(lecteur.command?.command).toBe('vscode.open');
    const [, options] = lecteur.command!.arguments as [unknown, { selection: { start: { line: number } } }];
    const ligneAttendue = UN_LECTEUR.split('\n').findIndex(l => l.includes('playerState.collectAsState'));
    expect(options.selection.start.line).toBe(ligneAttendue);
  });

  it('le lens des écritures ne renvoie que des écritures', () => {
    const ecritures = lensesDe(UN_LECTEUR)[0];
    expect(ecritures.command?.command).toBe('editor.action.showReferences');
    const [, , locations] = ecritures.command!.arguments as [unknown, unknown, Array<{ range: any }>];
    // Le mock construit Location(uri, Position) : la position est dans `range`.
    const lignes = locations.map(l => l.range.line ?? l.range.start.line).sort((a: number, b: number) => a - b);
    const attendues = UN_LECTEUR.split('\n')
      .map((l, i) => (l.includes('_mutablePlayerState.value =') ? i : -1))
      .filter(i => i >= 0);
    expect(lignes).toEqual(attendues);
  });

  it('plusieurs lecteurs gardent la liste de références', () => {
    const DEUX = UN_LECTEUR.replace(
      '    fun render() = playerState.collectAsState()',
      '    fun render() = playerState.collectAsState()\n    fun peek() = playerState.collectAsState()',
    );
    const lecteur = lensesDe(DEUX)[1];
    expect(lecteur.command?.title).toBe('👁 2 readers in this file');
    expect(lecteur.command?.command).toBe('editor.action.showReferences');
  });

  it('sans lecteur, le compte reste affiché sur un seul lens', () => {
    const AUCUN = UN_LECTEUR.replace('    fun render() = playerState.collectAsState()\n', '');
    const lenses = lensesDe(AUCUN);
    // Un second lens sans commande utile n'est pas rendu de façon fiable (le
    // lens de prévisualisation drawable avait disparu ainsi), et « 0 readers »
    // est justement l'information à lire : elle reste sur le lens des écritures.
    expect(lenses.length).toBe(1);
    expect(lenses[0].command?.title).toBe('✎ 2 writes · 👁 0 readers in this file');
    expect(lenses[0].command?.command).toBe('editor.action.showReferences');
  });

  it('aucun lens ne porte une commande vide', () => {
    const AUCUN = UN_LECTEUR.replace('    fun render() = playerState.collectAsState()\n', '');
    for (const texte of [UN_LECTEUR, AUCUN]) {
      for (const l of lensesDe(texte)) {
        expect(l.command?.command, l.command?.title).toBeTruthy();
      }
    }
  });
});
