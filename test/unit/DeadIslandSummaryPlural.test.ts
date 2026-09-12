/**
 * « 1 declaration that only reference each other ».
 *
 * Le resume de la commande d ilots morts accorde bien le NOM
 * (`declaration${n === 1 ? '' : 's'}`) mais laisse la suite de la phrase au
 * pluriel : le verbe reste `reference`, et surtout « each other » n a pas de
 * sens pour une declaration seule. C est exactement le defaut corrige dans le
 * diagnostic, laisse en place dans le resume de la commande.
 *
 * Le gardien de pluriels ne pouvait pas le voir : ce qui cloche ici n est pas
 * le nom, c est l accord du verbe et la reciprocite de la phrase.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 2 ilots sur 21 tiennent une
 * seule declaration.
 */
import { describe, it, expect } from 'vitest';
import { resumeIlots } from '../../src/commands/FindDeadIslands';

describe('le resume de la commande d ilots morts', () => {
  it('une seule declaration ne « reference each other » pas', () => {
    const r = resumeIlots(1, 1, 0, 100);
    expect(r).not.toContain('each other');
    expect(r).not.toContain('1 declarations');
    // `toContain('1 dead island')` passe aussi sur `1 dead islands` : il faut
    // refuser le pluriel explicitement.
    expect(r).not.toContain('1 dead islands');
    expect(r).toContain('1 dead island ');
    expect(r).toContain('1 declaration ');
  });

  it('plusieurs declarations gardent la reciprocite', () => {
    const r = resumeIlots(1, 3, 0, 100);
    expect(r).toContain('3 declarations that only reference each other');
  });

  it('plusieurs ilots gardent leur pluriel', () => {
    expect(resumeIlots(2, 5, 0, 100)).toContain('2 dead islands');
    expect(resumeIlots(1, 5, 0, 100)).not.toContain('1 dead islands');
  });

  it('la mention des tests reste intacte', () => {
    expect(resumeIlots(2, 5, 1, 100)).toContain(', 1 referenced only from tests');
    expect(resumeIlots(2, 5, 0, 100)).not.toContain('referenced only from tests');
  });

  it('temoin : le compte de fichiers s accorde aussi', () => {
    expect(resumeIlots(1, 1, 0, 1)).toContain('across 1 file.');
    expect(resumeIlots(1, 1, 0, 2)).toContain('across 2 files.');
  });
});
