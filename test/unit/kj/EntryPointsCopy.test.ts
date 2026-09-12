/**
 * Ce que le web affiche, le bureau l affiche mot pour mot.
 *
 * `src/extension.ts` et `src/extension.browser.ts` sont deux implantations de
 * la meme extension. La passe de tirets de la v1.42.201 a reecrit la meme
 * phrase des deux cotes, chacune a sa façon, et les trois selecteurs de la
 * commande « aller au test » et de « copier le nom qualifie » se sont mis a
 * dire deux choses differentes selon l endroit ou l extension tourne :
 *
 *   bureau  « Multiple matches, pick the implementation file »
 *   web     « Multiple matches. Pick implementation file »
 *
 * Le web peut avoir des messages a lui, il ne peut pas dire AUTREMENT ce que
 * le bureau dit deja. Les exceptions se nomment une par une, et une exception
 * qui ne correspond plus a rien fait echouer la suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const RACINE = path.resolve(__dirname, '..', '..', '..');

/** Le texte SOURCE de chaque `placeHolder:`, gabarit compris. */
function marquePlaces(fichier: string): string[] {
  const texte = readFileSync(path.join(RACINE, fichier), 'utf8');
  const sf = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visite = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'placeHolder') {
      out.push(n.initializer.getText(sf));
    }
    ts.forEachChild(n, visite);
  };
  visite(sf);
  return out;
}

/**
 * Marque places que le web est seul a montrer, avec la raison. Aucun
 * aujourd hui : les deux fichiers offrent les memes selecteurs.
 */
const WEB_SEUL: readonly string[] = [];

describe('les deux points d entree disent la meme chose', () => {
  it('chaque marque place du web existe mot pour mot cote bureau', () => {
    const bureau = new Set(marquePlaces('src/extension.ts'));
    const web = marquePlaces('src/extension.browser.ts');
    expect(web.length, 'sans marque place lu, la comparaison ne prouve rien').toBeGreaterThan(0);
    const divergents = web.filter(m => !bureau.has(m) && !WEB_SEUL.includes(m));
    expect(divergents, 'aligner le web sur le texte du bureau, ou nommer l exception').toEqual([]);
  });

  it('aucune exception ne survit a ce qu elle protegeait', () => {
    const web = marquePlaces('src/extension.browser.ts');
    const perimees = WEB_SEUL.filter(m => !web.includes(m));
    expect(perimees, 'exception devenue inutile, la retirer').toEqual([]);
  });

  it('temoin : les trois phrases qui avaient diverge sont bien comparees', () => {
    // Sans elles, la regle comparerait deux listes vides et passerait pour
    // rien. Elles sont la, des deux cotes, au mot pres.
    const bureau = marquePlaces('src/extension.ts');
    const web = marquePlaces('src/extension.browser.ts');
    for (const attendu of [
      'Multiple matches, pick the ${isTest ? \'implementation\' : \'test\'} file',
      'Multiple matches, pick the ${isComposable ? \'preview\' : \'composable\'}',
      'Multiple matches for ${word}, pick the FQN to copy',
    ]) {
      expect(bureau.some(m => m.includes(attendu)), attendu).toBe(true);
      expect(web.some(m => m.includes(attendu)), attendu).toBe(true);
    }
  });
});
