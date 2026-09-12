/**
 * Le balayage d etat de ligne du scan d usages, reecrit sans changer un iota.
 *
 * La v1.42.33 avait remplace deux `includes` bon marche par `advanceLineState`,
 * qui lit CHAQUE caractere de CHAQUE ligne de CHAQUE fichier du scan. La raison
 * etait juste : un `// TODO passer en """` ouvrait une chaine brute imaginaire
 * et tout le reste du fichier cessait d etre lu. Le prix ne l etait pas.
 *
 * Mesure A/B entrelacee entre la v1.42.32 et la v1.42.33, sur la MEME fixture
 * de 93 fichiers : `references.class` passe de 0,035 a 0,095 ms, `scan.object`
 * de 0,023 a 0,057. Trois `startsWith` par position au lieu d une lecture de
 * code de caractere.
 *
 * Ce test garde la reecriture honnete : l ancienne implantation sert d oracle
 * sur 60 000 lignes tordues tirees d une graine fixe, dans les trois etats de
 * depart possibles.
 */
import { describe, it, expect } from 'vitest';
import { advanceLineState } from '../../src/providers/FindUsagesEngine';

const BS = String.fromCharCode(92);

/** La version v1.42.33, litterale, comme oracle. */
function ancienne(
  text: string,
  from = 0,
  start: { raw: boolean; block: boolean } = { raw: false, block: false },
): { raw: boolean; block: boolean } {
  let raw = start.raw;
  let block = start.block;
  let i = from;
  while (i < text.length) {
    if (raw) {
      if (text.startsWith('"""', i)) { raw = false; i += 3; } else i++;
      continue;
    }
    if (block) {
      const close = text.indexOf('*/', i);
      if (close === -1) return { raw, block: true };
      block = false;
      i = close + 2;
      continue;
    }
    if (text.startsWith('"""', i)) { raw = true; i += 3; continue; }
    if (text.startsWith('//', i)) return { raw, block };
    if (text.startsWith('/*', i)) { block = true; i += 2; continue; }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      i++;
      while (i < text.length) {
        if (text[i] === BS) { i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return { raw, block };
}

const DEPARTS = [
  { raw: false, block: false },
  { raw: true, block: false },
  { raw: false, block: true },
];

describe('advanceLineState', () => {
  it('rend exactement ce que rendait la version d avant, sur 60 000 lignes tordues', () => {
    let etat = 20260912;
    const suivant = () => (etat = (etat * 1103515245 + 12345) >>> 0) / 4294967296;
    const alphabet = ['"', "'", BS, '/', '*', '"""', '//', '/*', '*/', 'a', ' ', '$', '{', '}'];
    let cas = 0;
    for (let n = 0; n < 60000; n++) {
      let ligne = '';
      const t = 1 + Math.floor(suivant() * 14);
      for (let k = 0; k < t; k++) ligne += alphabet[Math.floor(suivant() * alphabet.length)];
      for (const depart of DEPARTS) {
        // L offset de depart varie aussi : le seul appel de production passe
        // `codeStart`, qui n est pas zero des qu une chaine brute ou un bloc
        // de commentaire se ferme en milieu de ligne. Le differentiel ne
        // couvrait que zero et prouvait donc moins qu il ne le disait.
        const debut = Math.floor(suivant() * (ligne.length + 2));
        cas++;
        expect(advanceLineState(ligne, debut, depart), JSON.stringify([ligne, debut, depart]))
          .toEqual(ancienne(ligne, debut, depart));
      }
    }
    expect(cas, 'sans cas compare, la comparaison ne prouve rien').toBe(180000);
  });

  it('temoin : le defaut que la v1.42.33 corrigeait reste corrige', () => {
    // Un triple guillemet CITE dans un commentaire n ouvre pas de chaine brute.
    expect(advanceLineState('val x = 1 // TODO passer en """')).toEqual({ raw: false, block: false });
    // Une vraie ouverture, elle, porte.
    expect(advanceLineState('val sql = """SELECT')).toEqual({ raw: true, block: false });
    // Un bloc laisse ouvert en fin de ligne porte aussi.
    expect(advanceLineState('val x = 1 /' + '* note')).toEqual({ raw: false, block: true });
    // Et un `http://` n est pas un commentaire, la chaine le protege.
    expect(advanceLineState('val u = "http://x" + y')).toEqual({ raw: false, block: false });
  });

  it('temoin : les etats de depart sont bien propages', () => {
    expect(advanceLineState('du texte', 0, { raw: true, block: false })).toEqual({ raw: true, block: false });
    expect(advanceLineState('la suite """ apres', 0, { raw: true, block: false })).toEqual({ raw: false, block: false });
    expect(advanceLineState('encore', 0, { raw: false, block: true })).toEqual({ raw: false, block: true });
    expect(advanceLineState('fin *' + '/ code', 0, { raw: false, block: true })).toEqual({ raw: false, block: false });
  });
});
