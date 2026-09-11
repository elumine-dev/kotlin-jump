import picomatch from 'picomatch';

/**
 * Le motif d'exclusion a passer a `findFiles`.
 *
 * `findFiles` ne prend qu'UN motif, alors que le reglage
 * `kotlinJump.excludePatterns` est une liste. On les assemblait donc en
 * `{a,b,c}`, ce qui cachait deux fautes, chacune verifiee sur minimatch ET
 * sur picomatch, ce dernier etant le moteur que `makeExclusionMatcher`
 * utilise vraiment pour le veilleur :
 *
 *  1. Les accolades etaient posees meme pour UNE seule entree. `{a}` n'est
 *     pas un groupe, les deux moteurs le lisent litteralement, donc
 *     `{**​/build/**}` n'excluait rien du tout.
 *  2. Dans un groupe, picomatch perd le cas « zero dossier » du prefixe
 *     `**​/` : `{**​/build/**,**​/.gradle/**}` n'attrape pas `build/x.kt` a la
 *     racine, alors que `**​/build/**` seul l'attrape. C'est la configuration
 *     PAR DEFAUT, sur la disposition la plus courante d'un projet Gradle a un
 *     seul module.
 *
 * Dans les deux cas le veilleur, lui, excluait bien ces fichiers puisqu'il
 * compile chaque motif separement : le balayage les indexait, le veilleur
 * refusait ensuite de les rafraichir, et les sources generees mangeaient le
 * plafond de fichiers indexes.
 *
 * D'ou l'expansion ci dessous : ecrire la profondeur zero en clair. C'est
 * toujours une branche EN PLUS, jamais une en moins, donc rien ne peut etre
 * exclu que l'utilisateur n'ait pas demande.
 */
export function excludeGlob(patterns: readonly string[]): string | undefined {
  const valides = patterns.filter(p => typeof p === 'string' && p.trim() !== '');
  if (valides.length === 0) return undefined; // pas `{}`, qui n'exclut rien
  const branches: string[] = [];
  for (const motif of valides) {
    branches.push(motif);
    if (motif.startsWith('**/')) branches.push(motif.slice(3));
  }
  const uniques = [...new Set(branches)];
  if (uniques.length === 1) return uniques[0];
  return `{${uniques.join(',')}}`;
}

export function makeExclusionMatcher(
  patterns: readonly string[],
  // Workspace folder paths: `app/build/**` is relative to one of them for
  // findFiles, and the watcher tested only the absolute path, so the first
  // Gradle build indexed `app/build/generated/**` behind the scan's back.
  roots: readonly string[] = [],
): (path: string) => boolean {
  // picomatch leve sur une chaine vide, et ce matcheur se construit en plein
  // `activate()` : une entree vide dans le reglage, chose qu'un editeur de
  // tableau produit d'un clic, tuait l'extension entiere.
  const valides = patterns.filter(p => typeof p === 'string' && p.trim() !== '');
  if (valides.length === 0) return () => false;
  const matchers = valides.map(p => picomatch(p, { dot: true }));
  const prefixes = roots.map(r => r.replace(/\/+$/, '') + '/');
  return (path: string) => {
    // Un motif de `findFiles` est relatif a la racine du workspace, donc le
    // chemin doit l'etre aussi. Le tester d'abord en absolu excluait tout un
    // projet range sous un dossier nomme `build` ou `generated`, ce qui
    // faisait taire l'extension sans un message.
    let sousUneRacine = false;
    for (const prefix of prefixes) {
      if (!path.startsWith(prefix)) continue;
      sousUneRacine = true;
      if (matchers.some(m => m(path.slice(prefix.length)))) return true;
    }
    if (sousUneRacine) return false;
    return matchers.some(m => m(path));
  };
}
