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

const NL = String.fromCharCode(10);
const RACINE = '/Users/kevin/Desktop/work/lapresse';
const present = fs.existsSync(RACINE + '/gradle/libs.versions.toml');
const MOT = /[A-Za-z0-9_$]/;
const NUL = { info() {}, debug() {}, warn() {}, error() {} } as any;

let corpus: Map<string, string> | undefined;
let indexPartage: SymbolIndex | undefined;

function charger(): { textes: Map<string, string>; index: SymbolIndex } {
  if (corpus && indexPartage) return { textes: corpus, index: indexPartage };
  const fichiers = execSync(
    `find ${RACINE} -type f -name '*.kt' -not -path '*/build/*' -not -path '*/.gradle/*' -not -path '*/generated/*'`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split(NL).filter(Boolean);
  const textes = new Map<string, string>();
  const index = new SymbolIndex();
  for (const f of fichiers) {
    let t: string;
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    textes.set('file://' + f, t);
    try { index.add(parse('file://' + f, t)); } catch { /* illisible pour le parseur */ }
  }
  index.finalize();
  corpus = textes; indexPartage = index;
  return { textes, index };
}

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
    // Bouchon GLOBAL : il doit etre rendu, sinon il fuit sur les tests qui
    // suivent. L'isolation de vitest le masquerait aujourd'hui, mais elle se
    // desactive d'une ligne de configuration.
    const origOuvrir = (workspace as any).openTextDocument;
    (workspace as any).openTextDocument = async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      const t = textes.get(uri);
      return t === undefined ? null : mockDocument(uri, t);
    };
    const provider = new KotlinInlayHintsProvider(index, NUL);
    const pb: string[] = [];
    let hints = 0, redondants = 0;
    try {
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
    } finally {
      (workspace as any).openTextDocument = origOuvrir;
    }
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
