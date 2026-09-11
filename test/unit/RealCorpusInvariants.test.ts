/**
 * Invariants verifies sur un vrai projet, pas sur des fixtures.
 *
 * Ces controles ont ete ecrits au fil de plusieurs chasses et ont trouve de
 * vrais defauts, dont l'etiquette d'inlay hint redondante corrigee en
 * v1.42.140. Les figer ici evite de les reecrire, et surtout de ne rien voir
 * quand une regression touchera ces surfaces.
 *
 * Chaque controle porte une attente POSITIVE en plus de l'absence de
 * violation : un fournisseur devenu muet ne viole aucun invariant, et c'est
 * exactement le defaut corrige en v1.42.137.
 *
 * Ces planchers disent seulement « ce n'est pas muet », ils ne recopient PAS
 * la mesure du jour. Le projet de reference est un depot vivant : on y change
 * de branche, on y supprime des fichiers. Or `.publish` lance la suite
 * complete, donc un seuil colle au corpus actuel bloquerait une publication
 * sans rapport le jour ou ce corpus bouge. Un fournisseur casse rend zero,
 * donc un plancher large attrape exactement la meme chose.
 *
 * Le projet de reference n'existe que sur la machine de son auteur : ailleurs
 * ces tests sont sautes plutot que rouges.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { mockDocument } from './helpers';
import { Range, Position, workspace, SemanticTokensLegend } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinSemanticTokensProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/providers/SemanticTokensProvider';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { kdocReferences, sanitizeForUsageScan } from '../../src/util/kotlinScan';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';

const NL = String.fromCharCode(10);
const RACINE = '/Users/kevin/Desktop/work/lapresse';
/**
 * Les fichiers du corpus, ou une liste vide s'il n'est pas la.
 *
 * La presence se juge sur les SOURCES elles memes, pas sur un fichier voisin.
 * Juger sur `gradle/libs.versions.toml` laissait passer le cas ou ce fichier
 * existe alors que les sources ont disparu, un worktree ou une branche sans
 * les modules : les controles tournaient alors sur un corpus vide, tombaient
 * sur leur plancher, et `.publish` refusait une release sans rapport.
 */
function fichiersDuCorpus(): string[] {
  try {
    return execSync(
      `find ${RACINE} -type f -name '*.kt' -not -path '*/build/*' -not -path '*/.gradle/*' -not -path '*/generated/*'`,
      // stderr MUET : sans cela, `find` sur un chemin absent ecrit
      // `No such file or directory` a chaque execution de la suite. Sur une
      // machine sans le projet, donc la CI, ce message part dans un journal
      // public a chaque build, ressemble a une panne, et y publie le chemin
      // local de l'auteur.
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim().split(NL).filter(Boolean);
  } catch {
    return []; // projet absent : rien a verifier, on saute
  }
}

const FICHIERS = fichiersDuCorpus();
const present = FICHIERS.length >= 200;
const MOT = /[A-Za-z0-9_$]/;
const NUL = { info() {}, debug() {}, warn() {}, error() {} } as any;

let corpus: Map<string, string> | undefined;
let indexPartage: SymbolIndex | undefined;

function charger(): { textes: Map<string, string>; index: SymbolIndex } {
  if (corpus && indexPartage) return { textes: corpus, index: indexPartage };
  const textes = new Map<string, string>();
  const index = new SymbolIndex();
  for (const f of FICHIERS) {
    let t: string;
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    textes.set('file://' + f, t);
    try { index.add(parse('file://' + f, t)); } catch { /* illisible pour le parseur */ }
  }
  index.finalize();
  corpus = textes; indexPartage = index;
  return { textes, index };
}


/**
 * Execute `corps` avec `openTextDocument` bouchonne sur le corpus, puis REND
 * la fonction d'origine.
 *
 * Une seule implementation, parce que les deux tests qui en ont besoin la
 * portaient en copie et que la seconde posait le bouchon AVANT de le
 * capturer : elle restaurait donc le bouchon lui meme, et il fuyait. Rien ne
 * le signalait, l'isolation de vitest masquant la fuite.
 */
async function avecOuvertureBouchonnee<T>(
  textes: Map<string, string>,
  corps: () => Promise<T>,
): Promise<T> {
  const orig = (workspace as any).openTextDocument;
  (workspace as any).openTextDocument = async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    const t = textes.get(uri);
    return t === undefined ? null : mockDocument(uri, t);
  };
  try {
    return await corps();
  } finally {
    (workspace as any).openTextDocument = orig;
  }
}

describe('le bouchon d ouverture est toujours rendu', () => {
  it('apres un corps qui reussit', async () => {
    const sentinelle = async () => null;
    const avant = (workspace as any).openTextDocument;
    (workspace as any).openTextDocument = sentinelle;
    await avecOuvertureBouchonnee(new Map(), async () => undefined);
    const apres = (workspace as any).openTextDocument;
    (workspace as any).openTextDocument = avant;
    expect(apres, 'la fonction d origine doit etre rendue').toBe(sentinelle);
  });

  it('et apres un corps qui leve', async () => {
    const sentinelle = async () => null;
    const avant = (workspace as any).openTextDocument;
    (workspace as any).openTextDocument = sentinelle;
    await expect(avecOuvertureBouchonnee(new Map(), async () => { throw new Error('boum'); }))
      .rejects.toThrow('boum');
    const apres = (workspace as any).openTextDocument;
    (workspace as any).openTextDocument = avant;
    expect(apres).toBe(sentinelle);
  });
});

describe.skipIf(!present)('jetons semantiques sur un vrai projet', () => {
  it('encodage delta, bornes et legende tiennent sur tout le corpus', () => {
    const { textes, index } = charger();
    const provider = new KotlinSemanticTokensProvider(index, new SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS) as any);
    const pb: string[] = [];
    let jetons = 0;
    for (const [uri, texte] of textes) {
      const lignes = texte.split(NL);
      const res: any = provider.provideDocumentSemanticTokens(mockDocument(uri, texte) as any, { isCancellationRequested: false } as any);
      const data: number[] = res?.data ? Array.from(res.data as any) : [];
      if (data.length % 5 !== 0) { pb.push(uri + ' : donnees non multiples de 5'); continue; }
      let ligne = 0, col = 0, precLigne = -1, precFin = -1;
      for (let i = 0; i < data.length; i += 5) {
        const dl = data[i], dc = data[i + 1], len = data[i + 2], type = data[i + 3];
        jetons++;
        if (dl < 0 || dc < 0 || len <= 0) { pb.push(uri + ' : delta negatif'); break; }
        ligne += dl; col = dl === 0 ? col + dc : dc;
        if (ligne >= lignes.length) { pb.push(uri + ':' + ligne + ' hors document'); break; }
        if (col + len > lignes[ligne].length) { pb.push(uri + ':' + (ligne + 1) + ' jeton qui deborde de sa ligne'); break; }
        if (type < 0 || type >= TOKEN_TYPES.length) { pb.push(uri + ' : type hors legende'); break; }
        if (ligne === precLigne && col < precFin) { pb.push(uri + ':' + (ligne + 1) + ' jetons qui se chevauchent'); break; }
        precLigne = ligne; precFin = col + len;
      }
    }
    expect(jetons, 'le corpus doit vraiment produire des jetons').toBeGreaterThan(1_000);
    expect(pb.slice(0, 10)).toEqual([]);
  });
});

describe.skipIf(!present)('inlay hints sur un vrai projet', () => {
  it('chaque hint tient dans sa ligne et ne coupe pas un mot', async () => {
    const { textes, index } = charger();
    const provider = new KotlinInlayHintsProvider(index, NUL);
    const pb: string[] = [];
    let hints = 0, redondants = 0;
    await avecOuvertureBouchonnee(textes, async () => {
      for (const [uri, texte] of textes) {
      const lignes = texte.split(NL);
      const range = new Range(new Position(0, 0), new Position(lignes.length - 1, lignes[lignes.length - 1].length));
      let res: any[] = [];
      try { res = (await provider.provideInlayHints(mockDocument(uri, texte) as any, range as any, { isCancellationRequested: false } as any)) ?? []; }
      catch (e) { pb.push(uri + ' : ' + (e as Error).message); continue; }
      for (const h of res) {
        hints++;
        const l = h.position.line, c = h.position.character;
        if (l < 0 || l >= lignes.length) { pb.push(uri + ':' + l + ' hors document'); continue; }
        const L = lignes[l];
        if (c < 0 || c > L.length) { pb.push(uri + ':' + (l + 1) + ' colonne hors ligne'); continue; }
        const et = typeof h.label === 'string' ? h.label : (h.label ?? []).map((p: any) => p.value ?? '').join('');
        if (!et) { pb.push(uri + ':' + (l + 1) + ' etiquette vide'); continue; }
        if (c > 0 && c < L.length && MOT.test(L[c - 1]) && MOT.test(L[c])) pb.push(uri + ':' + (l + 1) + ' hint plante dans un mot');
        // v1.42.140 : plus aucune etiquette ne doit repeter son argument.
        if (et.endsWith(':')) {
          const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/.exec(L.slice(c));
          if (m && m[1] === et.slice(0, -1)) redondants++;
        }
      }
    }
    });
    expect(hints, 'le corpus doit vraiment produire des hints').toBeGreaterThan(500);
    expect(redondants, 'etiquette qui repete son argument').toBe(0);
    expect(pb.slice(0, 10)).toEqual([]);
  }, 120_000);
});

describe.skipIf(!present)('les deux lecteurs de commentaires restent d accord', () => {
  it('toute reference de documentation tombe la ou le sanitizer a efface', () => {
    // `kdocReferences` et `sanitizeForUsageScan` sont deux lectures de la meme
    // question, dans le meme fichier source. Elles doivent designer les memes
    // commentaires, sinon un import cite en KDoc redevient signale mort.
    const { textes } = charger();
    const pb: string[] = [];
    let refs = 0;
    for (const [uri, t] of textes) {
      const noms = kdocReferences(t);
      if (noms.size === 0) continue;
      const propre = sanitizeForUsageScan(t);
      for (const nom of noms) {
        refs++;
        const re = new RegExp('\\[' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        let m: RegExpExecArray | null, vue = false, dansCommentaire = false;
        while ((m = re.exec(t)) !== null) {
          vue = true;
          if (propre[m.index + 1] === ' ' && t[m.index + 1] !== ' ') { dansCommentaire = true; break; }
        }
        if (vue && !dansCommentaire) pb.push(uri + ' [' + nom + ']');
      }
    }
    expect(refs, 'le corpus doit vraiment porter des references de doc').toBeGreaterThan(50);
    expect(pb.slice(0, 10)).toEqual([]);
  });
});

/**
 * Gardien : ce fichier lance un processus externe au CHARGEMENT du module,
 * donc sur toute machine, y compris celles qui n'ont pas le projet. Une
 * sortie d'erreur heritee y salit chaque build.
 */
describe('le lancement de find reste muet', () => {
  it('stderr est explicitement ignore', () => {
    // Motifs assembles a l'execution : ecrits en clair, ils apparaitraient
    // dans CE fichier et le gardien se satisferait lui meme. C'est le defaut
    // corrige en v1.42.137, retrouve en s'ecrivant.
    const APPEL = 'exec' + 'Sync(';
    const MUET = "stdio: ['ig" + "nore', 'pipe', 'ignore']";
    const source = fs.readFileSync(__filename.replace(/\.js$/, '.ts'), 'utf8');
    expect(source.split(APPEL).length - 1, 'un seul appel externe attendu').toBe(1);
    expect(source.includes(MUET), 'stderr doit etre ignore a cet appel').toBe(true);
  });
});

/**
 * Ou mene le Ctrl+clic sur du vrai code.
 *
 * Invariant auto-evident : la ligne atteinte doit contenir le mot cliqué.
 * C'est ce controle qui a trouve les deux defauts les plus visibles de cette
 * serie, le type d'un parametre par defaut qui menait a la fonction
 * englobante (699 clics sur 785) et l'argument nomme qui ouvrait une fonction
 * sans ce parametre (266 sur 651).
 *
 * Trois familles sortent de l'invariant sans etre fausses, et sont comptees a
 * part : un clic SUR une declaration lance la navigation vers ses
 * implementations, un alias d'import mene a un nom different par
 * construction, et `Companion` mene a `companion object`, que la casse
 * separe.
 */
describe.skipIf(!present)('ou mene le Ctrl+clic sur un vrai projet', () => {
  it('aucune navigation ne quitte le mot cliqué', async () => {
    const { textes, index } = charger();
    const entries: any[] = (index as any).allEntries?.() ?? [];
    const declPos = new Set<string>();
    for (const e of entries) declPos.add(e.uri.toString() + ':' + e.line + ':' + e.character);
    const provider = new KotlinDefinitionProvider(index);
    const token = { isCancellationRequested: false } as any;
    const MOT = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])/g;
    const suspects: string[] = [];
    let resolus = 0;
    await avecOuvertureBouchonnee(textes, async () => {
      // Un fichier sur 40 : assez pour couvrir toutes les formes, assez peu
      // pour rester sous deux secondes.
      const echantillon = [...textes.entries()].filter((_, i) => i % 40 === 0);
      for (const [uri, texte] of echantillon) {
        const lignes = texte.split(NL);
        const doc = mockDocument(uri, texte);
        const aAlias = (mot: string) => new RegExp('\\sas\\s+' + mot + '\\s*$', 'm').test(texte);
        for (let l = 0; l < lignes.length; l++) {
          const L = lignes[l];
          if (/^\s*(import|package|\/\/|\*)/.test(L)) continue;
          MOT.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = MOT.exec(L)) !== null) {
            if (declPos.has(uri + ':' + l + ':' + m.index)) continue;
            let r: any;
            try { r = await provider.provideDefinition(doc as any, new Position(l, m.index + 1) as any, token); }
            catch { continue; }
            const loc = Array.isArray(r) ? r[0] : r;
            if (!loc?.range) continue;
            const tc = textes.get(loc.uri.toString());
            if (tc === undefined) continue;
            resolus++;
            const dp = loc.range.start ?? loc.range;
            const ligneCible = tc.split(NL)[dp.line] ?? '';
            if (new RegExp('(?<![A-Za-z0-9_])' + m[0] + '(?![A-Za-z0-9_])').test(ligneCible)) continue;
            if (aAlias(m[0]) || m[0] === 'Companion') continue;
            suspects.push(uri + ':' + (l + 1) + ' ' + m[0] + ' -> ' + loc.uri + ':' + (dp.line + 1));
          }
        }
      }
    });
    expect(resolus, 'le corpus doit vraiment resoudre des clics').toBeGreaterThan(100);
    expect(suspects.slice(0, 10)).toEqual([]);
  }, 120_000);
});
