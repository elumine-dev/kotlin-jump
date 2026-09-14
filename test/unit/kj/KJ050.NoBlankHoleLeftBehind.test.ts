import { describe, it, expect } from 'vitest';
import { sansTrouDeLignesVides, plagesDuFichier, Coupe } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Une suppression ne laisse pas un trou de lignes vides derriere elle.
 *
 * Une declaration est presque toujours entouree d une ligne vide de chaque
 * cote. La retirer laisse les deux, collees, la ou il n y en avait qu une
 * entre deux voisines. Mesure sur le projet de reference : 66 des 199 fichiers
 * coupes gagnent un tel trou, soit un tiers du diff a relire.
 *
 * La regle ne retire JAMAIS une ligne vide isolee : il faut une ligne vide de
 * chaque cote de la coupe, et il n en part qu une. Une coupe qui ne porte pas
 * des lignes entieres n est pas concernee, pas plus qu un remplacement.
 */

const c = (start: number, end: number, texte = ''): Coupe =>
  ({ start, end, texte, famille: 'symboles', quoi: 'x' });

const applique = (texte: string, coupes: Coupe[]): string => {
  let out = texte;
  for (const x of [...sansTrouDeLignesVides(texte, coupes)].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, x.start) + x.texte + out.slice(x.end);
  }
  return out;
};

describe('KJ-050 pas de trou de lignes vides', () => {
  it('une declaration entouree de vide en laisse une seule', () => {
    const t = 'package p\n\nclass Morte {\n    fun f() = 1\n}\n\nconst val GARDE = 1\n';
    const debut = t.indexOf('class Morte');
    const fin = t.indexOf('}\n', debut) + 2;
    expect(applique(t, [c(debut, fin)])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('deux coupes dans le meme fichier, chacune son trou', () => {
    const t = 'package p\n\nclass A {\n    fun f() = 1\n}\n\nclass B {\n    fun g() = 2\n}\n\nconst val GARDE = 1\n';
    const a1 = t.indexOf('class A'); const a2 = t.indexOf('}\n', a1) + 2;
    const b1 = t.indexOf('class B'); const b2 = t.indexOf('}\n', b1) + 2;
    expect(applique(t, [c(a1, a2), c(b1, b2)])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('temoin : sans ligne vide avant, rien n est absorbe', () => {
    const t = 'package p\nclass Morte {\n    fun f() = 1\n}\n\nconst val GARDE = 1\n';
    const debut = t.indexOf('class Morte');
    const fin = t.indexOf('}\n', debut) + 2;
    expect(applique(t, [c(debut, fin)])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('temoin : sans ligne vide apres, rien n est absorbe', () => {
    const t = 'package p\n\nclass Morte {\n    fun f() = 1\n}\nconst val GARDE = 1\n';
    const debut = t.indexOf('class Morte');
    const fin = t.indexOf('}\n', debut) + 2;
    expect(applique(t, [c(debut, fin)])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('temoin : un remplacement n est pas concerne', () => {
    const t = 'package p\n\nval x = { index -> 1 }\n\nconst val GARDE = 1\n';
    const debut = t.indexOf('index');
    const coupes = [c(debut, debut + 'index'.length, '_')];
    expect(applique(t, coupes)).toBe('package p\n\nval x = { _ -> 1 }\n\nconst val GARDE = 1\n');
  });

  it('temoin : une coupe en milieu de ligne n est pas concernee', () => {
    const t = 'package p\n\nval a = 1; val mort = 2\n\nconst val GARDE = 1\n';
    const debut = t.indexOf('val mort');
    const coupes = [c(debut, debut + 'val mort = 2'.length)];
    expect(applique(t, coupes)).toBe('package p\n\nval a = 1; \n\nconst val GARDE = 1\n');
  });

  it('temoin : deux coupes collees ne se marchent pas dessus', () => {
    const t = 'package p\n\nclass A {\n    fun f() = 1\n}\nclass B {\n    fun g() = 2\n}\n\nconst val GARDE = 1\n';
    const a1 = t.indexOf('class A'); const a2 = t.indexOf('}\n', a1) + 2;
    const b1 = t.indexOf('class B'); const b2 = t.indexOf('}\n', b1) + 2;
    const plages = sansTrouDeLignesVides(t, [c(a1, a2), c(b1, b2)]);
    const triees = [...plages].sort((x, y) => x.start - y.start);
    for (let i = 1; i < triees.length; i++) expect(triees[i].start).toBeGreaterThanOrEqual(triees[i - 1].end);
  });

  it('la commande passe bien par cette regle', () => {
    // `plagesDuFichier` est le seul endroit ou la passe fusionnee fabrique ses
    // plages. Sans l appel, la mesure sur le projet de reference remonterait a
    // soixante-six trous.
    const t = 'package p\n\nclass Morte {\n    fun f() = 1\n}\n\nconst val GARDE = 1\n';
    const debut = t.indexOf('class Morte');
    const fin = t.indexOf('}\n', debut) + 2;
    const plages = plagesDuFichier('/w/A.kt', t, [c(debut, fin)])!;
    expect(plages).toHaveLength(1);
    // La coupe va jusqu au debut de la ligne du `const`, pas de la ligne vide.
    expect(plages[0].end.line).toBe(t.slice(0, t.indexOf('const val')).split('\n').length - 1);
  });
});

describe('KJ-050 un trou fait de plusieurs coupes collees', () => {
  // Chaque coupe etait jugee seule : deux declarations mortes ecrites l une
  // sous l autre, encadrees de lignes vides, n avaient ni l une ni l autre une
  // ligne vide de chaque cote, et le fichier gardait deux lignes vides de suite
  // (detekt : NoConsecutiveBlankLines). Meme chose quand la cascade retire une
  // partie d un bloc d imports et le balayage l autre.
  const appliqueAvec = (texte: string, coupes: Coupe[], autres: { start: number; end: number }[]) => {
    const toutes = [...sansTrouDeLignesVides(texte, coupes, autres), ...autres.map(a => ({ ...a, texte: '' }))]
      .sort((a, b) => b.start - a.start);
    let out = texte;
    let borne = Infinity;
    for (const x of toutes) {
      expect(x.end <= borne, 'deux editions se chevauchent').toBe(true);
      out = out.slice(0, x.start) + x.texte + out.slice(x.end);
      borne = x.start;
    }
    return out;
  };
  const ligne = (t: string, debut: string) => { const s = t.indexOf(debut); return { start: s, end: t.indexOf('\n', s) + 1 }; };

  it('deux declarations collees : une seule ligne vide reste', () => {
    const t = 'package p\n\nprivate fun mortA() = 1\nprivate fun mortB() = 2\n\nconst val GARDE = 1\n';
    const a = ligne(t, 'private fun mortA'); const b = ligne(t, 'private fun mortB');
    expect(appliqueAvec(t, [c(a.start, a.end), c(b.start, b.end)], [])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('une coupe precedee d une ligne que la cascade retire : le trou est vu en entier', () => {
    const t = 'package p\n\nimport a.Orpheline\nimport a.DejaMorte\n\nconst val GARDE = 1\n';
    const cascade = ligne(t, 'import a.Orpheline'); const balayage = ligne(t, 'import a.DejaMorte');
    expect(appliqueAvec(t, [c(balayage.start, balayage.end)], [cascade])).toBe('package p\n\nconst val GARDE = 1\n');
  });

  it('temoin : une coupe suivie d une ligne que la cascade retire ne prend pas la ligne vide', () => {
    const t = 'package p\n\nimport a.DejaMorte\nimport a.Orpheline\n\nconst val GARDE = 1\n';
    const balayage = ligne(t, 'import a.DejaMorte'); const cascade = ligne(t, 'import a.Orpheline');
    const r = sansTrouDeLignesVides(t, [c(balayage.start, balayage.end)], [cascade]);
    expect(r[0].end).toBe(balayage.end);
  });
});

describe('KJ-050 la commande donne a la regle les lignes de la cascade', () => {
  it('plagesDuFichier recoit les imports que la cascade retire', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../../src/commands/RemoveEverythingUnused.ts'), 'utf8');
    expect(src).toMatch(/plagesDuFichier\(p, textes\.get\(p\)!, l, cascade\.imports\.get\(p\)\)/);
  });
});
