/**
 * Les comptes affiches a l utilisateur s accordent.
 *
 * Plusieurs endroits ecrivaient le pluriel en dur a cote d un compte, donc un
 * seul element donnait « 1 screens », « 1 declarations », « 1 file(s) »,
 * « 1 findings », « 1 tests ». Le meme depot accordait pourtant deja
 * correctement a plusieurs autres endroits : la forme etait connue, elle
 * n etait simplement pas partagee.
 *
 * Le gardien lui meme avait deux trous, tous deux prouves plus bas :
 *
 * 1. Il ne regardait que le mot COLLE au compte. Un nom en deux mots passait
 *    donc entier : `downloading ${coordsAll.length} library sources` etait
 *    invisible, alors que la ligne 54 du meme fichier avait ete corrigee.
 * 2. La tolerance portait sur le FICHIER. `src/extension.ts` et son jumeau
 *    navigateur, soit plus de deux mille lignes chacun, etaient exemptes en
 *    entier, et une entree devenue inutile restait sans que rien ne le dise.
 *    Quatre des dix fichiers tolerés ne portaient plus aucune faute.
 *
 * La tolerance se declare ligne par ligne maintenant, et une entree qui ne
 * correspond plus a rien fait echouer la suite.
 */
import { describe, it, expect } from 'vitest';
import { plural } from '../../src/util/plural';

describe('plural', () => {
  it('un est singulier, zero et plus sont pluriels', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'file')).toBe('2 files');
  });

  it('un pluriel irregulier peut etre donne', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('temoin : un nombre negatif n est pas traite a part', () => {
    expect(plural(-1, 'file')).toBe('-1 files');
  });
});

/**
 * Sites qui ne peuvent pas valoir un, ou dont le pluriel est celui d un
 * rapport (`1/12 libs missing` se lit tres bien). Un extrait de la ligne
 * plutot que son numero, qui derive au premier ajout au dessus.
 */
const TOLERES: Record<string, readonly string[]> = {
  // Le bouton `ambiguous` ne s affiche qu a partir de deux candidats.
  'src/commands/AndroidRunCommand.ts': ['${result.candidates.length} candidates'],
  // Infobulle d index : seul un projet d un fichier a un symbole la lirait.
  'src/extension.ts': [
    'symbols in ${files} files',
    'symbols in ${f} files',
    'the first ${maxFiles} files only',
  ],
  'src/extension.browser.ts': [
    'symbols in ${files} files',
    'the first ${maxFiles} files only',
  ],
  // `defs.length < 2` retourne avant.
  'src/providers/ResourceShadowingProvider.ts': ['${defs.length} definitions'],
  // Rapports : `1/1 branches`, `1/12 libs missing`.
  'src/providers/SealedWhenCoverageProvider.ts': [
    '${total}/${total} branches',
    '${a.covered.size}/${total} branches',
  ],
  'src/ui/SourcesStatusBar.ts': ['${s.missingCoords}/${total} libs missing'],
};

/**
 * Un compte, puis jusqu a deux mots, puis un nom au pluriel. Les deux formes
 * du compte : calcule sur place, ou deja range dans une variable.
 */
const COMPTE = /\$\{[^}]*(?:length|size|count)[^}]*\}\s+(?:[a-z]+\s+){0,2}([a-z]+s)\b|\$\{[A-Za-z_][\w.]*\}\s+(?:[a-z]+\s+){0,2}([a-z]+s)\b/;
const LOG = /\.(debug|info|warn|error|appendLine)\s*\(|console\.\w+\s*\(|\blog\s*\(|\btrace\?\.\(/;
/** `${gap.to} is missing` : le verbe finit par un s sans etre un nom. */
const VERBES = new Set([
  'is', 'was', 'has', 'does', 'goes', 'as', 'its', 'this', 'us', 'plus', 'less',
  'across', 'says', 'needs', 'keeps', 'holds',
]);

/** Les fautes du texte donne, et les extraits de tolerance qui ont servi. */
export function fautesDans(rel: string, texte: string): { fautes: string[]; utilises: string[] } {
  const fautes: string[] = [];
  const utilises: string[] = [];
  const lignes = texte.split('\n');
  // Une ligne qui accorde deja en place, `${n > 1 ? 's' : ''}`, n est pas en
  // faute : c est la forme longue de ce que `plural` fait. L accord peut etre
  // sur l une des deux lignes du dessus, un ternaire s ecrivant couramment sur
  // trois lignes, et c est la condition qui le porte.
  const accord = /[><=!]==?\s*1\s*\?|>\s*1\s*\?|[><=!]==?\s*1$|>\s*1$/;
  lignes.forEach((l, i) => {
    if (LOG.test(l)) return;
    if (accord.test(l) || accord.test(lignes[i - 1] ?? '') || accord.test(lignes[i - 2] ?? '')) return;
    const nu = l.trim();
    if (nu.startsWith('//') || nu.startsWith('*')) return;
    const m = COMPTE.exec(l);
    const mot = m?.[1] ?? m?.[2];
    if (!mot || VERBES.has(mot)) return;
    const extrait = (TOLERES[rel] ?? []).find(e => l.includes(e));
    if (extrait) { utilises.push(extrait); return; }
    fautes.push(`${rel}:${i + 1}: ${nu.slice(0, 90)}`);
  });
  return { fautes, utilises };
}

describe('le gardien des comptes', () => {
  it('voit un nom en deux mots', () => {
    // Le defaut qui a survecu a la passe precedente, faute d etre regarde.
    expect(fautesDans('src/x.ts', 'const t = `downloading ${xs.length} library sources`;').fautes)
      .toHaveLength(1);
  });

  it('voit un nom colle au compte', () => {
    expect(fautesDans('src/x.ts', 'const t = `${xs.length} files`;').fautes).toHaveLength(1);
  });

  it('un fichier tolere ne l est que sur la ligne nommee', () => {
    // Tolerer le fichier entier exemptait deux mille lignes.
    expect(fautesDans('src/extension.ts', 'const t = `${xs.length} widgets`;').fautes)
      .toHaveLength(1);
  });

  it('temoin : la ligne nommee, elle, reste toleree', () => {
    const r = fautesDans('src/extension.ts', 'const t = `${symbols.toLocaleString()} symbols in ${files} files`;');
    expect(r.fautes).toEqual([]);
    expect(r.utilises).toEqual(['symbols in ${files} files']);
  });

  it('temoin : un accord ecrit a la main n est pas une faute', () => {
    expect(fautesDans('src/x.ts', 'const t = `${xs.length} file${xs.length > 1 ? "s" : ""}`;').fautes)
      .toEqual([]);
  });

  it('temoin : un verbe en s n est pas un nom', () => {
    expect(fautesDans('src/x.ts', 'const t = `${gap.to} is missing`;').fautes).toEqual([]);
  });

  it('temoin : la journalisation reste hors jeu', () => {
    expect(fautesDans('src/x.ts', 'this.log.info(`${xs.length} files`);').fautes).toEqual([]);
  });
});

describe('les messages qui comptent', () => {
  it('aucune chaine visible ne colle un pluriel a un compte', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const depot = path.resolve(__dirname, '..', '..');
    const fautes: string[] = [];
    const servis = new Set<string>();
    const walk = (dir: string): void => {
      for (const nom of fs.readdirSync(dir)) {
        const complet = path.join(dir, nom);
        if (fs.statSync(complet).isDirectory()) { walk(complet); continue; }
        if (!nom.endsWith('.ts')) continue;
        const rel = path.relative(depot, complet).split(path.sep).join('/');
        const r = fautesDans(rel, fs.readFileSync(complet, 'utf8'));
        fautes.push(...r.fautes);
        r.utilises.forEach(e => servis.add(`${rel}|${e}`));
      }
    };
    walk(path.join(depot, 'src'));
    expect(fautes, 'utiliser plural() de src/util/plural.ts').toEqual([]);

    // Une tolerance qui ne sert plus cache le fichier pour rien, et surtout
    // elle ne dit pas qu elle est devenue inutile.
    const perimes = Object.entries(TOLERES)
      .flatMap(([f, extraits]) => extraits.filter(e => !servis.has(`${f}|${e}`)).map(e => `${f}: ${e}`));
    expect(perimes, 'entree de tolerance devenue inutile, la retirer').toEqual([]);
  });
});
