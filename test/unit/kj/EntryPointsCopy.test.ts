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

/**
 * Messages visibles a l interieur du gestionnaire de chaque commande.
 *
 * Comparer les phrases fichier par fichier ne suffit pas : un message peut
 * manquer d un cote sans qu aucune phrase ne diverge. `findUsages` disait sur
 * le bureau « open a Kotlin or Java file and put the cursor on a symbol
 * first. » et rendait la main EN SILENCE sur le web, alors que le message
 * existe justement pour le clic depuis la page de bienvenue, ou rien n est
 * focalise. Le lien paraissait casse.
 */
function messagesParCommande(fichier: string): Map<string, string[]> {
  const texte = readFileSync(path.join(RACINE, fichier), 'utf8');
  const sf = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true);
  const MSG = /^vscode\.window\.(showInformationMessage|showWarningMessage|showErrorMessage)$/;
  const out = new Map<string, string[]>();
  const visite = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && /registerCommand$/.test(n.expression.getText(sf))
        && n.arguments.length >= 2 && ts.isStringLiteralLike(n.arguments[0])) {
      const messages: string[] = [];
      const p = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && MSG.test(x.expression.getText(sf)) && x.arguments.length > 0) {
          messages.push(x.arguments[0].getText(sf));
        }
        ts.forEachChild(x, p);
      };
      p(n.arguments[1]);
      out.set(n.arguments[0].text, messages);
    }
    ts.forEachChild(n, visite);
  };
  visite(sf);
  return out;
}

/** Commandes dont le web dit legitimement autre chose, une par une. */
const COMMANDES_A_PART: readonly string[] = [];

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
    const commandes = messagesParCommande('src/extension.browser.ts');
    const inconnues = COMMANDES_A_PART.filter(id => !commandes.has(id));
    expect(inconnues, 'commande mise a part qui n existe plus, la retirer').toEqual([]);
  });

  it('une commande partagee ne se tait pas d un cote et parle de l autre', () => {
    const bureau = messagesParCommande('src/extension.ts');
    const web = messagesParCommande('src/extension.browser.ts');
    const communes = [...bureau.keys()].filter(id => web.has(id));
    expect(communes.length, 'sans commande commune, la regle ne prouve rien').toBeGreaterThan(30);
    const muettes: string[] = [];
    for (const id of communes) {
      if (COMMANDES_A_PART.includes(id)) continue;
      const cotesWeb = web.get(id) ?? [];
      // Le web remplace parfois la commande entiere par son message
      // d indisponibilite : la comparaison n a alors aucun sens.
      if (cotesWeb.some(m => m.includes('WEB_UNAVAILABLE'))) continue;
      for (const m of bureau.get(id) ?? []) {
        if (!cotesWeb.includes(m)) muettes.push(`${id} :: ${m.slice(0, 70)}`);
      }
    }
    expect(muettes, 'le web doit dire au moins ce que le bureau dit').toEqual([]);
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
