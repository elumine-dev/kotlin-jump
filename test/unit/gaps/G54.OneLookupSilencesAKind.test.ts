import { describe, it, expect } from 'vitest';
import { findUnusedResourceKeys } from '../../../src/providers/unusedResourceKeys';
import { collectValueKeyDeclarations } from '../../../src/indexer/ValueResourceScanner';
import { dynamicallyLookedUpKinds, dynamicResourceLookups } from '../../../src/util/xmlRefs';
import { findUnusedResources } from '../../../src/providers/UnusedResourceProvider';

/**
 * G54 — un seul `getIdentifier` eteignait toute une sorte de ressources.
 *
 * `dynamicallyLookedUpKinds` ne lisait que le TYPE de l appel. Sur LaPresse :
 *
 *   CrosswordsSettingsView.java:132
 *     getIdentifier("crosswords_settings_faq_q" + i, "string", pkg)
 *     -> les 1541 strings du projet eteintes ; 175 sont mortes
 *   BottomNavigationViewController.kt:275, PostVisibility.kt:88
 *     getIdentifier("navigation_bar_height", "dimen", "android")
 *     -> tous les dimens eteints ; 59 sont morts
 *
 * Les trois arguments disent ce qui est atteint :
 *
 *   paquet "android"                  une ressource du systeme, rien du projet
 *   nom entierement litteral          rien a eteindre : la recolte des
 *                                     litteraux garde deja ce nom
 *   nom a prefixe litteral            seules les cles de ce prefixe
 *   nom calcule                       toute la sorte, comme avant
 *   type calcule                      toutes les sortes, comme avant
 */

const MODULE = '/proj/app';
const XML_PATH = `${MODULE}/src/main/res/values/strings.xml`;
const XML = [
  '<resources>',
  '    <string name="crosswords_settings_faq_q1">Q1</string>',
  '    <string name="crosswords_settings_faq_q2">Q2</string>',
  '    <string name="dead_label">mort</string>',
  '    <dimen name="dead_margin">4dp</dimen>',
  '</resources>',
].join('\n');

const f = (path: string, text: string) => ({ path, text });
const morts = (...code: string[]) => {
  const declarations = collectValueKeyDeclarations(XML_PATH, XML, [MODULE]);
  const sources = [f(XML_PATH, XML), ...code.map((c, i) => f(`${MODULE}/src/main/java/com/x/C${i}.kt`, c))];
  return findUnusedResourceKeys({ declarations, sources, modulesWithCode: [MODULE] }).map(k => `${k.kind}/${k.name}`).sort();
};

const CROSSWORDS = 'package com.x\n\nfun q(res: Resources, i: Int, pkg: String) = res.getIdentifier("crosswords_settings_faq_q" + i, "string", pkg)\n';
const NAV_BAR = 'package com.x\n\nfun h(res: Resources) = res.getIdentifier("navigation_bar_height", "dimen", "android")\n';

describe('G54 — lire le nom et le paquet', () => {
  it('un prefixe litteral ne garde que ses cles', () => {
    expect(morts(CROSSWORDS)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('le paquet android n eteint rien du projet', () => {
    expect(morts(NAV_BAR)).toContain('dimen/dead_margin');
  });

  it('les deux ensemble, comme sur LaPresse', () => {
    expect(morts(CROSSWORDS, NAV_BAR)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('un gabarit Kotlin a prefixe litteral', () => {
    const code = 'package com.x\n\nfun q(res: Resources, i: Int, pkg: String) = res.getIdentifier("crosswords_settings_faq_q$i", "string", pkg)\n';
    expect(morts(code)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('un String.format a prefixe litteral, en Java', () => {
    const code = 'package com.x;\n\nclass Q { int q(Resources res, int i, String pkg) { return res.getIdentifier(String.format("crosswords_settings_faq_q%d", i), "string", pkg); } }\n';
    expect(morts(code)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('un nom entierement litteral : la recolte des litteraux suffit', () => {
    const code = 'package com.x\n\nfun q(res: Resources, pkg: String) = res.getIdentifier("crosswords_settings_faq_q1", "string", pkg)\n';
    expect(morts(code)).toEqual(['string/crosswords_settings_faq_q2', 'string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('dynamicResourceLookups dit sorte et prefixes', () => {
    const r = dynamicResourceLookups(CROSSWORDS + NAV_BAR);
    expect(r).not.toBeNull();
    expect([...r!.kinds]).toEqual([]);
    expect([...(r!.prefixes.get('string') ?? [])]).toEqual(['crosswords_settings_faq_q']);
  });
});

describe('G54 — ce qui reste eteint', () => {
  it('un nom calcule eteint encore toute la sorte', () => {
    const code = 'package com.x\n\nfun q(res: Resources, key: String, pkg: String) = res.getIdentifier(key, "string", pkg)\n';
    expect(morts(code)).toEqual(['dimen/dead_margin'].sort());
  });

  it('un type calcule eteint encore tout', () => {
    expect(dynamicallyLookedUpKinds('res.getIdentifier(name, type, pkg)')).toBeNull();
    expect(dynamicResourceLookups('res.getIdentifier("a_" + i, type, pkg)')).toBeNull();
  });

  it('un paquet calcule qui n est pas android reste un appel du projet', () => {
    const code = 'package com.x\n\nfun q(res: Resources, i: Int) = res.getIdentifier("crosswords_settings_faq_q" + i, "string", context.packageName)\n';
    expect(morts(code)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('un prefixe vide ne vaut pas mieux qu un nom calcule', () => {
    const code = 'package com.x\n\nfun q(res: Resources, i: Int, pkg: String) = res.getIdentifier("" + i, "string", pkg)\n';
    expect(morts(code)).toEqual(['dimen/dead_margin'].sort());
  });

  it('une virgule dans le nom ne decale pas les arguments', () => {
    const code = 'package com.x;\n\nclass Q { int q(Resources res, int i, int j, String pkg) { return res.getIdentifier(String.format("crosswords_settings_faq_q%d_%d", i, j), "string", pkg); } }\n';
    expect(morts(code)).toEqual(['string/dead_label', 'dimen/dead_margin'].sort());
  });

  it('un getter sans argument n est pas getIdentifier de Resources', () => {
    expect(morts('package com.x\n\nfun g(a: Article) = a.getIdentifier()\n')).toEqual(['string/crosswords_settings_faq_q1', 'string/crosswords_settings_faq_q2', 'string/dead_label', 'dimen/dead_margin'].sort());
  });
});

/** Les ressources FICHIERS (drawables, layouts) lisent la meme reponse. */
describe('G54 — un drawable cherche par prefixe', () => {
  const variant = (path: string) => ({ path, qualifier: 'drawable', moduleDir: MODULE });
  const dessins = (code: string) => findUnusedResources({
    entries: [
      { kind: 'drawable', name: 'ic_weather_sun', variants: [variant(`${MODULE}/src/main/res/drawable/ic_weather_sun.xml`)] },
      { kind: 'drawable', name: 'ic_other', variants: [variant(`${MODULE}/src/main/res/drawable/ic_other.xml`)] },
    ] as any,
    sources: [f(`${MODULE}/src/main/kotlin/W.kt`, code)],
    modulesWithCode: [MODULE],
    includeDrawables: true,
  } as any).map((x: any) => `${x.kind}/${x.name}`);

  it('seul le prefixe cherche reste vivant', () => {
    expect(dessins('package com.x\n\nfun w(res: Resources, c: String, pkg: String) = res.getIdentifier("ic_weather_" + c, "drawable", pkg)\n'))
      .toEqual(['drawable/ic_other']);
  });

  it('un nom calcule eteint encore toute la sorte', () => {
    expect(dessins('package com.x\n\nfun w(res: Resources, n: String, pkg: String) = res.getIdentifier(n, "drawable", pkg)\n'))
      .toEqual([]);
  });
});
