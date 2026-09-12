/* eslint-disable no-console */
/**
 * Compares two perf-bench JSON outputs and prints a diff table.
 * Usage:
 *   node dist/perf/perf-diff.js <baseline-label> <after-label>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

interface ScenarioResult {
  name: string;
  runs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

interface BenchOutput {
  label: string;
  timestamp: string;
  fixture: { files: number; symbols: number };
  scenarios: ScenarioResult[];
}

function load(label: string): BenchOutput {
  const p = path.resolve(__dirname, '../../media/perf', `${label}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function color(v: number): string {
  // Negative = improvement (faster), positive = regression.
  if (v < -5)  return `\x1b[32m${v.toFixed(1)}%\x1b[0m`;  // green
  if (v > 5)   return `\x1b[31m${v.toFixed(1)}%\x1b[0m`;  // red
  return       `\x1b[90m${v.toFixed(1)}%\x1b[0m`;          // gray (noise)
}

/**
 * Below this absolute difference, the two numbers say nothing about the code.
 *
 * `resolveTarget.*` runs in 0.4 to 1 microsecond, which is the cost of the
 * measuring loop itself. Comparing two of those printed a bright green
 * `-100.0%` between the two committed baselines, a improvement of six tenths
 * of a microsecond announced as a doubling of speed. A percentage is only
 * worth reading once the difference is bigger than the floor of what the
 * bench can see, and a reader who has learned to skip a false alarm skips the
 * real one next to it.
 */
const PLANCHER_MS = 0.002;

export function ecart(base: number, apres: number): string {
  if (Math.abs(apres - base) < PLANCHER_MS) return '\x1b[90msous le seuil\x1b[0m';
  if (base === 0) return '\x1b[90mbase a zero\x1b[0m';
  return color(((apres - base) / base) * 100);
}

function main() {
  const [a, b] = [process.argv[2], process.argv[3]];
  if (!a || !b) { console.error('usage: perf-diff <baseline> <after>'); process.exit(1); }
  const base = load(a);
  const after = load(b);

  const baseByName = new Map(base.scenarios.map(s => [s.name, s]));

  console.log(`\n[perf-diff] baseline=${a}  after=${b}`);
  console.log(`[perf-diff] fixture: ${base.fixture.files} files, ${base.fixture.symbols} symbols\n`);
  console.log(pad('scenario', 36), pad('p50 base', 10), pad('p50 after', 10), pad('Δ p50', 10), pad('p95 base', 10), pad('p95 after', 10), pad('Δ p95', 10));
  console.log('-'.repeat(110));
  for (const s of after.scenarios) {
    const ref = baseByName.get(s.name);
    if (!ref) {
      console.log(pad(s.name, 36), pad('(new)', 10), pad(s.p50Ms.toFixed(3), 10));
      continue;
    }
    console.log(
      pad(s.name, 36),
      pad(ref.p50Ms.toFixed(3), 10),
      pad(s.p50Ms.toFixed(3),  10),
      pad(ecart(ref.p50Ms, s.p50Ms), 24),
      pad(ref.p95Ms.toFixed(3), 10),
      pad(s.p95Ms.toFixed(3),  10),
      ecart(ref.p95Ms, s.p95Ms),
    );
  }
  console.log();
}

// Importable par la suite : seul l appel en ligne de commande compare.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
