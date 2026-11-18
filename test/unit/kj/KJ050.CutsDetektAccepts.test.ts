import { describe, it, expect } from 'vitest';
import { collecterUnePasse, sansTrouDeLignesVides, Coupe } from '../../../src/commands/RemoveEverythingUnused';
import { findUnusedLocals } from '../../../src/providers/unusedLocals';
import { findEmptyBodies, findEmptyCompanions, findStrayEnumSemicolons } from '../../../src/providers/emptyCompanions';
import { planCascade } from '../../../src/providers/removalCascade';

/**
 * Remove Everything Unused applied to four open source apps, then detekt
 * (1.23.8, every rule, ktlint formatting) run on the original and on the cut
 * tree. Everything still compiled; these are the findings the cut tree had and
 * the original had not, one case each.
 */

const coupe = (start: number, end: number): Coupe => ({ start, end, texte: '', famille: 'symboles', quoi: 'x' });
/** The text once `quoi` (whole lines, from its first character to the end of the line holding `fin`) is cut. */
const apres = (texte: string, ...quoi: [string, string][]): string => {
  const coupes = quoi.map(([debut, fin]) => {
    const d = texte.indexOf(debut);
    const f = texte.indexOf('\n', texte.indexOf(fin, d)) + 1;
    return coupe(texte.lastIndexOf('\n', d) + 1, f);
  });
  const plages = sansTrouDeLignesVides(texte, coupes);
  return [...plages].sort((a, b) => b.start - a.start).reduce((s, c) => s.slice(0, c.start) + s.slice(c.end), texte);
};

describe('blank lines around a cut', () => {
  it('the last member of a class: no blank line left against `}` (NoBlankLineBeforeRbrace)', () => {
    const t = 'class W {\n    fun a() = 1\n\n    fun dead() {\n    }\n}\n';
    expect(apres(t, ['fun dead', '    }'])).toBe('class W {\n    fun a() = 1\n}\n');
  });

  it('two members in a row at the end of a class: same', () => {
    const t = 'class W {\n    fun a() = 1\n\n    fun dead1() = 1\n    fun dead2() = 2\n}\n';
    expect(apres(t, ['fun dead1', 'dead1'], ['fun dead2', 'dead2'])).toBe('class W {\n    fun a() = 1\n}\n');
  });

  it('the last declaration of the file: no trailing blank line (NoConsecutiveBlankLines)', () => {
    const t = 'package p\n\nclass A {\n}\n\nprivate fun dead() {\n}\n';
    expect(apres(t, ['private fun dead', '}'])).toBe('package p\n\nclass A {\n}\n');
  });

  it('the first member of a block: the block does not open on a blank line', () => {
    const t = 'class W {\n    fun dead() = 1\n\n    fun a() = 1\n}\n';
    expect(apres(t, ['fun dead', 'dead'])).toBe('class W {\n    fun a() = 1\n}\n');
  });

  // Seen on an open source IPTV app: the second-to-last cut took the blank
  // line under it, the last one took the same line above it, and the overlap
  // carried the `}` of the object away.
  it('three members in a row before `}`, a blank line between each: the `}` stays', () => {
    const t = 'object Routes {\n    const val A = 1\n\n    fun d1() =\n        x(1)\n\n    fun d2() =\n        x(2)\n\n    fun d3() =\n        x(3)\n}\n\nfun after() = 1\n';
    expect(apres(t, ['fun d1', 'x(1)'], ['fun d2', 'x(2)'], ['fun d3', 'x(3)'])).toBe('object Routes {\n    const val A = 1\n}\n\nfun after() = 1\n');
  });

  it('control: between two members, one blank line stays', () => {
    const t = 'class W {\n    fun a() = 1\n\n    fun dead() = 1\n\n    fun b() = 2\n}\n';
    expect(apres(t, ['fun dead', 'dead'])).toBe('class W {\n    fun a() = 1\n\n    fun b() = 2\n}\n');
  });

  it('control: no blank line above, nothing is taken above', () => {
    const t = 'class W {\n    fun a() = 1\n    fun dead() = 1\n}\n';
    expect(apres(t, ['fun dead', 'dead'])).toBe('class W {\n    fun a() = 1\n}\n');
  });
});

describe('an unused local whose kept initializer starts on the next line (NoTrailingSpaces)', () => {
  it('the initializer takes the place of `val`, with no line of spaces left', () => {
    const t = 'package a\n\nfun work(): Int {\n    log("start")\n    val serverId =\n        input.get("id")?.toInt() ?: return 0\n    return 1\n}\n';
    const u = findUnusedLocals(t).find(x => x.name === 'serverId')!;
    expect(u.fix).toBe('keepCall');
    const out = t.slice(0, u.fixStart) + u.fixText + t.slice(u.fixEnd);
    expect(out).toBe('package a\n\nfun work(): Int {\n    log("start")\n    input.get("id")?.toInt() ?: return 0\n    return 1\n}\n');
  });

  it('control: on one line, unchanged', () => {
    const t = 'package a\n\nfun work() {\n    val unused = compute()\n}\n';
    const u = findUnusedLocals(t).find(x => x.name === 'unused')!;
    expect(t.slice(0, u.fixStart) + t.slice(u.fixEnd)).toBe('package a\n\nfun work() {\n    compute()\n}\n');
  });
});

describe('an empty companion object (EmptyClassBlock)', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const empty = 'package a\n\nclass Adapter {\n    fun count() = 1\n\n    companion object {\n    }\n}\n';

  it('goes', () => {
    const [c] = findEmptyCompanions([{ path: `${P}Adapter.kt`, text: empty }]);
    expect(c.owner).toBe('Adapter');
    expect(empty.slice(c.start, c.end)).toBe('    companion object {\n    }\n');
  });

  it('the pass cuts it, with the blank line above', () => {
    const r = collecterUnePasse([{ path: `${P}Adapter.kt`, text: empty }, { path: `${P}Main.kt`, text: 'package a\n\nfun main() = Adapter().count()\n' }], ['test/java']);
    const cuts = r.parFichier.get(`${P}Adapter.kt`) ?? [];
    expect(cuts.map(c => c.quoi)).toEqual(['Adapter.Companion']);
    const out = sansTrouDeLignesVides(empty, cuts).sort((a, b) => b.start - a.start).reduce((s, c) => s.slice(0, c.start) + s.slice(c.end), empty);
    expect(out).toBe('package a\n\nclass Adapter {\n    fun count() = 1\n}\n');
  });

  it('`{}` on one line too', () => {
    expect(findEmptyCompanions([{ path: `${P}A.kt`, text: 'package a\n\nclass A {\n    companion object {}\n}\n' }])).toHaveLength(1);
  });

  it('kept when something names Owner.Companion (an extension receiver, Java)', () => {
    const ext = { path: `${P}Ext.kt`, text: 'package a\n\nfun Adapter.Companion.make() = Adapter()\n' };
    expect(findEmptyCompanions([{ path: `${P}Adapter.kt`, text: empty }, ext])).toEqual([]);
  });

  it('a visibility says nothing: `private companion object {}` goes too', () => {
    expect(findEmptyCompanions([{ path: `${P}A.kt`, text: 'package a\n\nclass A {\n    private companion object {\n    }\n}\n' }])).toHaveLength(1);
  });

  it('kept when it says something: a member, a name, a supertype, an annotation', () => {
    for (const body of [
      'companion object {\n        const val X = 1\n    }',
      'companion object Factory {\n    }',
      'companion object : Creator {\n    }',
      '@JvmStatic\n    companion object {\n    }',
      'companion object {\n        // kept for binary compatibility\n    }',
    ]) {
      const t = `package a\n\nclass A {\n    ${body}\n}\n`;
      expect(findEmptyCompanions([{ path: `${P}A.kt`, text: t }]), body).toEqual([]);
    }
  });
});

describe('a property whose accessor sits under a comment (the cut tree no longer parsed)', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const coupeDe = (t: string) => {
    const r = collecterUnePasse([{ path: `${P}C.kt`, text: t }, { path: `${P}M.kt`, text: 'package a\n\nfun main() = C().a()\n' }], ['test/java']);
    return (r.parFichier.get(`${P}C.kt`) ?? []).filter(c => c.texte === '').map(c => t.slice(c.start, c.end));
  };

  it('a KDoc between the property and its getter: the getter goes with it', () => {
    const t = 'package a\n\nclass C {\n    fun a() = 1\n\n    private val method: String\n        /**\n         * Doc.\n         */\n        get() = try {\n            "x"\n        } catch (e: Exception) {\n            "y"\n        }\n}\n';
    expect(coupeDe(t)).toEqual(['    private val method: String\n        /**\n         * Doc.\n         */\n        get() = try {\n            "x"\n        } catch (e: Exception) {\n            "y"\n        }\n']);
  });

  it('a line comment between them: same', () => {
    const t = 'package a\n\nclass C {\n    fun a() = 1\n\n    private val method: String\n        // doc\n        get() = "x"\n}\n';
    expect(coupeDe(t)).toEqual(['    private val method: String\n        // doc\n        get() = "x"\n']);
  });

  it('control: a KDoc that opens the NEXT declaration stays with it', () => {
    const t = 'package a\n\nclass C {\n    private val dead: Int = 1\n    /** Doc of b. */\n    fun a() = 1\n}\n';
    expect(coupeDe(t)).toEqual(['    private val dead: Int = 1\n']);
  });
});

describe('a file left with nothing that matters is deleted', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const morts = (t: string) => {
    const r = collecterUnePasse([{ path: `${P}Gone.kt`, text: t }, { path: `${P}M.kt`, text: 'package a\n\nfun main() = 1\n' }], ['test/java']);
    return [...r.fichiersMorts].map(p => p.slice(P.length));
  };

  it('a header comment, `@file:Suppress(` over several lines, imports: deleted', () => {
    expect(morts('/*\n * License\n */\n@file:Suppress(\n    "unused",\n    "MagicNumber",\n)\n\npackage a\n\nimport x.Y\n\n/** Doc of something gone. */\n')).toEqual(['Gone.kt']);
  });

  it('the same file emptied by the round: the cascade deletes it too', () => {
    const t = '@file:Suppress(\n    "unused",\n)\n\npackage a\n\nclass Dead\n';
    const r = collecterUnePasse([{ path: `${P}Gone.kt`, text: t }, { path: `${P}M.kt`, text: 'package a\n\nfun main() = 1\n' }], ['test/java']);
    const textes = new Map([[`${P}Gone.kt`, t]]);
    const cuts = new Map([...r.parFichier].filter(([p]) => p.endsWith('Gone.kt')).map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end }))]));
    expect(planCascade(cuts, textes, r.fichiersMorts).deleteFiles.has(`${P}Gone.kt`) || r.fichiersMorts.has(`${P}Gone.kt`)).toBe(true);
  });

  it('control: one declaration left keeps the file', () => {
    expect(morts('@file:Suppress(\n    "unused",\n)\n\npackage a\n\ntypealias T = Int\n')).toEqual([]);
  });
});

describe('the comment written right above a removed declaration goes with it', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const MAIN = { path: `${P}M.kt`, text: 'package a\n\nfun main() = live() + live2()\n' };
  const apresPasse = (t: string, autres = [MAIN]) => {
    const r = collecterUnePasse([{ path: `${P}F.kt`, text: t }, ...autres], ['test/java']);
    const cuts = r.parFichier.get(`${P}F.kt`) ?? [];
    return sansTrouDeLignesVides(t, cuts).sort((a, b) => b.start - a.start).reduce((s, c) => s.slice(0, c.start) + s.slice(c.end), t);
  };
  const LIVE = 'package a\n\nfun live() = 1\n\nfun live2() = 3\n';

  for (const [nom, commentaire] of [
    ['a `//` line', '// Computes the thing.\n'],
    ['two `//` lines', '// Computes the thing.\n// Second line.\n'],
    ['a block comment', '/* Old helper. */\n'],
    ['a KDoc', '/**\n * Doc.\n */\n'],
  ] as const) {
    it(nom, () => {
      expect(apresPasse(`package a\n\nfun live() = 1\n\n${commentaire}fun dead() = 2\n\nfun live2() = 3\n`)).toBe(LIVE);
    });
  }

  it('the last declaration of the file, with its comment: nothing left behind', () => {
    expect(apresPasse('package a\n\nfun live() = 1\n\n// Last one.\nfun dead() = 2\n', [{ path: `${P}M.kt`, text: 'package a\n\nfun main() = live()\n' }]))
      .toBe('package a\n\nfun live() = 1\n');
  });

  it('a private member', () => {
    const t = 'package a\n\nclass C {\n    fun a() = 1\n\n    // Old member.\n    private fun dead() = 2\n\n    fun b() = 3\n}\n';
    expect(apresPasse(t, [{ path: `${P}M.kt`, text: 'package a\n\nfun main() = C().a() + C().b()\n' }]))
      .toBe('package a\n\nclass C {\n    fun a() = 1\n\n    fun b() = 3\n}\n');
  });

  it('an enum entry', () => {
    const t = 'package a\n\nenum class E {\n    A,\n    // Not used any more.\n    DEAD,\n    B,\n}\n';
    expect(apresPasse(t, [{ path: `${P}M.kt`, text: 'package a\n\nfun main() = listOf(E.A, E.B)\n' }]))
      .toBe('package a\n\nenum class E {\n    A,\n    B,\n}\n');
  });

  it('control: a comment separated by a blank line is a section, it stays', () => {
    expect(apresPasse('package a\n\nfun live() = 1\n\n// Helpers\n\nfun dead() = 2\n\nfun live2() = 3\n'))
      .toBe('package a\n\nfun live() = 1\n\n// Helpers\n\nfun live2() = 3\n');
  });

  it('control: a section marker right above stays, its pair would be orphaned', () => {
    for (const marque of ['// region Helpers', '//endregion', '// MARK: - Helpers', '// ----------']) {
      const out = apresPasse(`package a\n\nfun live() = 1\n\n${marque}\nfun dead() = 2\n\nfun live2() = 3\n`);
      expect(out, marque).toContain(marque);
      expect(out, marque).not.toContain('dead');
    }
  });
});

describe('a class body left empty: the braces go, the class stays (NoEmptyClassBody)', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const sans = (t: string) => {
    const b = findEmptyBodies([{ path: `${P}A.kt`, text: t }]);
    return [...b].sort((x, y) => y.start - x.start).reduce((s, c) => s.slice(0, c.start) + s.slice(c.end), t);
  };

  it('a data class whose members all went', () => {
    expect(sans('package a\n\ndata class Ui(\n    val a: String = "",\n) {\n}\n\nfun f() = 1\n')).toBe('package a\n\ndata class Ui(\n    val a: String = "",\n)\n\nfun f() = 1\n');
  });

  it('an enum whose entries went on one line: `{  }`', () => {
    expect(sans('package a\n\nenum class Channel {  }\n')).toBe('package a\n\nenum class Channel\n');
  });

  it('an object and an interface', () => {
    expect(sans('package a\n\nobject O {}\n\ninterface I {\n}\n')).toBe('package a\n\nobject O\n\ninterface I\n');
  });

  it('control: a body holding a comment, a member or an anonymous object stays', () => {
    for (const t of [
      'package a\n\nclass A {\n    // kept on purpose\n}\n\nfun b() = listOf<Int>().map {}\n',
      'package a\n\nclass A {\n    fun f() {}\n}\n',
      'package a\n\nval x = object : Runnable {\n    override fun run() {}\n}\n',
    ]) expect(sans(t), t).toBe(t);
  });

  it('the pass takes it, and the class stays', () => {
    const t = 'package a\n\ndata class Ui(\n    val a: String = "",\n) {\n}\n\nfun main() = Ui().a\n';
    const r = collecterUnePasse([{ path: `${P}Ui.kt`, text: t }], ['test/java']);
    const cuts = r.parFichier.get(`${P}Ui.kt`) ?? [];
    expect(cuts.map(c => c.quoi)).toEqual(['Ui {}']);
    expect(cuts.reduce((s, c) => s.slice(0, c.start) + s.slice(c.end), t)).toBe('package a\n\ndata class Ui(\n    val a: String = "",\n)\n\nfun main() = Ui().a\n');
  });

  it('the companion is not taken here: it goes whole, with its line', () => {
    expect(findEmptyBodies([{ path: `${P}A.kt`, text: 'package a\n\nclass A {\n    fun f() = 1\n\n    companion object {\n    }\n}\n' }])).toEqual([]);
  });
});

describe('a private data class or enum nothing uses is swept (UnusedPrivateClass)', () => {
  const P = '/w/app/src/main/kotlin/a/';
  const balaye = (t: string) => {
    const r = collecterUnePasse([{ path: `${P}F.kt`, text: t }, { path: `${P}M.kt`, text: 'package a\n\nfun main() = live()\n' }], ['test/java']);
    return (r.parFichier.get(`${P}F.kt`) ?? []).map(c => c.quoi || (c as any).preuve?.nom);
  };

  it('a private data class', () => {
    expect(balaye('package a\n\nprivate data class Draft(\n    val name: String,\n)\n\nfun live() = 1\n')).toEqual(['Draft']);
  });

  it('a private enum class', () => {
    expect(balaye('package a\n\nprivate enum class Mode { A, B }\n\nfun live() = 1\n')).toEqual(['Mode']);
  });

  it('control: used, it stays', () => {
    expect(balaye('package a\n\nprivate data class Draft(val name: String)\n\nfun live() = Draft("x").name.length\n')).toEqual([]);
  });
});

describe('an unused local over several lines', () => {
  const fix = (t: string, name: string) => {
    const u = findUnusedLocals(t).find(x => x.name === name)!;
    return t.slice(0, u.fixStart) + u.fixText + t.slice(u.fixEnd);
  };

  // The `.map` left behind attached itself to the statement above and changed
  // what it computed.
  it('a call chain on the next line goes with its `val` (or stays whole)', () => {
    const t = 'package a\n\nfun f(pr: List<Pair<Int, Int>>): List<Int> {\n    val reward = pr\n        .map { it.second }\n\n    val project = pr\n        .map { it.first }\n\n    return reward\n}\n';
    const out = fix(t, 'project');
    expect(out).not.toMatch(/\.map \{ it\.second \}\n\n\s*\.map/);
    expect(out).toContain('    pr\n        .map { it.first }\n');
  });

  it('an initializer over several lines under its `val` comes back one step (Indentation)', () => {
    const t = 'package a\n\nfun f(uri: String) {\n    val survey =\n        Builder().urls(\n            Urls.web(uri),\n        ).build()\n    println(1)\n}\n';
    expect(fix(t, 'survey')).toBe('package a\n\nfun f(uri: String) {\n    Builder().urls(\n        Urls.web(uri),\n    ).build()\n    println(1)\n}\n');
  });

  it('control: a raw string is never re-indented', () => {
    const t = 'package a\n\nfun f() {\n    val sql =\n        run("""\n            SELECT 1\n        """)\n    println(1)\n}\n';
    expect(fix(t, 'sql')).toContain('            SELECT 1\n');
  });
});

describe('the `;` an enum keeps once its members went (NoSemicolons)', () => {
  const P = '/w/app/src/main/kotlin/a/';
  it('goes, the entries stay', () => {
    const t = 'package a\n\nenum class LoginReason {\n    DEFAULT,\n    STAR_PROJECT;\n}\n';
    const [s] = findStrayEnumSemicolons([{ path: `${P}E.kt`, text: t }]);
    expect(t.slice(0, s.start) + t.slice(s.end)).toBe('package a\n\nenum class LoginReason {\n    DEFAULT,\n    STAR_PROJECT\n}\n');
  });

  it('the pass takes it, in the round after the members went', () => {
    const t = 'package a\n\nenum class LoginReason {\n    DEFAULT,\n    STAR_PROJECT;\n}\n';
    const r = collecterUnePasse([{ path: `${P}E.kt`, text: t }, { path: `${P}M.kt`, text: 'package a\n\nfun main() = listOf(LoginReason.DEFAULT, LoginReason.STAR_PROJECT)\n' }], ['test/java']);
    expect((r.parFichier.get(`${P}E.kt`) ?? []).map(c => c.quoi)).toEqual(['LoginReason;']);
  });

  it('control: a `;` before members stays', () => {
    const t = 'package a\n\nenum class E {\n    A;\n\n    val x = 1\n}\n';
    expect(findStrayEnumSemicolons([{ path: `${P}E.kt`, text: t }])).toEqual([]);
  });
});

describe('the continuation rule does not swallow the next statement', () => {
  const fixOf = (t: string, name: string) => {
    const u = findUnusedLocals(t).find(x => x.name === name);
    return u ? t.slice(0, u.fixStart) + u.fixText + t.slice(u.fixEnd) : undefined;
  };

  // `++` read as an operator waiting for its operand: the extent took the
  // `when` below, where `id` is read, and `id` looked unused. Wholphin no
  // longer compiled.
  it('a postfix `++` ends the statement: the local read below stays alive', () => {
    expect(fixOf('fun f() {\n    val id = idCounter++\n    val row =\n        when (t) {\n            A -> Row(id = id)\n        }\n    use(row)\n}\n', 'id')).toBeUndefined();
  });

  it('a `//` inside a string is not a comment: the whole initializer comes back one step', () => {
    expect(fixOf('fun f() {\n    launch {\n        val intent =\n            Intent(VIEW).apply {\n                setData("https://example.com/v.mp4")\n            }\n        go()\n    }\n}\n', 'intent'))
      .toBe('fun f() {\n    launch {\n        Intent(VIEW).apply {\n            setData("https://example.com/v.mp4")\n        }\n        go()\n    }\n}\n');
  });

  // Seen on an open source utility app: the next line opened on a string,
  // blanked it read `.format(hour, min)`, the extent swallowed the line that
  // reads `min`, and the app no longer compiled.
  it('a next line opening on a string literal is a new statement', () => {
    expect(fixOf('fun f() {\n    val min = cal.get(MINUTE)\n    "%02d:%02d".format(hour, min)\n}\n', 'min')).toBeUndefined();
  });

  it('control: a trailing comment stays where it was', () => {
    expect(fixOf('fun f() {\n    val x = compute() // note\n    go()\n}\n', 'x')).toBe('fun f() {\n    compute() // note\n    go()\n}\n');
  });
});
