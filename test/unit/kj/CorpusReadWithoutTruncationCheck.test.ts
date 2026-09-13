import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT, aplatirSource, ligneDe } from './harness';

/**
 * Un corpus lu est un corpus dont on regarde s il est complet.
 *
 * `ResourceCorpus` rend un `sourcesTruncated` qui dit qu il n a pas pu tout
 * lire, et le contrat de la maison est ecrit dans la classe elle meme : un
 * balayage incomplet ne peut pas prouver une absence. Toutes les commandes le
 * respectent a leur porte d entree, de deux facons legitimes : une garde qui
 * rend la main, ou le drapeau passe au detecteur, qui a sa propre regle de
 * contrat.
 *
 * La boucle du point fixe de « Remove Everything Unused » ne le faisait ni l
 * un ni l autre a partir de la deuxieme ronde. Elle a supprime du code vivant
 * pour cette raison, corrige en 1.42.294. La garde etait POSEE AVANT la
 * boucle, et le premier tour n est pas le cas dangereux.
 *
 * Ce gardien lit l EXPRESSION, pas la ligne, et demande que le drapeau
 * commande quelque chose : le mentionner ne suffit pas.
 */

const RACINE = path.join(REPO_ROOT, 'src');

const fichiers = (dir: string): string[] => {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
};

/** `const x = await …corpus….get(…)`, sous ses formes directes et ternaires. */
const LIAISON = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,90}?await\s+[\w.]*[Cc]orpus[\w]*\.get\s*\(/g;

describe('tout corpus lu est confronte a sa troncature', () => {
  const lus: { fichier: string; ligne: number; nom: string; portee: string }[] = [];
  for (const f of fichiers(RACINE)) {
    const texte = readFileSync(f, 'utf8');
    if (!/\.get\s*\(/.test(texte)) continue;
    const { plat, ou } = aplatirSource(texte);
    for (const m of plat.matchAll(LIAISON)) {
      lus.push({
        fichier: path.relative(REPO_ROOT, f),
        ligne: ligneDe(texte, ou, m.index!),
        nom: m[1],
        portee: plat.slice(m.index!, m.index! + 1500),
      });
    }
  }

  it('temoin : le depot lit bien un corpus a plusieurs endroits', () => {
    expect(lus.length).toBeGreaterThanOrEqual(5);
  });

  it('chacun garde la main ou passe le drapeau au detecteur', () => {
    const aveugles = lus.filter(l => {
      const drapeau = `${l.nom}\\.(?:sourcesTruncated|truncated)`;
      // Trois facons legitimes de s'en acquitter, et trois seulement : une
      // garde qui rend la main, le drapeau passe au detecteur qui a sa propre
      // regle de contrat, ou le drapeau rendu a l'appelant, qui devient alors
      // celui qui doit en faire quelque chose. La troisieme se lit comme la
      // deuxieme, `truncated: x.sourcesTruncated` dans un objet, et c'est
      // voulu : deleguer n'est pas ignorer.
      const garde = new RegExp(`if\\s*\\([^)]*${drapeau}`);
      const passe = new RegExp(`truncated:\\s*${drapeau}`);
      return !garde.test(l.portee) && !passe.test(l.portee);
    }).map(l => `${l.fichier}:${l.ligne} (${l.nom})`);
    expect(aveugles, 'un corpus consomme sans savoir s il est complet').toEqual([]);
  });

  it('mentionner le drapeau sans en rien faire ne compte pas', () => {
    // La regle est verifiee sur une portee fabriquee, pour qu elle ne depende
    // pas de ce que le depot contient aujourd hui.
    const drapeau = 'data\\.(?:sourcesTruncated|truncated)';
    const garde = new RegExp(`if\\s*\\([^)]*${drapeau}`);
    const passe = new RegExp(`truncated:\\s*${drapeau}`);
    const muet = 'const data = await corpus.get(); void data.sourcesTruncated; use(data.sources);';
    expect(garde.test(muet) || passe.test(muet)).toBe(false);
    const gardee = 'const data = await corpus.get(); if (data.sourcesTruncated) return; use(data.sources);';
    expect(garde.test(gardee)).toBe(true);
    const passee = 'const data = await corpus.get(); find({ sources: data.sources, truncated: data.sourcesTruncated });';
    expect(passe.test(passee)).toBe(true);
  });
});
