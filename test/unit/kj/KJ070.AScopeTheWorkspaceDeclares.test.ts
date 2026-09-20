import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-070 — une annotation de portee que le depot declare lui meme.
 *
 * Une portee dit a l injecteur combien d instances garder ; elle n en cree
 * jamais. Quelqu un doit toujours DEMANDER le type, et une demande ecrit son
 * nom. Le cote membres lisait deja `@Singleton` et `@Reusable` ainsi, et
 * laissait les portees maison etrangeres, faute de pouvoir en connaitre la
 * liste. On peut la connaitre quand le depot declare l annotation : sa
 * declaration porte `@Scope` de `javax.inject`, ce qui EST la definition.
 *
 * Sur le projet de reference, `@ScopeActivity` a elle seule gardait en vie un
 * controleur que plus rien ne nommait, et la revue de la PR ne l a pas vu non
 * plus. Une annotation que le depot ne declare pas reste etrangere : la liste
 * blanche est l endroit prevu pour un nom connu, et y ajouter un nom est une
 * decision qui se prend, pas qui se devine.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

const PORTEE = f(`${MAIN}/ScopeActivity.kt`, [
  'package com.x',
  '',
  'import javax.inject.Scope',
  '',
  '@MustBeDocumented',
  '@Retention(AnnotationRetention.RUNTIME)',
  '@Scope',
  'annotation class ScopeActivity',
  '',
].join('\n'));

const controleur = (annotation: string) => f(`${MAIN}/PanelController.java`, [
  'package com.x;',
  '',
  'import javax.inject.Inject;',
  '',
  annotation,
  'public class PanelController {',
  '',
  '    @Inject',
  '    public PanelController() {',
  '    }',
  '}',
  '',
].join('\n'));

const scan = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources: [...sources, GRADLE], testSourceSets: ['/src/test/'] }) as any[];

const verdict = (...sources: { path: string; text: string }[]) =>
  scan(...sources).find(s => s.name === 'PanelController')?.verdict;

const pourquoi = (...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources: [...sources, GRADLE], testSourceSets: ['/src/test/'] }) as any[])
    .find(r => r.name === 'PanelController')?.outcome;

describe.skipIf(!mod)('une portee declaree dans le depot ne garde rien en vie', () => {
  it('la classe que plus rien ne nomme est morte malgre son annotation', () => {
    expect(verdict(controleur('@ScopeActivity'), PORTEE)).toBe('unreferenced');
  });

  it('sans la declaration de la portee, l annotation reste etrangere', () => {
    // Le depot ne la declare pas : rien ne dit que c en est une.
    expect(verdict(controleur('@ScopeActivity'))).toBeUndefined();
    expect(pourquoi(controleur('@ScopeActivity'))).toBe('F5:@ScopeActivity');
  });

  it('temoin : quelqu un demande le type, il vit', () => {
    const demandeur = f(`${MAIN}/Ecran.java`,
      'package com.x;\n\nimport javax.inject.Inject;\n\npublic class Ecran {\n'
      + '    @Inject PanelController controleur;\n}\n');
    expect(verdict(controleur('@ScopeActivity'), PORTEE, demandeur)).toBeUndefined();
  });

  it('temoin : une annotation maison SANS @Scope garde la classe en vie', () => {
    const maison = f(`${MAIN}/Marqueur.kt`, 'package com.x\n\nannotation class Marqueur\n');
    expect(verdict(controleur('@Marqueur'), maison)).toBeUndefined();
    expect(pourquoi(controleur('@Marqueur'), maison)).toBe('F5:@Marqueur');
  });

  it('temoin : @Scope venu d ailleurs que de javax ou jakarta ne compte pas', () => {
    const faux = f(`${MAIN}/FausseScope.kt`, [
      'package com.x',
      '',
      'import com.autre.Scope',
      '',
      '@Scope',
      'annotation class ScopeActivity',
      '',
    ].join('\n'));
    expect(pourquoi(controleur('@ScopeActivity'), faux)).toBe('F5:@ScopeActivity');
  });

  it('temoin : javax.inject.Singleton reste etrangere, elle n est pas declaree ici', () => {
    expect(pourquoi(controleur('@Singleton'), PORTEE)).toBe('F5:@Singleton');
  });

  it('la forme Java de la portee est lue aussi', () => {
    const porteeJava = f(`${MAIN}/ScopeActivity.java`, [
      'package com.x;',
      '',
      'import javax.inject.Scope;',
      'import java.lang.annotation.Retention;',
      'import java.lang.annotation.RetentionPolicy;',
      '',
      '@Scope',
      '@Retention(RetentionPolicy.RUNTIME)',
      'public @interface ScopeActivity {',
      '}',
      '',
    ].join('\n'));
    expect(verdict(controleur('@ScopeActivity'), porteeJava)).toBe('unreferenced');
  });
});
