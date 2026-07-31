/**
 * Exit gate for KJ-033: does the word index actually return the files that
 * reference a symbol, across the Kotlin/Java boundary?
 *
 *   npx tsx scripts/scan-java-recall.ts <project-root> [--sample N]
 *
 * Two sets are computed independently and compared:
 *   truth      — a plain text search: files importing the FQN, importing its
 *                package with a wildcard, static-importing it, or declaring
 *                the same package
 *   candidates — index.getFilesContainingWord(name, target)
 *
 * Recall below 1.0 means a usage search silently misses files. Before the
 * fix, cross-package Java recall was ~0: a Kotlin interface imported by 56
 * Java files returned none of them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SymbolIndex } from '../src/indexer/SymbolIndex';
import { parse } from '../src/indexer/KotlinParser';
import { parseJava } from '../src/indexer/JavaParser';

const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

interface SourceFile {
  uri: string;
  fsPath: string;
  text: string;
  isJava: boolean;
}

function collect(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  (function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.(kt|java)$/.test(e.name)) {
        try {
          out.push({
            uri: `file://${full}`,
            fsPath: full,
            text: fs.readFileSync(full, 'utf8'),
            isJava: e.name.endsWith('.java'),
          });
        } catch {
          // unreadable file contributes nothing
        }
      }
    }
  })(root);
  return out;
}

/** Files that genuinely can see this symbol, by plain text search. */
function truthSet(files: readonly SourceFile[], fqn: string, pkg: string, declUri: string): Set<string> {
  const simple = fqn.slice(fqn.lastIndexOf('.') + 1);
  const hits = new Set<string>();
  for (const f of files) {
    if (f.uri === declUri) continue;
    if (!f.text.includes(simple)) continue;
    const importsIt =
      f.text.includes(`import ${fqn};`) ||
      f.text.includes(`import ${fqn}\n`) ||
      f.text.includes(`import ${pkg}.*`) ||
      f.text.includes(`import static ${fqn}`);
    const samePackage =
      new RegExp(`^\\s*package\\s+${pkg.replace(/\./g, '\\.')}\\s*;?\\s*$`, 'm').test(f.text);
    if (importsIt || samePackage) hits.add(f.uri);
  }
  return hits;
}

function main(): void {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: scan-java-recall <project-root> [--sample N]');
    process.exit(2);
  }
  const sampleArg = process.argv.indexOf('--sample');
  const sampleSize = sampleArg !== -1 ? Number(process.argv[sampleArg + 1]) : 200;

  const files = collect(root);
  const index = new SymbolIndex();
  for (const f of files) {
    index.add(f.isJava ? parseJava(f.uri, f.text) : parse(f.uri, f.text));
  }
  index.finalize();

  const javaCount = files.filter(f => f.isJava).length;
  console.log(`sources        : ${files.length} (${javaCount} Java, ${files.length - javaCount} Kotlin)`);

  // Candidate targets: top-level class-likes with a package, sorted by how
  // widely they are imported, then stratified.
  const targets = index.allEntries().filter(e =>
    e.depth === 0 && e.packageName && !e.isPrivate
    && ['class', 'interface', 'object', 'enum', 'dataClass', 'sealedClass'].includes(e.kind));

  const scored = targets.map(t => {
    const fqn = `${t.packageName}.${t.name}`;
    let imports = 0;
    for (const f of files) if (f.text.includes(`import ${fqn}`)) imports++;
    return { entry: t, fqn, imports };
  }).filter(x => x.imports > 0).sort((a, b) => b.imports - a.imports);

  const top = scored.slice(0, Math.floor(sampleSize * 0.25));
  const mid = scored.slice(Math.floor(scored.length / 2), Math.floor(scored.length / 2) + Math.floor(sampleSize * 0.5));
  const rare = scored.slice(-Math.floor(sampleSize * 0.25));
  const sample = [...top, ...mid, ...rare];

  let javaTruth = 0, javaFound = 0, ktTruth = 0, ktFound = 0;
  let maxCandidates = 0, missingExamples: string[] = [];

  for (const s of sample) {
    const truth = truthSet(files, s.fqn, s.entry.packageName, s.entry.uri.toString());
    const candidates = index.getFilesContainingWord(s.entry.name, s.entry);
    if (candidates === null) continue;
    maxCandidates = Math.max(maxCandidates, candidates.size);

    for (const uri of truth) {
      const isJava = uri.endsWith('.java');
      if (isJava) javaTruth++; else ktTruth++;
      if (candidates.has(uri)) {
        if (isJava) javaFound++; else ktFound++;
      } else if (missingExamples.length < 5) {
        missingExamples.push(`${s.entry.name} -> ${path.relative(root, uri.replace('file://', ''))}`);
      }
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
  console.log(`échantillon    : ${sample.length} symboles`);
  console.log(`rappel Java    : ${pct(javaFound, javaTruth)}  (${javaFound}/${javaTruth})`);
  console.log(`rappel Kotlin  : ${pct(ktFound, ktTruth)}  (${ktFound}/${ktTruth})`);
  console.log(`candidats max  : ${maxCandidates} fichiers pour un symbole`);
  console.log(`index de mots  : ${index.stats().symbols} symboles, ${files.length} fichiers`);
  if (missingExamples.length > 0) {
    console.log('\nmanquants (échantillon) :');
    for (const m of missingExamples) console.log('   ', m);
  }
}

main();
