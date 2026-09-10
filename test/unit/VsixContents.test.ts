/**
 * esbuild.js calls the perf and maintenance bundles "DEV ONLY, excluded from
 * VSIX". That was not true: the VSIX shipped both, plus the nine compiled e2e
 * suites, the web test harness, and the TypeScript sources of the logcat
 * webview, whose bundle is what index.html actually loads. Fourteen files no
 * user has any use for, and a comment claiming the opposite.
 *
 * Replays what vsce does with .vscodeignore rather than reading the file as
 * text: last matching pattern wins, `!` re-includes. A guard that only checked
 * exclusions could be satisfied by ignoring the whole extension, so the list of
 * files that MUST survive is checked too, walkthrough media included.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

/**
 * The globs .vscodeignore uses are simple, so they are compiled here rather
 * than pulled from minimatch, which is only a transitive dependency and whose
 * 3.x export shape differs from 9.x. The list this produces was cross checked
 * against a real `vsce ls`: 34 files, the 14 dev artefacts gone.
 */
function versRegex(motif: string): RegExp {
  let r = '';
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i];
    if (c === '*') {
      if (motif[i + 1] === '*') {
        if (motif[i + 2] === '/') { r += '(?:[^/]+/)*'; i += 2; } else { r += '.*'; i += 1; }
      } else {
        r += '[^/]*';
      }
      continue;
    }
    r += /[.+^${}()|[\]\\?]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + r + '$');
}

/** vsce semantics: patterns in order, last match decides, `!` re-includes. */
function ignore(chemin: string, motifs: string[]): boolean {
  let ignore = false;
  for (const brut of motifs) {
    const negation = brut.startsWith('!');
    const motif = negation ? brut.slice(1) : brut;
    if (versRegex(motif).test(chemin)) ignore = !negation;
  }
  return ignore;
}

function motifs(): string[] {
  return fs.readFileSync(path.join(REPO, '.vscodeignore'), 'utf8')
    .split(String.fromCharCode(10))
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

const DEV_SEULEMENT = [
  'dist/test/features.e2e.test.js',
  'dist/test/codelens.adversarial.e2e.test.js',
  'dist/test-web/suite/index.js',
  'dist/perf/perf-bench.js',
  'dist/perf/perf-diff.js',
  'dist/scripts/build-bundled-stdlib-index.js',
  'media/logcat/main.ts',
  'media/logcat/logMirror.ts',
  'src/extension.ts',
  'test/unit/setup.ts',
  'esbuild.js',
  'CLAUDE.md',
];

const INDISPENSABLE = [
  'dist/extension.js',
  'dist/extension.browser.js',
  'dist/server.js',
  'dist/parser-worker.js',
  'dist/logcat/main.js',
  'media/logcat/index.html',
  'media/logcat/styles.css',
  'media/logo.png',
  'media/whats-new.json',
  'syntaxes/kotlin.tmLanguage.json',
  'language-configuration.json',
  'snippets/kotlin.json',
  'README.md',
  'CHANGELOG.md',
];

describe('what the VSIX ships', () => {
  const pats = motifs();

  it('leaves out every build output that exists only for development', () => {
    const partis = DEV_SEULEMENT.filter(f => !ignore(f, pats));
    expect(partis, `ces fichiers partiraient dans le VSIX: ${partis.join(', ')}`).toEqual([]);
  });

  it('keeps everything the extension needs at runtime', () => {
    const perdus = INDISPENSABLE.filter(f => ignore(f, pats));
    expect(perdus, `ces fichiers manqueraient au VSIX: ${perdus.join(', ')}`).toEqual([]);
  });

  it('keeps the media the walkthrough points at', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const chemins = new Set<string>();
    for (const m of JSON.stringify(pkg.contributes?.walkthroughs ?? []).matchAll(/[\w./-]+\.(?:webp|png|svg|gif|md)/g)) {
      chemins.add(m[0]);
    }
    expect(chemins.size, 'le walkthrough ne reference plus rien, la detection a du casser').toBeGreaterThan(5);
    for (const c of chemins) {
      expect(ignore(c, pats), `${c} est referencé par le walkthrough et serait exclu`).toBe(false);
      expect(fs.existsSync(path.join(REPO, c)), `${c} est referencé par le walkthrough et absent du dépôt`).toBe(true);
    }
  });

  it('keeps the bundled standard library, which no other path can provide', () => {
    const bundled = fs.readdirSync(path.join(REPO, 'bundled'));
    const attendus = bundled.filter(n => /-index\.json$|-sources\.jar$/.test(n));
    expect(attendus.length).toBe(2);
    for (const n of attendus) expect(ignore(`bundled/${n}`, pats), n).toBe(false);
  });
});
