import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';
import { isUnderAny, parseGitmodulesPaths, submoduleDirsOf } from '../../../src/util/gitSubmodules';

/**
 * An open source reader app vendors two UI libraries as git submodules
 * (`modules/miuix`, `modules/mochi`). One pass found 2602 cuts inside them:
 * written to disk, they leave the parent pointing at a commit that no longer
 * matches, and the user has nowhere to commit them. A submodule is another
 * repository, so the pass neither reads nor cuts anything under it.
 */

const ROOT = '/w';
const GITMODULES = '[submodule "modules/miuix"]\n\tpath = modules/miuix\n\turl = https://example.com/miuix.git\n\tbranch = legado/x\n'
  + '[submodule "modules/mochi"]\n\tpath = modules/mochi\n\turl = https://example.com/mochi.git\n';
const SEGS = ['test/java', 'test/kotlin'];

describe('.gitmodules', () => {
  it('reads every path, and nothing else', () => {
    expect(parseGitmodulesPaths(GITMODULES)).toEqual(['modules/miuix', 'modules/mochi']);
    expect(parseGitmodulesPaths('')).toEqual([]);
    expect(parseGitmodulesPaths('[submodule "a"]\n  path = "libs/with space/"\n')).toEqual(['libs/with space']);
  });

  it('absolute directories, matched on a whole path component', () => {
    const dirs = submoduleDirsOf(`${ROOT}/`, GITMODULES);
    expect(dirs).toEqual(['/w/modules/miuix', '/w/modules/mochi']);
    expect(isUnderAny('/w/modules/miuix/core/src/main/kotlin/A.kt', dirs)).toBe(true);
    // A sibling whose name starts the same is not inside.
    expect(isUnderAny('/w/modules/miuix-extra/src/main/kotlin/A.kt', dirs)).toBe(false);
    expect(isUnderAny('C:\\w\\modules\\mochi\\A.kt', ['C:\\w\\modules\\mochi'])).toBe(true);
  });
});

describe('the pass leaves submodules alone', () => {
  const sources = [
    { path: '/w/modules/miuix/core/src/main/kotlin/m/Dead.kt', text: 'package m\n\nclass Dead\n' },
    { path: '/w/modules/miuix/core/src/main/kotlin/m/Api.kt', text: 'package m\n\nimport android.util.Log\n\nclass Api {\n    fun used() = 1\n    fun unused() = 2\n}\n' },
    { path: '/w/app/src/main/kotlin/a/App.kt', text: 'package a\n\nimport m.Api\n\nclass AppDead\n\nfun main() = Api().used()\n' },
  ];
  const dirs = submoduleDirsOf(ROOT, GITMODULES);

  it('no cut and no dead file under a submodule', () => {
    const { parFichier, fichiersMorts } = collecterUnePasse(sources, SEGS, { submoduleDirs: dirs });
    expect([...parFichier.keys(), ...fichiersMorts].filter(p => isUnderAny(p, dirs))).toEqual([]);
  });

  it('the app itself is still cleaned', () => {
    const { parFichier, fichiersMorts } = collecterUnePasse(sources, SEGS, { submoduleDirs: dirs });
    expect([...parFichier.keys(), ...fichiersMorts].some(p => p.endsWith('/App.kt'))).toBe(true);
  });

  it('control: without the directories, the submodule is cut', () => {
    const { parFichier, fichiersMorts } = collecterUnePasse(sources, SEGS);
    expect([...parFichier.keys(), ...fichiersMorts].some(p => isUnderAny(p, dirs))).toBe(true);
  });

  describe('resource files', () => {
    const LAYOUT = '/w/modules/mochi/lib/src/main/res/layout/lib_row.xml';
    const lib = { path: '/w/modules/mochi/lib/src/main/kotlin/m/Lib.kt', text: 'package m\n\nfun lib() = 1\n' };
    const all = [...sources, lib, { path: LAYOUT, text: '<LinearLayout/>\n' }];
    const ctx = {
      resourceEntries: [{ kind: 'layout' as const, name: 'lib_row', variants: [{ path: LAYOUT, qualifier: 'layout', moduleDir: '/w/modules/mochi/lib' }] }],
      moduleDirs: ['/w/app', '/w/modules/mochi/lib'],
      modulesWithCode: ['/w/app', '/w/modules/mochi/lib'],
      libraryModules: ['/w/modules/mochi/lib'],
      assets: [],
    };
    const cut = (c: object) => { const r = collecterUnePasse(all, SEGS, c); return [...r.parFichier.keys(), ...r.fichiersMorts]; };

    it('control: without the directories, the unused layout of the library goes', () => {
      expect(cut(ctx)).toContain(LAYOUT);
    });

    it('with them, it stays', () => {
      expect(cut({ ...ctx, submoduleDirs: dirs })).not.toContain(LAYOUT);
    });
  });

  describe('assets', () => {
    const ASSET = '/w/modules/mochi/lib/src/main/assets/lib_theme.json';
    const lib = { path: '/w/modules/mochi/lib/src/main/kotlin/m/Lib.kt', text: 'package m\n\nfun lib() = 1\n' };
    const ctx = {
      assets: [{ path: ASSET, text: '{}\n' }],
      moduleDirs: ['/w/app', '/w/modules/mochi/lib'],
      modulesWithCode: ['/w/app', '/w/modules/mochi/lib'],
      resourceEntries: [],
    };
    const cut = (c: object) => { const r = collecterUnePasse([...sources, lib], SEGS, c); return [...r.parFichier.keys(), ...r.fichiersMorts]; };

    it('control: without the directories, the unread asset of the library goes', () => {
      expect(cut(ctx)).toContain(ASSET);
    });

    it('with them, it stays', () => {
      expect(cut({ ...ctx, submoduleDirs: dirs })).not.toContain(ASSET);
    });
  });
});
