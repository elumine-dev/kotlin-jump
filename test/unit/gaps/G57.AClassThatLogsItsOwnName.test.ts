import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G57, une classe qui ecrit son propre nom dans une chaine reste en vie.
 *
 * Oracle : `7d356324a0` sur le projet de reference supprime a la main
 * `AvailableSpaceDetector.java`, que plus rien ne nomme depuis develop. Remove
 * All la laissait : `alive:same-file`, alors que ses quatre mentions sont
 * toutes dans son propre corps, dont deux dans des chaines de log :
 *
 *   Timber.d("Creating AvailableSpaceDetector");
 *   Timber.d("Dismissing AvailableSpaceDetector");
 *
 * La cause est un desaccord de comptage. `selfInFile` compte les chaines,
 * comme la recolte, pour que `mainMentions - selfInFile` isole les mentions
 * externes. `selfInSpan` compte sur le texte assaini, chaines blanchies. La
 * difference `selfInFile - selfInSpan` devait dire « nomme ailleurs dans son
 * fichier » ; elle disait en plus « se nomme dans une chaine ».
 *
 * Regle voulue : une mention de soi DANS sa propre etendue ne garde jamais en
 * vie, quelle que soit sa forme. Une chaine HORS de l'etendue, ou dans un
 * autre fichier (`Class.forName("p.Foo")`), garde toujours.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'] } as any);
const found = (sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols(base(sources)) as any[]).filter(s => s.verdict === 'unreferenced').map(s => s.name);

const OTHER = { path: '/p/app/src/main/java/p/Other.java', text: 'package p;\n\npublic class Other {}\n' };

const detector = (extra: string[] = []) => ({
  path: '/p/app/src/main/java/p/Detector.java',
  text: [
    'package p;',
    '',
    'import timber.log.Timber;',
    '',
    ...extra,
    'public final class Detector {',
    '',
    '\tprivate Detector() {',
    '\t}',
    '',
    '\tpublic static void create() {',
    '\t\tTimber.d("Creating Detector");',
    '\t}',
    '}',
    '',
  ].join('\n'),
});

describe('G57, une mention de soi dans une chaine de son propre corps', () => {
  it('la classe qui logge son nom est trouvee', () => {
    expect(found([detector(), OTHER])).toContain('Detector');
  });

  it('explain dit pareil que find (G41)', () => {
    const row = (symb.explainSymbols(base([detector(), OTHER])) as any[]).find(r => r.name === 'Detector');
    expect(row?.outcome).toBe('unreferenced');
  });

  it('meme forme en Kotlin : un TAG dans le compagnon', () => {
    const kt = {
      path: '/p/app/src/main/java/p/Watcher.kt',
      text: [
        'package p',
        '',
        'class Watcher {',
        '    fun start() = println(TAG)',
        '',
        '    companion object {',
        '        private const val TAG = "Watcher"',
        '    }',
        '}',
        '',
      ].join('\n'),
    };
    expect(found([kt, OTHER])).toContain('Watcher');
  });

  it('garde : une chaine HORS de son etendue, dans le meme fichier, la garde en vie', () => {
    const helper = {
      path: '/p/app/src/main/java/p/Detector.java',
      text: detector().text + 'class Loader {\n\tObject load() throws Exception { return Class.forName("p.Detector"); }\n}\n',
    };
    expect(found([helper, OTHER])).not.toContain('Detector');
  });

  it('garde : une chaine dans un AUTRE fichier la garde en vie', () => {
    const loader = {
      path: '/p/app/src/main/java/p/Loader.java',
      text: 'package p;\n\npublic class Loader {\n\tObject load() throws Exception { return Class.forName("p.Detector"); }\n}\n',
    };
    expect(found([detector(), loader, OTHER])).not.toContain('Detector');
  });

  it('garde : un usage de code dans le meme fichier, hors etendue, la garde en vie', () => {
    const user = {
      path: '/p/app/src/main/java/p/Detector.java',
      text: detector().text + 'class User {\n\tvoid go() { Detector.create(); }\n}\n',
    };
    expect(found([user, OTHER])).not.toContain('Detector');
  });
});
