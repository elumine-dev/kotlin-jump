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

const contenu = (fichiers: Set<string>): string =>
  [...fichiers].map(f => fs.readFileSync(f, 'utf8')).join('\n');

describe('chaque commande declaree a un hote', () => {
  const commandes: string[] = (JSON.parse(
    fs.readFileSync(path.join(depot, 'package.json'), 'utf8'),
  ).contributes.commands ?? []).map((c: any) => c.command);

  const srcNode = contenu(atteignables('src/extension.ts'));
  const srcWeb = contenu(atteignables('src/extension.browser.ts'));

  const enregistree = (src: string, id: string): boolean =>
    src.includes(`'${id}'`) || src.includes(`"${id}"`)
    || src.includes(`'${id.slice(id.lastIndexOf('.') + 1)}'`);

  it('temoin : le graphe d imports atteint bien les deux entrees', () => {
    expect(srcNode.length).toBeGreaterThan(100_000);
    expect(srcWeb.length).toBeGreaterThan(100_000);
    expect(commandes.length).toBeGreaterThan(50);
  });

  it('toutes sont enregistrees par l hote Node', () => {
    expect(commandes.filter(c => !enregistree(srcNode, c))).toEqual([]);
  });

  it('toutes sont enregistrees par l hote navigateur, sauf celles qu il ne peut pas offrir', () => {
    const attendues = commandes.filter(c => ![...HORS_NAVIGATEUR.keys()].some(r => r.test(c)));
    expect(attendues.filter(c => !enregistree(srcWeb, c))).toEqual([]);
  });

  it('aucune exemption ne survit a la commande qu elle couvrait', () => {
    const inutiles = [...HORS_NAVIGATEUR.entries()]
      .filter(([r]) => !commandes.some(c => r.test(c)))
      .map(([r, quoi]) => `${quoi} : ${r}`);
    expect(inutiles).toEqual([]);
  });
});
