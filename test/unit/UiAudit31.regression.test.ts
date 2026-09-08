import { describe, it, expect, vi } from 'vitest';
import { SUPPRESS_DESCRIPTIONS, lookupSuppression } from '../../src/data/suppressDescriptions';
import { Position, FoldingRangeKind } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinSelectionRangeProvider } from '../../src/providers/SelectionRangeProvider';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { findManifestPermissionsInText } from '../../src/providers/ManifestPermissionProvider';
import { vectorXmlToSvg } from '../../src/util/vectorToSvg';

// Audit 31 : liens de documentation du survol @Suppress / @SuppressLint.

const LINT_PREFIX = 'https://googlesamples.github.io/android-custom-lint-rules/checks/';

describe('Lien Reference du survol de suppression', () => {
  it('chaque lien lint pointe sur la page du check qu\'il documente', () => {
    for (const [id, desc] of Object.entries(SUPPRESS_DESCRIPTIONS)) {
      if (!desc.docUrl?.startsWith(LINT_PREFIX)) continue;
      // Le nom de page EST l'identifiant du check. Une faute de frappe ou un
      // copier coller d'une entrée voisine donne un 404 dans le navigateur.
      expect(desc.docUrl, id).toBe(`${LINT_PREFIX}${id}.md.html`);
    }
  });

  it('un check sans page publiée ne propose pas de lien mort', () => {
    // checks/ObsoleteLintCustomCheck.md.html répond 404 : l'index des 886
    // checks ne le publie pas. Mieux vaut pas de lien qu'un lien vers un 404.
    expect(lookupSuppression('ObsoleteLintCustomCheck')).toBeDefined();
    expect(lookupSuppression('ObsoleteLintCustomCheck')?.docUrl).toBeUndefined();
    // La racine checks/ est elle même un 404 : jamais de docUrl qui s'y arrête.
    for (const [id, desc] of Object.entries(SUPPRESS_DESCRIPTIONS)) {
      expect(desc.docUrl, id).not.toBe(LINT_PREFIX);
    }
  });

  it('le lien Kotlin ne passe plus par la page de redirection', () => {
    const kotlin = Object.values(SUPPRESS_DESCRIPTIONS)
      .map(d => d.docUrl)
      .filter((u): u is string => !!u && u.includes('kotlinlang.org'));
    expect(kotlin.length).toBeGreaterThan(0);
    for (const u of kotlin) {
      // /docs/reference/ n'est plus qu'un stub meta refresh vers home.html.
      expect(u).not.toContain('/docs/reference/');
      expect(u).toBe('https://kotlinlang.org/docs/home.html');
    }
  });

  it('tout docUrl est une URL https absolue', () => {
    for (const [id, desc] of Object.entries(SUPPRESS_DESCRIPTIONS)) {
      if (!desc.docUrl) continue;
      expect(() => new URL(desc.docUrl!), id).not.toThrow();
      expect(desc.docUrl, id).toMatch(/^https:\/\//);
    }
  });
});

// ── Provenance d'état : coût et exactitude ───────────────────────────────────

// Document minimal pour provideCodeLenses : seuls getText, languageId,
// version et uri sont lus.
function lensDoc(text: string, version: number): any {
  return {
    uri: { toString: () => 'file:///a31/VM.kt' },
    languageId: 'kotlin',
    version,
    getText: () => text,
  };
}

describe('Analyse de provenance sur un gros ViewModel', () => {
  function bigViewModel(states: number, plainFns: number): string {
    const L = ['package com.example', '', 'class BigViewModel : ViewModel() {'];
    for (let s = 0; s < states; s++) {
      L.push(`    private val _s${s} = MutableStateFlow(0)`);
      L.push(`    val s${s} = _s${s}.asStateFlow()`);
      L.push(`    fun write${s}(v: Int) { _s${s}.value = v }`);
    }
    for (let i = 0; i < plainFns; i++) {
      L.push(`    fun plain${i}(v: Int) { write${i % states}(v) }`);
    }
    L.push('}');
    return L.join('\n');
  }

  it('le fichier n\'est nettoyé qu\'une fois, pas une fois par état', async () => {
    const xmlRefs = await import('../../src/util/xmlRefs');
    const spy = vi.spyOn(xmlRefs, 'stripKotlinComments');
    const mod = await import('../../src/providers/StateProvenanceProvider');
    const text = bigViewModel(30, 300);

    spy.mockClear();
    mod.analyzeStateProvenance(text);
    // Avant : un strip par état pour les écritures directes, plus un par
    // état et par fonction pour les indirectes, soit des milliers de passes
    // sur le même texte à chaque frappe. Le budget est maintenant constant.
    // Sans ce garde, un espion qui n'intercepte rien ferait passer le test.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBe(1);

    // Le vrai chemin est provideCodeLenses, pas l'analyse seule : c'est lui
    // qui tourne à chaque frappe, et il nettoyait le fichier une deuxième fois
    // pour son propre compte.
    spy.mockClear();
    new mod.StateProvenanceProvider().provideCodeLenses(lensDoc(text, 1));
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });

  it('un fichier sans aucun état ne rend aucun lens, et le raccourci ne va pas trop loin', async () => {
    const mod = await import('../../src/providers/StateProvenanceProvider');
    // Un écran Compose qui utilise `by mutableStateOf` sans jamais déclarer
    // `val _x = mutableStateOf(...)` passe le pré-filtre mais ne produit aucun
    // état. Le balayage de tous les corps de fonction est alors pur
    // gaspillage : mesuré à 4,4 ms par frappe sur un fichier de 74 Ko, ramené
    // à 0,3 ms. Pas d'assertion sur le temps ici : une horloge dans une suite
    // qui tourne sur une machine partagée finit toujours par mentir.
    const body = (i: number) => `    fun render${i}(v: Int) { var s by mutableStateOf(v); helper${i % 7}(s) }`;
    const L = ['package p', 'class Screen {'];
    for (let i = 0; i < 400; i++) L.push(body(i));
    L.push('}');
    const text = L.join('\n');
    expect(mod.analyzeStateProvenance(text)).toEqual([]);
    expect(new mod.StateProvenanceProvider().provideCodeLenses(lensDoc(text, 100))).toEqual([]);

    // Le sens dangereux du raccourci : couper trop tôt. Le même fichier avec un
    // seul vrai état doit garder son lens ET ses écritures indirectes.
    const W = ['package p', 'class Screen {', '    private val _sel = MutableStateFlow(0)'];
    W.push('    fun choose(v: Int) { _sel.value = v }');
    W.push('    fun onTap(v: Int) { choose(v) }');
    for (let i = 0; i < 400; i++) W.push(body(i));
    W.push('}');
    const withState = mod.analyzeStateProvenance(W.join('\n'));
    expect(withState.map(s => s.property)).toEqual(['_sel']);
    expect(withState[0].directWrites).toBe(1);
    expect(withState[0].indirectWriteFns).toEqual(['onTap']);
  });

  it('le résultat est inchangé : écritures directes et indirectes', async () => {
    const { analyzeStateProvenance } = await import('../../src/providers/StateProvenanceProvider');
    const all = analyzeStateProvenance(bigViewModel(4, 8));
    expect(all.map(s => s.property)).toEqual(['_s0', '_s1', '_s2', '_s3']);
    expect(all[0].exposedAs).toBe('s0');
    expect(all[0].directWrites).toBe(1);
    // plain0 et plain4 appellent write0, qui écrit _s0.
    expect(all[0].indirectWriteFns).toEqual(['plain0', 'plain4']);
    expect(all[3].indirectWriteFns).toEqual(['plain3', 'plain7']);
  });

  it('une déclaration écrite dans un commentaire n\'est pas un état', async () => {
    const { analyzeStateProvenance } = await import('../../src/providers/StateProvenanceProvider');
    const vm = [
      'class VM {',
      '    // private val _old = MutableStateFlow(0)',
      '    /* private val _older = MutableStateFlow(0) */',
      '    private val _live = MutableStateFlow(0)',
      '}',
    ].join('\n');
    expect(analyzeStateProvenance(vm).map(s => s.property)).toEqual(['_live']);
  });

  it('les positions collectées restent justes au delà de la première ligne', async () => {
    const { collectWriteSitesByName, collectReaderSitesByName } =
      await import('../../src/providers/StateProvenanceProvider');
    const text = [
      'class VM {',
      '  fun a() { _x.value = 1 }',
      '',
      '  fun b() { _x.value = 2 }',
      '}',
      'val s = vm.x.collectAsState()',
    ].join('\n');
    expect(collectWriteSitesByName(text).get('_x')).toEqual([
      { line: 1, character: 12 },
      { line: 3, character: 12 },
    ]);
    expect(collectReaderSitesByName(text).get('x')).toEqual([{ line: 5, character: 11 }]);
  });
});

// ── Tampon non sauvegardé : le texte vivant, pas l'index disque ──────────────

describe('Structure d\'un fichier en cours d\'édition', () => {
  const URI = 'file:///a31/Live.kt';
  const SAVED = [
    'package p',
    '',
    'class Saved {',
    '    fun only() {',
    '        val x = 1',
    '    }',
    '}',
  ].join('\n');
  // Six lignes insérées en tête : dans l'index disque, Saved est encore ligne 2.
  const EDITED = [
    'package p',
    '',
    'class Added {',
    '    fun helper() {',
    '        val y = 2',
    '    }',
    '}',
    '',
    'class Saved {',
    '    fun only() {',
    '        val x = 1',
    '    }',
    '}',
  ].join('\n');

  function dirtyDoc(text: string) {
    const lines = text.split('\n');
    return {
      uri: { toString: () => URI, path: URI.replace('file://', '') },
      languageId: 'kotlin',
      version: 2,
      isDirty: true,
      getText: () => text,
      lineAt: (n: number) => {
        const t = lines[n] ?? '';
        return { text: t, range: { start: new Position(n, 0), end: new Position(n, t.length) } };
      },
      lineCount: lines.length,
    } as any;
  }

  function staleIndex() {
    const index = new SymbolIndex();
    index.add(parse(URI, SAVED));
    return index;
  }

  it('Expand Selection suit le texte à l\'écran', () => {
    const provider = new KotlinSelectionRangeProvider(staleIndex());
    const doc = dirtyDoc(EDITED);
    // Curseur sur `val x = 1`, ligne 10 du texte édité.
    const [range] = provider.provideSelectionRanges(doc, [new Position(10, 10)], {} as any);
    // Avant : l'index plaçait Saved lignes 2 à 6, aucun symbole ne contenait
    // la ligne 10, et l'expansion sautait droit au fichier entier.
    expect(range.range.start.line).toBeLessThanOrEqual(10);
    expect(range.range.end.line).toBeGreaterThanOrEqual(10);
    expect(range.range.start.line).toBeGreaterThan(6);
  });

  it('les plis de symboles suivent le texte à l\'écran', () => {
    const provider = new KotlinFoldingRangeProvider(staleIndex());
    const doc = dirtyDoc(EDITED);
    const regions = provider
      .provideFoldingRanges(doc, {} as any, {} as any)
      .filter(r => r.kind === FoldingRangeKind.Region)
      .map(r => [r.start, r.end]);
    // La classe ajoutée et la classe déplacée ont chacune leur pli.
    expect(regions).toContainEqual([2, 6]);
    expect(regions).toContainEqual([8, 12]);
  });

  it('le cache de pliage distingue le tampon sale du fichier sauvegardé', () => {
    // L'index reste celui du texte SAUVEGARDÉ, plus court de six lignes. Le
    // premier appel, sur tampon sale, lit le tampon et voit deux classes ; le
    // second, sur le même document sauvegardé et à la MÊME version, doit
    // revenir à l'index et n'en voir qu'une. Sans le drapeau `dirty` dans la
    // clé, il rejouait le résultat du tampon et le test échoue.
    const index = staleIndex();
    const provider = new KotlinFoldingRangeProvider(index);
    const dirty = dirtyDoc(EDITED);
    const fromBuffer = provider
      .provideFoldingRanges(dirty, {} as any, {} as any)
      .filter(r => r.kind === FoldingRangeKind.Region)
      .map(r => [r.start, r.end]);
    expect(fromBuffer).toContainEqual([2, 6]);
    expect(fromBuffer).toContainEqual([8, 12]);

    const saved = { ...dirty, isDirty: false };
    const fromIndex = provider
      .provideFoldingRanges(saved as any, {} as any, {} as any)
      .filter(r => r.kind === FoldingRangeKind.Region)
      .map(r => [r.start, r.end]);
    expect(fromIndex).toContainEqual([2, 6]);
    expect(fromIndex).not.toContainEqual([8, 12]);
  });
});

// ── XML : ce qui est commenté n'est pas actif, et rien ne doit planter ───────

describe('Badges de permission du manifeste', () => {
  it('une permission commentée ne reçoit pas de pastille', () => {
    const manifest = [
      '<manifest>',
      '    <!-- <uses-permission android:name="android.permission.CAMERA" /> -->',
      '    <uses-permission android:name="android.permission.INTERNET" />',
      '</manifest>',
    ].join('\n');
    const found = findManifestPermissionsInText(manifest);
    expect(found.length).toBe(1);
    expect(found[0].line).toBe(2);
  });

  it('un bloc commenté sur plusieurs lignes ne masque pas ce qui suit', () => {
    const manifest = [
      '<manifest>',
      '    <!--',
      '    <uses-permission android:name="android.permission.CAMERA" />',
      '    <uses-permission-sdk-23 android:name="android.permission.RECORD_AUDIO" />',
      '    -->',
      '    <uses-permission android:name="android.permission.INTERNET" />',
      '</manifest>',
    ].join('\n');
    const found = findManifestPermissionsInText(manifest);
    expect(found.map(f => f.line)).toEqual([5]);
    // La colonne est celle du vrai texte, pas du texte blanchi.
    expect(found[0].column).toBe(manifest.split('\n')[5].length);
  });
});

describe('Aperçu d\'un drawable vectoriel malformé', () => {
  const wrap = (pathData: string) =>
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="${pathData}" android:fillColor="#FF0000"/></vector>`;

  it('une entité numérique hors plage Unicode ne fait plus tomber l\'aperçu', () => {
    // Avant : RangeError: Invalid code point 999999999, et le panneau restait vide.
    expect(() => vectorXmlToSvg(wrap('M0,0 &#999999999; L24,24'))).not.toThrow();
    expect(() => vectorXmlToSvg(wrap('M0,0 &#x110000; L24,24'))).not.toThrow();
    expect(() => vectorXmlToSvg(wrap('M0,0 &#x7fffffffffff; L24,24'))).not.toThrow();
  });

  it('les entités valides sont toujours décodées', () => {
    const svg = vectorXmlToSvg(wrap('M0,0 &#76;24,24'));
    expect(svg).toContain('L24,24');
  });
});
