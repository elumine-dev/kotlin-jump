/**
 * Where the hardcoded string lint puts its warnings, read back on a project.
 *
 * The provider imports `vscode`, so this one needs the bundle rather than
 * vite-node:
 *
 *   node_modules/.bin/esbuild scripts/verify-hardcoded-strings.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/hc.cjs
 *   node dist/perf/hc.cjs <project-root>
 *
 * The detector reports a line and a column computed on a BLANKED copy of the
 * file, the same technique whose length and line count invariants were the
 * subject of v1.42.215. A drift of one character underlines the wrong text.
 *
 * Two invariants per finding:
 *   1. the reported position holds the opening quote of the literal, and the
 *      literal itself follows it in the RAW text;
 *   2. the finding is not inside a block comment, computed independently of
 *      the detector's own blanking.
 *
 * `KJ_TEMOIN=colonne` shifts every column by one and `KJ_TEMOIN=ligne` shifts
 * every line, so a clean reading can be told apart from a probe that checks
 * nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findHardcodedStrings } from '../src/providers/HardcodedStringProvider';

const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const APPELS = /\b(?:Text|setText|setTitle|setHint|setContentDescription|showToast|showSnackbar|setError|setSubtitle)\s*\(/;

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP_DIRS.has(x.name)) walk(full, hit); }
    else if (/\.(kt|java)$/.test(x.name)) hit(full);
  }
}

function main(): void {
  const racine = process.argv[2];
  if (!racine) { console.error('usage: verify-hardcoded-strings <project-root>'); process.exit(2); }
  const temoin = process.env.KJ_TEMOIN;
  const fichiers: string[] = [];
  walk(racine, f => fichiers.push(f));

  let trouvailles = 0;
  const violations: string[] = [];
  for (const f of fichiers) {
    const src = fs.readFileSync(f, 'utf8');
    if (!APPELS.test(src)) continue;
    const lignes = src.split('\n');
    const debuts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') debuts.push(i + 1);
    const blocs: [number, number][] = [];
    const re = /\/\*[\s\S]*?\*\//g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) blocs.push([m.index, m.index + m[0].length]);

    for (const brut of findHardcodedStrings(src)) {
      const h = temoin === 'colonne' ? { ...brut, column: brut.column + 1 }
        : temoin === 'ligne' ? { ...brut, line: brut.line + 1 } : brut;
      trouvailles++;
      const rel = path.relative(racine, f);
      const ligne = lignes[h.line] ?? '';
      if (ligne[h.column] !== '"' || ligne.slice(h.column + 1, h.column + 1 + h.literal.length) !== h.literal) {
        violations.push(`POSITION ${rel}:${h.line + 1}:${h.column}`);
        continue;
      }
      const offset = (debuts[h.line] ?? 0) + h.column;
      if (blocs.some(([a, b]) => offset >= a && offset < b)) violations.push(`COMMENTAIRE ${rel}:${h.line + 1}`);
    }
  }

  console.log(JSON.stringify({
    fichiers: fichiers.length, trouvailles, violations: violations.length, temoin: temoin ?? null,
  }));
  for (const v of violations.slice(0, 20)) console.log('  ' + v);
}

main();
