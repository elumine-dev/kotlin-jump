/**
 * Tout surveillant de fichiers doit etre libere.
 *
 * `createFileSystemWatcher` ouvre une surveillance native. Sans liberation
 * elle survit a la desactivation de l'extension, et ses rappels continuent
 * d'alimenter un index mort. Le compilateur n'en dit rien, aucun test de
 * comportement non plus : le surveillant fonctionne parfaitement, il ne
 * s'arrete simplement jamais.
 *
 * Ce gardien existe parce que le surveillant des XML de `res/`, ajoute en
 * 1.42.160, avait ete cree dans la fonction qui construit le disposable rendu
 * SANS figurer dans la liste de ce disposable.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RACINE = path.resolve(__dirname, '..', '..', 'src');
const ENTREES = ['extension.ts', 'extension.browser.ts'];

/** Les noms de variables affectees par un appel au createur de surveillant. */
function surveillants(source: string): string[] {
  const creation = 'create' + 'FileSystemWatcher(';
  const re = new RegExp('\\b(?:const|let)\\s+(\\w+)\\s*=\\s*vscode\\.workspace\\.' + creation.replace('(', '\\('), 'g');
  return [...source.matchAll(re)].map(m => m[1]);
}

/**
 * Ce nom figure-t-il dans une forme de liberation ?
 *
 * Quatre formes existent dans ces fichiers, et les quatre comptent :
 * une ligne de liste qui peut porter PLUSIEURS noms (`dW1, dW2,`), un
 * `subscriptions.push(...)`, un `.dispose()` direct, et le `return` d'une
 * fonction immediate passee elle meme a `push`.
 */
function libere(source: string, nom: string): boolean {
  const lignes = source.split(String.fromCharCode(10));
  // Une ligne de liste est une suite d'identifiants separes par des virgules,
  // et le nom doit en etre l'un des membres, pas forcement le dernier :
  // `dW1, dW2,` libere les deux.
  const estListe = (l: string) => /^\s*\w+(?:\s*,\s*\w+)*\s*,?\s*$/.test(l)
    && l.split(',').map(x => x.trim()).includes(nom);
  const pousse = new RegExp('subscriptions\\.push\\([^)]*\\b' + nom + '\\b');
  const direct = new RegExp('\\b' + nom + '\\.dispose\\(\\)');
  const rendu  = new RegExp('^\\s*return\\s+' + nom + '\\s*;\\s*$');
  return lignes.some(l => estListe(l) || pousse.test(l) || direct.test(l) || rendu.test(l));
}

describe('les surveillants de fichiers sont tous liberes', () => {
  for (const entree of ENTREES) {
    it(entree, () => {
      const source = fs.readFileSync(path.join(RACINE, entree), 'utf8');
      const noms = surveillants(source);
      // Le gardien doit voir quelque chose : sinon il passerait pour rien.
      expect(noms.length, 'des surveillants sont attendus dans ce fichier').toBeGreaterThan(5);
      expect(new Set(noms).size, 'aucun nom en double').toBe(noms.length);
      expect(noms.filter(n => !libere(source, n)), 'ces surveillants ne sont jamais liberes').toEqual([]);
    });
  }
});
