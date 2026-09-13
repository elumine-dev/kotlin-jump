import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Une commande declarée dans package.json doit etre enregistree par CHAQUE
 * hote qui la propose.
 *
 * Sans clause `when`, une commande apparait dans la palette des deux cotes.
 * Si le point d entree navigateur ne l enregistre pas, la palette de
 * vscode.dev la propose et l invoquer rend
 * « command 'kotlin-jump.x' not found ».
 *
 * Trois commandes etaient dans ce cas, dont deux depuis la 1.42.222, alors que
 * leur soeur destructive `removeAllUnusedResourceKeys` etait bien branchee des
 * deux cotes : ce n etait donc pas une politique, c etait un oubli.
 *
 * Les identifiants sont parfois assembles (`kotlinJump.${nom}`), donc le nom
 * nu compte autant que l identifiant complet. C est la premiere version de ce
 * gardien qui l a appris, en accusant douze bascules parfaitement branchees.
 */

const depot = path.resolve(__dirname, '..', '..', '..');

/** Tous les fichiers de `src` atteignables depuis une entree, par import. */
function atteignables(entree: string): Set<string> {
  const vus = new Set<string>();
  const pile = [path.resolve(depot, entree)];
  while (pile.length > 0) {
    const f = pile.pop()!;
    if (vus.has(f)) continue;
    if (!fs.existsSync(f)) continue;
    vus.add(f);
    const texte = fs.readFileSync(f, 'utf8');
    for (const m of texte.matchAll(/from\s+'(\.[^']*)'/g)) {
      const brut = path.resolve(path.dirname(f), m[1]);
      for (const candidat of [`${brut}.ts`, path.join(brut, 'index.ts'), brut]) {
        if (fs.existsSync(candidat) && candidat.endsWith('.ts')) { pile.push(candidat); break; }
      }
    }
  }
  return vus;
}

/**
 * Ce que l hote navigateur ne peut pas offrir, avec la raison. La description
 * de `capabilities.virtualWorkspaces` dans package.json nomme deja ces
 * familles comme indisponibles.
 */
const HORS_NAVIGATEUR = new Map<RegExp, string>([
  [/^kotlin-jump\.(runAndroid|switchAndroidApp|resetAndroidRunConfig|connectAdbWifi|pairAdbWifi)$/, 'Android Run et ADB'],
  [/^kotlinJump\.logcat\./, 'Logcat'],
  [/^kotlin-jump\.(diagnoseGradleDetection|resetGradleProject|pickGradleProject)$/, 'detection Gradle locale'],
  [/^kotlin-jump\.sources\./, 'scan des JAR de sources'],
]);

const contenu = (fichiers: Set<string>): Map<string, string> =>
  new Map([...fichiers].map(f => [f, fs.readFileSync(f, 'utf8')]));

const echappe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/**
 * Enregistree, et de facon que le gardien puisse en voir la disparition.
 *
 * La premiere version cherchait le nom nu entre quotes n'importe ou dans
 * l'hote. Elle avait ete elargie a ce point parce que douze bascules sont
 * enregistrees par un identifiant ASSEMBLE, `kotlinJump.${cmd}`, et qu'un
 * identifiant assemble n'apparait nulle part en entier. Mais un nom nu comme
 * `surroundWith` sert aussi de cle de reglage ou de constante ailleurs :
 * mesure, 18 des 88 commandes pouvaient perdre leur `registerCommand` sur
 * l'hote navigateur sans que ce test bronche, et `kotlin-jump.surroundWith`
 * l'a prouve en mutation.
 *
 * La forme assemblee se lit donc dans le FICHIER qui porte le gabarit, et
 * seulement si le prefixe litteral du gabarit prefixe l'identifiant : le reste
 * de l'identifiant doit y figurer entre quotes, c'est a dire dans la table que
 * la boucle parcourt.
 */
const enregistreeDans = (src: Map<string, string>, id: string): boolean => {
  const appelDirect = new RegExp(`registerCommand\\(\\s*['"\`]${echappe(id)}['"\`]`);
  for (const texte of src.values()) if (appelDirect.test(texte)) return true;
  for (const texte of src.values()) {
    for (const m of texte.matchAll(/registerCommand\(\s*`([^`$]*)\$\{/g)) {
      const prefixe = m[1];
      if (!id.startsWith(prefixe)) continue;
      const reste = id.slice(prefixe.length);
      if (reste === '') continue;
      if (new RegExp(`['"\`]${echappe(reste)}['"\`]`).test(texte)) return true;
    }
  }
  return false;
};

/** La meme question, l'enregistrement de CETTE commande efface du texte. */
const enregistreeSansElle = (src: Map<string, string>, id: string): boolean => {
  const appelDirect = new RegExp(`registerCommand\\(\\s*['"\`]${echappe(id)}['"\`]`, 'g');
  const ampute = new Map<string, string>();
  for (const [f, texte] of src) {
    let t = texte.replace(appelDirect, 'registerCommand(  ');
    for (const m of texte.matchAll(/registerCommand\(\s*`([^`$]*)\$\{/g)) {
      const prefixe = m[1];
      if (!id.startsWith(prefixe)) continue;
      const reste = id.slice(prefixe.length);
      if (reste === '') continue;
      t = t.replace(new RegExp(`['"\`]${echappe(reste)}['"\`]`, 'g'), "''");
    }
    ampute.set(f, t);
  }
  return enregistreeDans(ampute, id);
};

describe('chaque commande declaree a un hote', () => {
  const commandes: string[] = (JSON.parse(
    fs.readFileSync(path.join(depot, 'package.json'), 'utf8'),
  ).contributes.commands ?? []).map((c: any) => c.command);

  const srcNode = contenu(atteignables('src/extension.ts'));
  const srcWeb = contenu(atteignables('src/extension.browser.ts'));
  const taille = (m: Map<string, string>) => [...m.values()].join('').length;

  it('temoin : le graphe d imports atteint bien les deux entrees', () => {
    expect(taille(srcNode)).toBeGreaterThan(100_000);
    expect(taille(srcWeb)).toBeGreaterThan(100_000);
    expect(commandes.length).toBeGreaterThan(50);
  });

  it('toutes sont enregistrees par l hote Node', () => {
    expect(commandes.filter(c => !enregistreeDans(srcNode, c))).toEqual([]);
  });

  it('toutes sont enregistrees par l hote navigateur, sauf celles qu il ne peut pas offrir', () => {
    const attendues = commandes.filter(c => ![...HORS_NAVIGATEUR.keys()].some(r => r.test(c)));
    expect(attendues.filter(c => !enregistreeDans(srcWeb, c))).toEqual([]);
  });

  it('le gardien voit disparaitre chacune, une par une', () => {
    const attendues = commandes.filter(c => ![...HORS_NAVIGATEUR.keys()].some(r => r.test(c)));
    expect(attendues.filter(c => enregistreeSansElle(srcWeb, c)),
      'commandes dont la disparition passerait inapercue').toEqual([]);
    expect(commandes.filter(c => enregistreeSansElle(srcNode, c))).toEqual([]);
  });

  it('aucune exemption ne survit a la commande qu elle couvrait', () => {
    const inutiles = [...HORS_NAVIGATEUR.entries()]
      .filter(([r]) => !commandes.some(c => r.test(c)))
      .map(([r, quoi]) => `${quoi} : ${r}`);
    expect(inutiles).toEqual([]);
  });
});
