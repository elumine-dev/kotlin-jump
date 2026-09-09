import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { workspace } from './__mocks__/vscode';

// Audit 52 : un appel était résolu vers n'importe quelle entrée portant le nom,
// y compris une variable LOCALE d'un autre fichier du même package. Sa ligne
// était alors lue comme une signature, et l'argument étiqueté avec un nom
// ramassé dans cette expression. Cas réel : `Color.alpha(result)` recevait
// `opacity:`, tiré de `val alpha = (Color.alpha(this) * opacity).toInt()`
// déclaré ailleurs. 14 étiquettes inventées sur le corpus LaPresse.

const LOCALE_URI = 'file:///a52/ColorUtilExt.kt';
const LOCALE = [
  'package p',
  '',
  'fun Int.addOpacity(opacity: Float): Int {',
  '    val alpha = (Color.alpha(this) * opacity).toInt()',
  '    return alpha',
  '}',
].join('\n');

const APPEL_URI = 'file:///a52/ColorTest.kt';
const APPEL = [
  'package p',
  '',
  'fun verifie(result: Int) {',
  '    assertEquals(255, Color.alpha(result))',
  '}',
].join('\n');

function docDe(uri: string, code: string): any {
  const L = code.split('\n');
  return {
    uri: { toString: () => uri, fsPath: uri.slice(7), path: uri.slice(7), scheme: 'file' },
    fileName: uri.slice(7), languageId: 'kotlin', version: 1, lineCount: L.length,
    getText: (r?: any) => (r ? (L[r.start.line] ?? '').slice(r.start.character, r.end.character) : code),
    lineAt: (n: any) => ({ text: L[typeof n === 'number' ? n : n.line] ?? '' }),
    positionAt: (o: number) => {
      let n = 0;
      for (let i = 0; i < L.length; i++) { if (n + L[i].length >= o) return { line: i, character: o - n }; n += L[i].length + 1; }
      return { line: 0, character: 0 };
    },
    offsetAt: (p: any) => { let n = 0; for (let i = 0; i < p.line; i++) n += (L[i] ?? '').length + 1; return n + p.character; },
  };
}

const FICHIERS: Record<string, string> = { [LOCALE_URI]: LOCALE, [APPEL_URI]: APPEL };

async function hintsDe(uri: string, autres: Record<string, string> = {}): Promise<string[]> {
  const tous = { ...FICHIERS, ...autres };
  const index = new SymbolIndex();
  for (const [u, c] of Object.entries(tous)) index.add(parse(u, c));
  index.finalize();
  const orig = workspace.openTextDocument;
  workspace.openTextDocument = (async (u: any) => docDe(String(u), tous[String(u)] ?? '')) as any;
  try {
    const doc = docDe(uri, tous[uri]);
    const out = await new KotlinInlayHintsProvider(index).provideInlayHints(
      doc,
      { start: { line: 0, character: 0 }, end: { line: doc.lineCount - 1, character: 0 } } as any,
      { isCancellationRequested: false } as any,
    );
    return (out ?? []).map(h =>
      (typeof h.label === 'string' ? h.label : (h.label as any[]).map(x => x.value ?? '').join('')).trim());
  } finally {
    workspace.openTextDocument = orig;
  }
}

describe('Un appel ne se résout pas vers une variable locale homonyme', () => {
  it('aucune étiquette inventée sur Color.alpha(result)', async () => {
    const libelles = await hintsDe(APPEL_URI);
    // Avant : ['opacity:'], ramassé dans le corps d'une fonction d'un autre fichier.
    expect(libelles).not.toContain('opacity:');
    expect(libelles.filter(l => l !== 'expected:' && l !== 'actual:')).toEqual([]);
  });

  it('une vraie fonction du workspace garde son étiquette', async () => {
    const DECL = 'package p\n\nfun envoyer(destinataire: String, corps: String) {}\n';
    const USAGE = 'package p\n\nfun go() {\n    envoyer("a", "b")\n}\n';
    const libelles = await hintsDe('file:///a52/Usage.kt', {
      'file:///a52/Decl.kt': DECL,
      'file:///a52/Usage.kt': USAGE,
    });
    expect(libelles).toEqual(['destinataire:', 'corps:']);
  });

  it('un constructeur de classe scellée garde ses étiquettes', async () => {
    // Filtrer par une liste de sortes APPELABLES était trop étroit : `annotation`
    // manquait, puis `sealedClass`. Un appel au constructeur du parent scellé
    // (`) : OpenFullScreen(tag, module)`) perdait toutes ses étiquettes.
    const DECL = 'package p\n\nsealed class Evenement(val type: String, val data: Any?)\n';
    // Forme réelle : l'appel au parent est sur sa propre ligne, sinon le
    // provider saute la ligne parce qu'elle déclare quelque chose.
    const USAGE = [
      'package p',
      '',
      'class Galerie(',
      '    data: Any?,',
      ') : Evenement("galleryChanged", data)',
    ].join('\n');
    const libelles = await hintsDe('file:///a52/Sealed.kt', {
      'file:///a52/SealedDecl.kt': DECL,
      'file:///a52/Sealed.kt': USAGE,
    });
    expect(libelles).toEqual(['type:', 'data:']);
  });

  it('un constructeur d\'enum garde ses étiquettes', async () => {
    const DECL = 'package p\n\nenum class Accent(val valeur: String) {\n    ROUGE("r"),\n}\n';
    const USAGE = 'package p\n\nfun creer(): Accent {\n    return Accent("bleu")\n}\n';
    const libelles = await hintsDe('file:///a52/Enum.kt', {
      'file:///a52/EnumDecl.kt': DECL,
      'file:///a52/Enum.kt': USAGE,
    });
    expect(libelles).toContain('valeur:');
  });

  it('une annotation garde ses étiquettes', async () => {
    // `annotation` ne faisait pas partie des sortes appelables : filtrer sans
    // l'ajouter aurait supprimé toutes les étiquettes d'annotation.
    const DECL = 'package p\n\nannotation class CardVMKey(val value: String)\n';
    const USAGE = 'package p\n\n@CardVMKey("audio")\nfun bind() {}\n';
    const libelles = await hintsDe('file:///a52/Anno.kt', {
      'file:///a52/AnnoDecl.kt': DECL,
      'file:///a52/Anno.kt': USAGE,
    });
    expect(libelles).toContain('value:');
  });
});
