import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G15 — une entree d enum cachee par l homonyme d une bibliotheque.
 *
 * Voir doc/gaps-detection.md. Trouve en auditant les quatre entrees d enum
 * que le detecteur rapporte sur le corpus de reference : il en manque une
 * cinquieme, et la raison est precise.
 *
 * ## Le cas reel
 *
 *
 *     enum class UriScheme(val value: String) {
 *         HTTP("http"),
 *         HTTPS("https"),
 *         APPSCHEME("example"),
 *         FILE("file")
 *     }
 *
 * Mentions qualifiees dans tout le corpus : `APPSCHEME` une fois
 * (`UrlControllerImplementation`), `FILE` une fois, `HTTP` zero,
 * `HTTPS` zero. Deux entrees sont donc mortes. Le detecteur n en rapporte
 * qu une, `HTTPS`.
 *
 * `HTTP` lui echappe a cause de deux lignes :
 *
 *         Proxy(Proxy.Type.HTTP, InetSocketAddress(proxyServer, PROXY_PORT))
 *
 * `Proxy.Type` est l enum de `java.net`, pas celui du projet. Sa constante
 * `HTTP` porte le meme nom, la mention est comptee pour `UriScheme.HTTP`, et
 * l entree passe pour vivante.
 *
 * ## Ce qui rend le cas net
 *
 * La resolution par enum existe depuis la v1.42.328 et elle FONCTIONNE, tant
 * que l homonyme est declare dans le corpus. Mesure sur trois corpus qui ne
 * different que par l origine de l homonyme :
 *
 *   sans collision                        -> HTTP, HTTPS
 *   + Proxy.Type.HTTP, enum de librairie  -> HTTPS seulement
 *   + OtherScheme.HTTP, enum du corpus    -> HTTP, HTTPS, WS
 *
 * La troisieme ligne est le temoin : quand les deux enums sont lisibles, les
 * deux `HTTP` sont correctement distingues. Le trou est donc etroit et bien
 * delimite : il ne concerne que les homonymes venus d une bibliotheque.
 *
 * ## Ce que les tests demandent
 *
 * Une mention QUALIFIEE dont le qualificateur n est pas l enum candidat ne
 * doit pas compter pour lui, que ce qualificateur soit lisible ou non.
 * `Proxy.Type.HTTP` nomme explicitement son enum ; il n y a rien a deviner.
 */

const mod: any = await importOrNull('src/providers/unusedEnumEntries');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const entrees = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedEnumEntries({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .map(x => x.name).sort();

// ── Fixtures, reduites de UriScheme ─────────────────────────────────────

const ENUM = f(`${MAIN}/UriScheme.kt`, [
  'package com.x',
  '',
  'enum class UriScheme(val value: String) {',
  '    HTTP("http"),',
  '    HTTPS("https"),',
  '    APPSCHEME("example")',
  '}',
  '',
].join('\n'));

/** Un lecteur qui n utilise QUE `APPSCHEME`, comme le vrai contrôleur d URL. */
const LECTEUR = f(`${MAIN}/UrlController.kt`, [
  'package com.x',
  '',
  'import com.x.UriScheme.APPSCHEME',
  '',
  'fun handle(s: UriScheme) = s == APPSCHEME',
  '',
].join('\n'));

/** `Proxy.Type` de `java.net` : hors corpus, et sa constante s appelle HTTP. */
const PROXY = f(`${MAIN}/OkHttpBuilderFactory.kt`, [
  'package com.x',
  '',
  'import java.net.Proxy',
  '',
  'fun proxy(server: String) =',
  '    Proxy(Proxy.Type.HTTP, InetSocketAddress(server, 8080))',
  '',
].join('\n'));

describe.skipIf(!mod)('G15 — le corpus de test est lisible', () => {
  it('rapporte les deux entrees mortes quand rien ne les masque', () => {
    expect(entrees(ENUM, LECTEUR)).toEqual(['HTTP', 'HTTPS']);
  });

  /**
   * LE TEMOIN QUI TRANCHE. La resolution par enum du corpus fonctionne :
   * deux enums lisibles qui portent tous deux `HTTP` sont correctement
   * separes. Le trou de G15 n est donc pas la resolution elle meme, c est son
   * angle mort sur les enums qu aucun fichier ne declare.
   */
  it('separe deux enums du corpus qui partagent un nom d entree', () => {
    const autre = f(`${MAIN}/OtherScheme.kt`, [
      'package com.x',
      '',
      'enum class OtherScheme { HTTP, WS }',
      '',
      'fun pick() = OtherScheme.HTTP',
      '',
    ].join('\n'));
    // `OtherScheme.HTTP` est utilise, `WS` ne l est pas, et le `HTTP` de
    // `UriScheme` reste mort : les trois verdicts sont justes.
    expect(entrees(ENUM, LECTEUR, autre)).toEqual(['HTTP', 'HTTPS', 'WS']);
  });

  /**
   * SENTINELLE. Elle fixe le trou mesure : une seule ligne citant
   * `Proxy.Type.HTTP` suffit a faire disparaitre `HTTP` du rapport. Si ce
   * test se met a echouer, la resolution s est etendue aux enums hors corpus
   * et l entree G15 du document doit etre relue.
   */
  it('aujourd hui, un homonyme de bibliotheque masque l entree', () => {
    expect(entrees(ENUM, LECTEUR, PROXY)).toEqual(['HTTPS']);
  });
});

describe.skipIf(!mod)('G15 — l entree que la collision fait disparaitre', () => {
  it.fails('rapporte HTTP malgre la mention de Proxy.Type.HTTP', () => {
    expect(entrees(ENUM, LECTEUR, PROXY)).toEqual(['HTTP', 'HTTPS']);
  });

  it.fails('la rapporte meme avec plusieurs fichiers citant l homonyme', () => {
    // Le corpus de reference en a deux, dans deux modules differents.
    const second = f(`${MAIN}/OtherHttpFactory.kt`, [
      'package com.x',
      '',
      'import java.net.Proxy',
      '',
      'fun other(server: String) = Proxy(Proxy.Type.HTTP, null)',
      '',
    ].join('\n'));
    expect(entrees(ENUM, LECTEUR, PROXY, second)).toContain('HTTP');
  });

  it.fails('la rapporte quand l homonyme est qualifie sur une seule classe', () => {
    // `HttpMethod.HTTP` plutot que `Proxy.Type.HTTP` : un seul niveau de
    // qualification, meme raisonnement.
    const simple = f(`${MAIN}/Client.kt`, [
      'package com.x',
      '',
      'import okhttp3.HttpMethod',
      '',
      'fun m() = HttpMethod.HTTP',
      '',
    ].join('\n'));
    expect(entrees(ENUM, LECTEUR, simple)).toContain('HTTP');
  });

  it.fails('rapporte les deux entrees mortes du vrai UriScheme', () => {
    // Le fichier complet, avec ses quatre entrees et le lecteur de APPSCHEME.
    const complet = f(`${MAIN}/UriScheme.kt`, [
      'package com.x',
      '',
      'enum class UriScheme(val value: String) {',
      '    HTTP("http"),',
      '    HTTPS("https"),',
      '    APPSCHEME("example"),',
      '    FILE("file")',
      '}',
      '',
    ].join('\n'));
    const lecteurFile = f(`${MAIN}/FileReader.kt`, [
      'package com.x',
      '',
      'fun read(s: UriScheme) = s == UriScheme.FILE',
      '',
    ].join('\n'));
    expect(entrees(complet, LECTEUR, lecteurFile, PROXY)).toEqual(['HTTP', 'HTTPS']);
  });
});

describe.skipIf(!mod)('G15 — les gardes, qui passent des maintenant', () => {
  /**
   * Ces gardes tiennent aujourd hui et doivent tenir apres : resserrer la
   * resolution ne doit pas faire disparaitre une mention legitime, ce qui
   * couperait une entree vivante.
   */

  it('ne touche pas une entree nommee sans qualification, apres import', () => {
    expect(entrees(ENUM, LECTEUR)).not.toContain('APPSCHEME');
  });

  it('ne touche pas une entree qualifiee par son propre enum', () => {
    const qualifie = f(`${MAIN}/Direct.kt`, [
      'package com.x',
      '',
      'fun pick() = UriScheme.HTTPS',
      '',
    ].join('\n'));
    expect(entrees(ENUM, LECTEUR, qualifie)).not.toContain('HTTPS');
  });

  it('ne touche pas une entree importee nommement', () => {
    const importee = f(`${MAIN}/Imported.kt`, [
      'package com.x',
      '',
      'import com.x.UriScheme.HTTPS',
      '',
      'fun pick() = HTTPS',
      '',
    ].join('\n'));
    expect(entrees(ENUM, LECTEUR, importee)).not.toContain('HTTPS');
  });

  it('ne touche pas une entree atteinte par un parcours de l enum', () => {
    // `UriScheme.entries` ou `values()` atteint TOUTES les entrees : aucune
    // ne peut etre declaree morte.
    const parcours = f(`${MAIN}/Walk.kt`, [
      'package com.x',
      '',
      'fun find(v: String) = UriScheme.entries.first { it.value == v }',
      '',
    ].join('\n'));
    expect(entrees(ENUM, LECTEUR, parcours)).toEqual([]);
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(mod.findUnusedEnumEntries({
      sources: [ENUM, LECTEUR], testSourceSets: ['/src/test/'], truncated: true,
    })).toHaveLength(0);
  });
});
