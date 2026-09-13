import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Deux facons pour une etendue de s'arreter au milieu de sa declaration.
 *
 * 1. La liste des supertypes etait filtree par une liste BLANCHE de
 *    caracteres, qui n'admettait ni `+`, ni `@`, ni `!`, ni `=`. Du Kotlin
 *    ordinaire passait donc a travers :
 *      ) : CoroutineScope by CoroutineScope(SupervisorJob() + dispatcher) {
 *      ) : Base(count = 3) {
 *    l'etendue se repliait sur la ligne d'en-tete, et « Delete class X »
 *    coupait l'en-tete seule en laissant le corps et une accolade orpheline.
 *    C'est une regression de l'ancre `ligneCtor` posee en 1.42.232 : avant
 *    elle, la ligne finissait sur `(`, la garde de continuation se declenchait
 *    et la marche d'expression rattrapait le coup.
 *
 * 2. Un corps d'expression peut CONTINUER apres son accolade fermante :
 *    `= if (c) { … } else { … }` referme sur `} else {`, et
 *    `= scope.launch { … }.also { … }` sur `}.also {`. Annoncer une fin
 *    certaine la eteignait le rattrapage, et la coupe s'arretait sur
 *    `} else {` en laissant la branche else et un `}` de trop.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const MAIN = '/w/app/src/main/kotlin/com/x';

const coupe = (texte: string, nom: string): string | undefined => {
  const f = (mod.findUnusedSymbols({ sources: [{ path: `${MAIN}/M.kt`, text: texte }], testSourceSets: [] }) as any[])
    .find(x => x.name === nom);
  if (!f) return undefined;
  return f.removeStart >= 0 ? texte.slice(f.removeStart, f.removeEnd) : undefined;
};
const reste = (texte: string, nom: string): string | undefined => {
  const c = coupe(texte, nom);
  return c === undefined ? undefined : texte.replace(c, '');
};

describe.skipIf(!mod)('l accolade du corps et la fin d un corps d expression', () => {
  const entete = (delegue: string) => [
    'package com.x',
    '',
    `class Mort @Inject constructor(`,
    '    d: Dispatcher,',
    `) : ${delegue} {`,
    '    val a = 1',
    '    fun send() { println(a) }',
    '}',
    '',
    'class Vivant',
    '',
  ].join('\n');

  for (const [nom, delegue] of [
    ['un plus dans la delegation', 'Scope by Scope(Job() + d)'],
    ['un argument nomme', 'Base(count = 3)'],
    ['un supertype annote', '@Suppress("x") Base()'],
    ['une double negation', 'Base(d!!)'],
    ['un lambda en argument', 'Base(onClick = { })'],
  ] as const) {
    it(`en-tete avec ${nom} : la classe entiere part`, () => {
      const t = entete(delegue);
      const c = coupe(t, 'Mort');
      expect(c).toBeDefined();
      expect(c).toContain('fun send()');
      expect(reste(t, 'Mort')).toBe('package com.x\n\n\nclass Vivant\n');
    });
  }

  it('corps d expression if else a accolades : la coupe va jusqu au bout', () => {
    const t = 'package com.x\n\nfun mort(f: Boolean): String = if (f) {\n    "on"\n} else {\n    "off"\n}\n\nclass Vivant\n';
    expect(coupe(t, 'mort')).toBe('fun mort(f: Boolean): String = if (f) {\n    "on"\n} else {\n    "off"\n}\n');
  });

  it('lambda suivi d un .also : idem', () => {
    const t = 'package com.x\n\nfun mort(s: Scope) = s.launch {\n    go()\n}.also {\n    log(it)\n}\n\nclass Vivant\n';
    expect(coupe(t, 'mort')).toBe('fun mort(s: Scope) = s.launch {\n    go()\n}.also {\n    log(it)\n}\n');
  });

  it('temoin : un corps qui finit vraiment sur son accolade ne deborde pas', () => {
    const t = 'package com.x\n\nfun mort() {\n    val a = 1\n}\n\nclass Vivant\n';
    expect(coupe(t, 'mort')).toBe('fun mort() {\n    val a = 1\n}\n');
  });

  it('temoin : une classe ordinaire ne deborde pas non plus', () => {
    const t = 'package com.x\n\nclass Mort {\n    val a = 1\n}\n\nclass Vivant\n';
    expect(coupe(t, 'Mort')).toBe('class Mort {\n    val a = 1\n}\n');
  });
});
