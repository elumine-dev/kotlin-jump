import type { Coupe } from '../commands/RemoveEverythingUnused';

/**
 * The key a cut travels under, from the plan to the batch that applies it.
 *
 * `famille \t path \t name`: the family that asked for the cut, the file,
 * and the name the cut answers to. Never an offset: offsets expire the moment
 * a first cut is applied, and the plan is read days after it was written. The
 * gate's own key (`path \t why`) is built the same way.
 */
export function cleDeBase(c: Coupe, path: string, texte: string): string {
  const nom = c.quoi || c.preuve?.nom || normalise(texte.slice(c.start, c.end));
  return `${c.famille}\t${path}\t${nom}`;
}

/** A repeated key carries `#n`; the base is what the batch filter compares. */
export function baseDe(cle: string): string {
  return cle.replace(/#\d+$/, '');
}

export function normalise(extrait: string): string {
  return extrait.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** `import a.b.C`, `import static a.B.c;`, `import a.b.C as D`: the imported name, or undefined for `*`. */
export function nomImporte(ligne: string): string | undefined {
  const m = /^\s*import\s+(?:static\s+)?([\w.]+)/.exec(ligne);
  if (!m) return undefined;
  const dernier = m[1].split('.').pop();
  return dernier && dernier !== '*' ? dernier : undefined;
}

/** The key of an import the cascade orphans, as the simulation and the live loop both build it. */
export function cleDImportOrphelin(path: string, ligne: string): string {
  return `imports\t${path}\t${nomImporte(ligne) ?? normalise(ligne)}`;
}

/** A source file that declares nothing, or a values file left without a key: `vides`; any other whole file: `ressources`. */
export function cleDuFichierMort(path: string): string {
  return `${estUnFichierVide(path) ? 'vides' : 'ressources'}\t${path}\tfile`;
}

const VALUES_RE = /[\\/]res[\\/]values[^\\/]*[\\/][^\\/]+\.xml$/;

export function estUnFichierVide(path: string): boolean {
  return /\.(kt|java)$/.test(path) || VALUES_RE.test(path);
}
