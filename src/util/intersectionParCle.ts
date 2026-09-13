/**
 * L'intersection d'une liste relue avec ce qui a ete annonce.
 *
 * Les commandes de masse rejugent l'espace de travail apres la question et ne
 * doivent garder que ce dont il a ete question (1.42.302). La cle d'identite
 * est textuelle, chemin et nom, parce qu'un offset ne survit pas a l'edition
 * qui a eu lieu entre temps. Elle n'est donc pas toujours unique : sur le
 * projet de reference, une ile morte pousse un groupe par membre et tous
 * portent le MEME libelle, donc deux des cinq groupes partagent leur cle.
 *
 * Une cle ambigue ne peut pas servir de consentement : elle ne dit pas lequel
 * des deux a ete annonce. La regle est donc le compte. Tant que le groupe
 * relu a exactement la taille du groupe annonce, il est intact et passe
 * entier. Des qu'elle differe, quelque chose a bouge la dedans et on refuse
 * de deviner : le groupe entier reste.
 *
 * Refuser est le seul cote sur. Retirer trop peu se rattrape en relancant la
 * commande ; retirer ce qui n'a pas ete annonce, non.
 */
export function intersectionParCle<T>(
  annonces: readonly T[],
  relus: readonly T[],
  cle: (x: T) => string,
): T[] {
  const compte = new Map<string, number>();
  for (const a of annonces) compte.set(cle(a), (compte.get(cle(a)) ?? 0) + 1);

  const relusParCle = new Map<string, T[]>();
  for (const r of relus) {
    const k = cle(r);
    const l = relusParCle.get(k) ?? [];
    l.push(r);
    relusParCle.set(k, l);
  }

  const out: T[] = [];
  for (const [k, groupe] of relusParCle) {
    const attendu = compte.get(k);
    if (attendu === undefined) continue;        // jamais annonce
    if (attendu !== groupe.length) continue;    // ambigu ET modifie : on ne devine pas
    out.push(...groupe);
  }
  return out;
}
