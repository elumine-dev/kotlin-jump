/**
 * « 1 declarations across 1 file(s) reference only each other ».
 *
 * Le message du diagnostic d ilot mort et le titre du correctif rapide sont
 * ecrits au pluriel en dur, avec un `(s)` pour les fichiers. Sur un ilot d une
 * seule declaration la phrase n est pas seulement mal ecrite, elle est fausse :
 * une declaration seule ne peut pas « ne referencer que les autres ».
 *
 * La ligne juste en dessous, dans la meme fonction, accorde pourtant
 * correctement (`reference${n > 1 ? 's' : ''}`), et la commande qui compte les
 * ilots aussi. Ces deux la ont ete oubliees.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 21 ilots, dont 2 avec une
 * seule declaration et 13 dans un seul fichier.
 */
import { describe, it, expect } from 'vitest';
import { messageFor, deleteTitleFor } from '../../src/providers/deadIslands';

const ile = (noms: string[], fichiers: string[]) => ({
  verdict: 'unreferenced' as const,
  testMentions: 0,
  members: noms.map((name, i) => ({
    name,
    path: fichiers[Math.min(i, fichiers.length - 1)],
    line: i, character: 0, removeStart: 0, removeEnd: 1,
    container: null, keptAliveBy: [] as string[], kind: 'class',
  })),
} as any);

describe('le message d un ilot mort s accorde', () => {
  it('une seule declaration ne referencE pas « each other »', () => {
    const m = messageFor(ile(['Seule'], ['/w/A.kt']));
    expect(m).not.toContain('1 declarations');
    expect(m).not.toContain('each other');
    expect(m).toContain('1 declaration');
  });

  it('un seul fichier ne s ecrit pas `file(s)` ni `1 files`', () => {
    // `toContain('1 file')` seul ne prouve rien : `across 1 files` le contient
    // aussi. Il faut la phrase exacte et le refus du pluriel a un.
    const m = messageFor(ile(['A', 'B'], ['/w/A.kt']));
    expect(m).not.toContain('file(s)');
    expect(m).not.toContain('1 files');
    expect(m).toContain('in 1 file ');
  });

  it('plusieurs fichiers gardent le pluriel', () => {
    const m = messageFor(ile(['A', 'B'], ['/w/A.kt', '/w/B.kt']));
    expect(m).toContain('2 declarations');
    expect(m).toContain('2 files');
    expect(m).not.toContain('file(s)');
    expect(m).toContain('each other');
  });

  it('le titre du correctif s accorde aussi', () => {
    expect(deleteTitleFor(ile(['Seule'], ['/w/A.kt']))).toBe('Delete dead island (1 declaration)');
    expect(deleteTitleFor(ile(['A', 'B'], ['/w/A.kt']))).toBe('Delete dead island (2 declarations)');
  });

  it('temoin : la mention des tests gardait deja son accord', () => {
    const une = { ...ile(['A', 'B'], ['/w/A.kt']), verdict: 'testOnly', testMentions: 1 };
    const deux = { ...ile(['A', 'B'], ['/w/A.kt']), verdict: 'testOnly', testMentions: 2 };
    expect(messageFor(une as any)).toContain('1 reference)');
    expect(messageFor(deux as any)).toContain('2 references)');
  });
});
