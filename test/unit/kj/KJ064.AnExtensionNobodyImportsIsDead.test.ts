import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-064 — une fonction ou propriete Kotlin de premier niveau que rien
 * n importe est morte, quels que soient ses homonymes.
 *
 * Elle n est atteignable que depuis son propre package, depuis un fichier qui
 * l importe par son nom complet (ou `package.*`), ou depuis Java par la
 * facade `FichierKt`. Sur le projet de reference, `fun ImageView.loadUrl(url)`
 * restait en vie grace a dix-neuf fichiers qui appellent `WebView.loadUrl`,
 * une methode Android. Un relecteur l a vu ; le sac de noms ne le pouvait pas.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const SEGS = ['test/java', 'test/kotlin'];
/** Les constats sur UN nom : les classes porteuses des fixtures ne sont pas le sujet. */
const scan = (sources: { path: string; text: string }[], name = 'loadUrl') =>
  mod.findUnusedSymbols({ sources, testSourceSets: SEGS, includeTestOnly: true })
    .filter((f: any) => f.name === name).map((f: any) => `${f.name}:${f.verdict}`);
const why = (sources: { path: string; text: string }[], name: string) => {
  const w = mod.explainSymbols({ sources, testSourceSets: SEGS, includeTestOnly: true }).find((x: any) => x.name === name);
  return w ? `${w.outcome}${w.via ? `:${w.via}` : ''}` : undefined;
};

const EXT = {
  path: '/w/core/src/main/java/com/x/binding/ImageViewBinding.kt',
  text: 'package com.x.binding\n\nimport android.widget.ImageView\n\nfun ImageView.loadUrl(url: String) {\n    load(url)\n}\n',
};
/** L homonyme : un WebView d Android, dans un autre package, sans import de l extension. */
const WEB = {
  path: '/w/core/src/main/java/com/x/web/WebVM.kt',
  text: 'package com.x.web\n\nimport android.webkit.WebView\n\nclass WebVM(private val webView: WebView) {\n    fun show(url: String) { webView.loadUrl(url) }\n}\n',
};

describe.skipIf(!mod)('une extension que rien n importe', () => {
  it('l homonyme d un autre package, sans import, ne la garde pas en vie', () => {
    expect(scan([EXT, WEB])).toEqual(['loadUrl:unreferenced']);
    expect(why([EXT, WEB], 'loadUrl')).toBe('unreferenced:visibility');
  });

  it('un import par son nom la garde en vie', () => {
    const user = { path: '/w/app/src/main/java/com/y/Screen.kt', text: 'package com.y\n\nimport com.x.binding.loadUrl\n\nclass Screen {\n    fun bind(v: android.widget.ImageView) { v.loadUrl("u") }\n}\n' };
    expect(scan([EXT, WEB, user])).toEqual([]);
  });

  it('un import de tout le package aussi', () => {
    const user = { path: '/w/app/src/main/java/com/y/Screen.kt', text: 'package com.y\n\nimport com.x.binding.*\n\nclass Screen {\n    fun bind(v: android.widget.ImageView) { v.loadUrl("u") }\n}\n' };
    expect(scan([EXT, WEB, user])).toEqual([]);
  });

  it('un appel depuis son propre package, sans import, aussi', () => {
    const same = { path: '/w/core/src/main/java/com/x/binding/Other.kt', text: 'package com.x.binding\n\nclass Other {\n    fun bind(v: android.widget.ImageView) { v.loadUrl("u") }\n}\n' };
    expect(scan([EXT, WEB, same])).toEqual([]);
  });

  it('Java passe par la facade, apres un import du package', () => {
    const java = { path: '/w/app/src/main/java/com/y/Binder.java', text: 'package com.y;\n\nimport com.x.binding.ImageViewBindingKt;\n\nclass Binder {\n    void bind(android.widget.ImageView v) { ImageViewBindingKt.loadUrl(v, "u"); }\n}\n' };
    expect(scan([EXT, WEB, java])).toEqual([]);
  });

  it('importee seulement par un test : testOnly, pas morte', () => {
    const test = { path: '/w/app/src/test/java/com/y/ScreenTest.kt', text: 'package com.y\n\nimport com.x.binding.loadUrl\nimport org.junit.Test\n\nclass ScreenTest {\n    @Test\n    fun t() { android.widget.ImageView(null).loadUrl("u") }\n}\n' };
    expect(scan([EXT, WEB, test])).toEqual(['loadUrl:testOnly']);
  });

  it('un operateur ou une declaration annotee garde l ancienne lecture', () => {
    // `plus` s appelle sans son nom, `@BindingAdapter` se joint depuis un
    // layout : la regle du package ne peut rien en dire.
    const op = { path: '/w/core/src/main/java/com/x/ops/Ops.kt', text: 'package com.x.ops\n\noperator fun android.graphics.Point.plus(o: android.graphics.Point) = this\n' };
    const opUser = { path: '/w/app/src/main/java/com/y/Geo.kt', text: 'package com.y\n\nclass Geo {\n    fun f(a: java.math.BigInteger, b: java.math.BigInteger) = a.plus(b)\n}\n' };
    expect(scan([op, opUser], 'plus')).toEqual([]);
    const adapter = { path: '/w/core/src/main/java/com/x/binding/Adapters.kt', text: 'package com.x.binding\n\n@BindingAdapter("imageUrl")\nfun android.widget.ImageView.loadUrl(url: String) {}\n' };
    expect(scan([adapter, WEB])).toEqual([]);
  });

  it('une mention dans une chaine laisse le doute, comme avant', () => {
    const reflective = { path: '/w/app/src/main/java/com/y/Reflect.kt', text: 'package com.y\n\nclass Reflect {\n    val method = "loadUrl"\n}\n' };
    expect(scan([EXT, WEB, reflective])).toEqual([]);
  });
});
