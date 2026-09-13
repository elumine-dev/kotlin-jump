/**
 * Une coupe ne doit jamais partager un commentaire de bloc avec ce qui reste.
 *
 * Trois chemins de suppression ont eu le meme defaut, chacun a sa facon : la
 * ligne d une declaration ouvre un `/*`, la coupe s arrete au retour a la
 * ligne, l ouverture part et la fermeture reste. Le fichier ne compile plus.
 *
 * Les deux questions ci dessous se posent au texte brut et a sa copie sans
 * commentaires, celle qui garde les chaines. La copie blanchie ne suffit pas :
 * elle vide aussi les guillemets, donc elle ne distingue pas un commentaire
 * d une chaine.
 */

const BLANC = /\s/;

/**
 * La coupe qui finit en `fin` laisse-t-elle derriere elle l interieur d un
 * commentaire de bloc ?
 *
 * Regarde le premier caractere qui suit la coupe. S il differe de la copie
 * sans commentaires, il est dans un commentaire ; et si ce commentaire
 * COMMENCE la, il appartient a ce qui suit et n enjambe rien.
 */
export function coupeUnBloc(text: string, sansCommentaires: () => string, fin: number): boolean {
  let j = fin;
  while (j < text.length && BLANC.test(text[j])) j++;
  if (j >= text.length) return false;
  const t = text.charCodeAt(j);
  if (t === 47 && (text.charCodeAt(j + 1) === 47 || text.charCodeAt(j + 1) === 42)) return false;
  return text[j] !== sansCommentaires()[j];
}

/**
 * L offset du `/*` que la coupe couperait, cherche entre `depuis` et `fin`,
 * ou -1.
 *
 * Remonter en comparant caractere a caractere ne marche pas : un espace du
 * commentaire est efface en espace, donc il se lit comme identique et la
 * remontee s arrete au premier mot, en plein milieu du commentaire.
 *
 * Le `text[i] !== sc[i]` ecarte une ouverture ecrite dans une chaine.
 */
export function debutDuBloc(text: string, sc: string, depuis: number, fin: number): number {
  for (let i = Math.min(fin, text.length - 2); i > depuis; i--) {
    if (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 42 && text[i] !== sc[i]) return i;
  }
  return -1;
}
