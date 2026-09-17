import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-063 — du code charge par codegen ou par reflexion, invisible a une
 * analyse d usages.
 *
 * Mesure sur un monorepo React Native : quatre suppressions cassaient le
 * build. Un `HybridAudioRecorder : HybridAudioRecorderSpec()` declare dans
 * `nitro.json` et instancie cote JavaScript par son nom ; un
 * `BaseReactPackage` qui fait le `System.loadLibrary`, decouvert par la CLI
 * qui balaie les sources ; un `implements ReactPackage` enregistre de la
 * meme facon. Aucune reference en Kotlin ni en Java, et pourtant vivants.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/lib/android/src/main/java/com/x';
const SEGS = ['test/java', 'test/kotlin'];
const scan = (sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: SEGS, includeTestOnly: true }).map((f: any) => f.name);
/** Un temoin : une classe que rien ne nomme et qu aucune garde ne protege. */
const DEAD = { path: `${MAIN}/Dead.kt`, text: 'package com.x\n\nclass Dead\n' };

describe.skipIf(!mod)('points d entree React Native et Nitro', () => {
  it('un ReactPackage, en Java comme en Kotlin, est instancie par l autolinking', () => {
    const java = { path: `${MAIN}/SafXPackage.java`, text: 'package com.x;\n\nimport com.facebook.react.ReactPackage;\n\npublic class SafXPackage implements ReactPackage {\n}\n' };
    const kt = { path: `${MAIN}/VoicePackage.kt`, text: 'package com.x\n\nimport com.facebook.react.BaseReactPackage\n\nclass VoicePackage : BaseReactPackage() {\n    fun x() = 1\n}\n' };
    expect(scan([java, kt, DEAD])).toEqual(['Dead']);
  });

  it('une classe qui etend une spec generee absente du corpus reste', () => {
    const hybrid = { path: `${MAIN}/HybridAudioRecorder.kt`, text: 'package com.x\n\nclass HybridAudioRecorder : HybridAudioRecorderSpec() {\n    override fun start() {}\n}\n' };
    const turbo = { path: `${MAIN}/CalcModule.kt`, text: 'package com.x\n\nclass CalcModule(ctx: Any) : NativeCalcModuleSpec(ctx) {\n    override fun add(a: Int, b: Int) = a + b\n}\n' };
    expect(scan([hybrid, turbo, DEAD])).toEqual(['Dead']);
  });

  it('un fichier qui charge une bibliotheque native est un pont JNI, il reste', () => {
    const bridge = { path: `${MAIN}/Whisper.kt`, text: 'package com.x\n\nclass Whisper {\n    init { System.loadLibrary("Whisper") }\n    external fun transcribe(path: String): String\n}\n' };
    expect(scan([bridge, DEAD])).toEqual(['Dead']);
  });

  it('nitro.json nomme la classe : une mention comme une autre', () => {
    // Sans supertype ni garde, seule la mention dans nitro.json la retient.
    const plain = { path: `${MAIN}/HybridClock.kt`, text: 'package com.x\n\nclass HybridClock {\n    fun now() = 1L\n}\n' };
    const nitro = { path: '/w/lib/nitro.json', text: '{\n  "autolinking": {\n    "Clock": { "kotlin": "HybridClock" }\n  }\n}\n' };
    expect(scan([plain, DEAD])).toEqual(['Dead', 'HybridClock']);
    expect(scan([plain, nitro, DEAD])).toEqual(['Dead']);
  });

  it('un autre JSON ne compte toujours pas', () => {
    const plain = { path: `${MAIN}/Thing.kt`, text: 'package com.x\n\nclass Thing\n' };
    const other = { path: '/w/lib/package.json', text: '{ "name": "Thing" }\n' };
    expect(scan([plain, other])).toEqual(['Thing']);
  });
});
