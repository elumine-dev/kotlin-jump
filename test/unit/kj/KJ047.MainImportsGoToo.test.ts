import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { scanTestOnly } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Retirer du code garde en vie par ses seuls tests emporte aussi les imports
 * qui le nomment dans le code PRINCIPAL.
 *
 * Meme trou que « Remove Everything Unused » avant 1.42.335 : la declaration
 * part, ses tests aussi, mais un fichier principal qui l importait sans s en
 * servir garde son import, et le module ne compile plus (Kotlin comme Java).
 * Le plan des tests ne lit que les sources de test.
 */

const K = 'app/src/main/java';
const T = 'app/src/test/java';
const f = (path: string, text: string) => ({ path, text });
const corpus = (s: Array<{ path: string; text: string }>): any => ({
  get: async () => ({ sources: s, moduleDirs: [], modulesWithCode: [], libraryModules: [], truncated: false, sourcesTruncated: false }),
});

describe('KJ-047 les imports principaux partent avec la declaration', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [langue, importeur] of [
    ['Kotlin', f(`${K}/com/x/ui/Ecran.kt`, 'package com.x.ui\n\nimport com.x.outil.Horloge\nimport java.util.UUID\n\nclass Ecran {\n    fun id() = UUID.randomUUID()\n}\n')],
    ['Java', f(`${K}/com/x/ui/Ecran.java`, 'package com.x.ui;\n\nimport com.x.outil.Horloge;\nimport java.util.UUID;\n\npublic class Ecran {\n    public UUID id() { return UUID.randomUUID(); }\n}\n')],
  ] as Array<[string, { path: string; text: string }]>) {
    it(`${langue} : l import de la classe retiree est dans le plan`, async () => {
      vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
      const sources = [
        f(`${K}/com/x/outil/Horloge.kt`, 'package com.x.outil\n\nclass Horloge {\n    fun maintenant() = 42\n}\n'),
        f(`${T}/com/x/outil/HorlogeTest.kt`, 'package com.x.outil\n\nclass HorlogeTest {\n    @Test\n    fun maintenant() { check(Horloge().maintenant() == 42) }\n}\n'),
        importeur,
        f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.x.ui.Ecran\n\nfun main() { println(Ecran().id()) }\n'),
      ];
      const scan = await scanTestOnly(corpus(sources));
      const groupe = scan!.groups.find(g => g.group.label === 'Horloge');
      expect(groupe, 'Horloge est proposee').toBeDefined();
      const imports = groupe!.plan.cuts.filter(c => c.kind === 'import').map(c => importeur.text.slice(c.start, c.end));
      expect(groupe!.plan.cuts.some(c => c.path === importeur.path && c.kind === 'import')).toBe(true);
      expect(imports.join('')).toContain('com.x.outil.Horloge');
    });
  }

  const config = () => vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  const main = f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.x.ui.Ecran\n\nfun main() { println(Ecran().id()) }\n');
  const ecran = f(`${K}/com/x/ui/Ecran.kt`, 'package com.x.ui\n\nimport com.x.outil.Horloge\nimport java.util.UUID\n\nclass Ecran {\n    fun id() = UUID.randomUUID()\n}\n');

  it('un import vu aussi par le plan des tests n est coupe qu une fois', async () => {
    config();
    const sources = [
      f(`${K}/com/x/outil/Horloge.kt`, 'package com.x.outil\n\nclass Horloge {\n    fun maintenant() = 42\n}\n'),
      f(`${T}/com/y/HorlogeTest.kt`, 'package com.y\n\nimport com.x.outil.Horloge\n\nclass HorlogeTest {\n    @Test\n    fun maintenant() { check(Horloge().maintenant() == 42) }\n\n    @Test\n    fun autre() { check(1 + 1 == 2) }\n}\n'),
      ecran, main,
    ];
    const scan = await scanTestOnly(corpus(sources));
    const cuts = scan!.groups.find(g => g.group.label === 'Horloge')!.plan.cuts;
    expect(cuts.filter(c => c.path.endsWith('HorlogeTest.kt') && c.kind === 'import').length, 'le fichier de test survit, son import est une coupe').toBe(1);
    const cles = cuts.map(c => `${c.path}:${c.start}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('un plan sans test a couper reste retenu, meme avec un import principal', async () => {
    // Nommee seulement dans une ressource XML de test : testOnly, mais aucune
    // fonction de test a couper. L import principal ne doit pas suffire a
    // proposer la suppression.
    config();
    const sources = [
      f(`${K}/com/x/outil/Horloge.kt`, 'package com.x.outil\n\nclass Horloge {\n    fun maintenant() = 42\n}\n'),
      f('app/src/test/resources/beans.xml', '<beans><bean class="com.x.outil.Horloge"/></beans>\n'),
      ecran, main,
    ];
    const scan = await scanTestOnly(corpus(sources));
    expect(scan!.groups.map(g => g.group.label)).not.toContain('Horloge');
  });

  it('un ilot garde en vie par ses tests emporte aussi les imports principaux de ses noms', async () => {
    config();
    const sources = [
      f(`${K}/com/x/outil/Pong.kt`, 'package com.x.outil\n\nclass Pong {\n    fun rebond() = creePong()\n}\n\nfun creePong() = Pong()\n'),
      f(`${T}/com/x/outil/PongTest.kt`, 'package com.x.outil\n\nclass PongTest {\n    @Test\n    fun rebondit() { check(creePong().rebond() != null) }\n}\n'),
      f(`${K}/com/x/ui/Ecran.kt`, 'package com.x.ui\n\nimport com.x.outil.Pong\nimport java.util.UUID\n\nclass Ecran {\n    fun id() = UUID.randomUUID()\n}\n'),
      main,
    ];
    const scan = await scanTestOnly(corpus(sources));
    const groupe = scan!.groups.find(g => g.group.label.includes('Pong'));
    expect(groupe, 'l ilot est propose').toBeDefined();
    expect(groupe!.plan.cuts.some(c => c.path === `${K}/com/x/ui/Ecran.kt` && c.kind === 'import')).toBe(true);
  });

  it('membre et entree d enum : l import statique Java du code principal est dans le plan', async () => {
    config();
    const sources = [
      f(`${K}/com/x/outil/Cles.java`, 'package com.x.outil;\n\npublic class Cles {\n    public static final String MORTE = "m";\n    public static final String VIVANTE = "v";\n}\n'),
      f(`${K}/com/x/outil/Mode.java`, 'package com.x.outil;\n\npublic enum Mode {\n    VIVANT,\n    MORT,\n}\n'),
      f(`${T}/com/x/outil/ClesTest.kt`, 'package com.x.outil\n\nclass ClesTest {\n    @Test\n    fun morte() { check(Cles.MORTE == "m") }\n\n    @Test\n    fun mort() { check(Mode.MORT != null) }\n}\n'),
      f(`${K}/com/x/ui/Ecran.java`, 'package com.x.ui;\n\nimport static com.x.outil.Cles.MORTE;\nimport static com.x.outil.Mode.MORT;\nimport com.x.outil.Cles;\nimport com.x.outil.Mode;\n\npublic class Ecran {\n    public String v() { return Cles.VIVANTE + Mode.VIVANT; }\n}\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.x.ui.Ecran\n\nfun main() { println(Ecran().v()) }\n'),
    ];
    const scan = await scanTestOnly(corpus(sources));
    const ecran = sources[3];
    for (const label of ['Cles.MORTE', 'Mode.MORT']) {
      const groupe = scan!.groups.find(g => g.group.label === label);
      expect(groupe, `${label} est propose`).toBeDefined();
      const imports = groupe!.plan.cuts.filter(c => c.path === ecran.path && c.kind === 'import').map(c => ecran.text.slice(c.start, c.end));
      expect(imports.join(''), label).toContain(label);
    }
  });

  it('constante de compagnon : l import Kotlin du code principal par Companion est dans le plan', async () => {
    // Cette commande n a pas de balayage Kotlin pour rattraper l import.
    config();
    const sources = [
      f(`${K}/com/x/outil/Cles.kt`, 'package com.x.outil\n\nclass Cles {\n    companion object {\n        const val MORTE = "m"\n        const val VIVANTE = "v"\n    }\n}\n'),
      f(`${T}/com/x/outil/ClesTest.kt`, 'package com.x.outil\n\nclass ClesTest {\n    @Test\n    fun morte() { check(Cles.MORTE == "m") }\n}\n'),
      f(`${K}/com/x/ui/Ecran.kt`, 'package com.x.ui\n\nimport com.x.outil.Cles\nimport com.x.outil.Cles.Companion.MORTE\n\nclass Ecran {\n    fun v() = Cles.VIVANTE\n}\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.x.ui.Ecran\n\nfun main() { println(Ecran().v()) }\n'),
    ];
    const scan = await scanTestOnly(corpus(sources));
    const groupe = scan!.groups.find(g => g.group.label.endsWith('MORTE'));
    expect(groupe, 'MORTE est proposee').toBeDefined();
    const ecran = sources[2];
    const imports = groupe!.plan.cuts.filter(c => c.path === ecran.path && c.kind === 'import').map(c => ecran.text.slice(c.start, c.end));
    expect(imports.join('')).toContain('Cles.Companion.MORTE');
  });
});
