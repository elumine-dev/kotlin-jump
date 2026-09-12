import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Un nom entre accents graves n'est pas un identifiant, et la recolte de
 * mentions cherche des identifiants.
 *
 * `w.`a ghost`()` sur un site d'appel lui est invisible : l'absence de
 * reference ne peut donc jamais etre prouvee pour un tel nom. Cote KJ-032 la
 * garde tenait par accident, parce que `declarationSpan` ne savait pas non
 * plus delimiter la declaration ; apprendre les accents graves a cette
 * fonction, ce dont KJ-047 a besoin pour les fonctions de test, a transforme
 * une fonction APPELEE en trouvaille supprimable.
 *
 * Cote KJ-042 il n'y avait pas d'accident du tout : un membre appele revenait
 * deja `unreferenced`, et son correctif rapide effaçait du code vivant.
 */

const symbols: any = await importOrNull('src/providers/unusedSymbols');
const members: any = await importOrNull('src/providers/unusedMembers');

const MAIN = '/w/app/src/main/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin', 'androidTest'];
const src = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });

describe.skipIf(!symbols)('KJ-032 et les noms en accents graves', () => {
  const decl = src('B.kt', 'package com.x\n\nfun `a ghost`() {}\n');
  const appel = src('U.kt', 'package com.x\n\nfun caller() {\n    `a ghost`()\n}\n');

  it('un nom en accents graves n est jamais signale, appele ou non', () => {
    const seul = symbols.findUnusedSymbols({ sources: [decl], testSourceSets: SEGS });
    expect(seul.map((s: any) => s.name)).not.toContain('a ghost');
    const avec = symbols.findUnusedSymbols({ sources: [decl, appel], testSourceSets: SEGS });
    expect(avec.map((s: any) => s.name)).not.toContain('a ghost');
  });

  it('temoin : un nom ordinaire jamais appele est toujours signale', () => {
    const fantome = src('G.kt', 'package com.x\n\nfun aGhost() {}\n');
    const out = symbols.findUnusedSymbols({ sources: [fantome], testSourceSets: SEGS });
    expect(out.map((s: any) => s.name)).toContain('aGhost');
  });

  it('temoin : ce meme nom ordinaire, appele, n est plus signale', () => {
    const fantome = src('G.kt', 'package com.x\n\nfun aGhost() {}\n');
    const u = src('U2.kt', 'package com.x\n\nfun caller2() {\n    aGhost()\n}\n');
    const out = symbols.findUnusedSymbols({ sources: [fantome, u], testSourceSets: SEGS });
    expect(out.map((s: any) => s.name)).not.toContain('aGhost');
  });
});

describe.skipIf(!members)('KJ-042 et les noms en accents graves', () => {
  const decl = src('W.kt', 'package com.x\n\nclass Widget {\n    fun `a ghost`() {}\n}\n');
  const appel = src('U.kt', 'package com.x\n\nfun caller(w: Widget) {\n    w.`a ghost`()\n}\n');

  it('un membre en accents graves, APPELE, n est plus signale', () => {
    const out = members.findUnusedMembers({ sources: [decl, appel], testSourceSets: SEGS, deadDeclarations: [] });
    expect(out.map((m: any) => m.name)).not.toContain('a ghost');
  });

  it('il n est pas signale non plus quand il n est pas appele', () => {
    // On ne peut pas prouver l absence pour un nom que la recolte ne sait pas
    // chercher : le silence est la seule reponse honnete.
    const out = members.findUnusedMembers({ sources: [decl], testSourceSets: SEGS, deadDeclarations: [] });
    expect(out.map((m: any) => m.name)).not.toContain('a ghost');
  });

  it('temoin : un membre ordinaire jamais appele est toujours signale', () => {
    const ordinaire = src('W2.kt', 'package com.x\n\nclass Widget2 {\n    fun aGhost() {}\n}\n');
    const out = members.findUnusedMembers({ sources: [ordinaire], testSourceSets: SEGS, deadDeclarations: [] });
    expect(out.map((m: any) => m.name)).toContain('aGhost');
  });
});
