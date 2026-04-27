/* eslint-disable no-console */
/**
 * Compares two perf-bench JSON outputs and prints a diff table.
 * Usage:
 *   node dist/perf/perf-diff.js <baseline-label> <after-label>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

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
    const dP50 = ref.p50Ms === 0 ? 0 : ((s.p50Ms - ref.p50Ms) / ref.p50Ms) * 100;
    const dP95 = ref.p95Ms === 0 ? 0 : ((s.p95Ms - ref.p95Ms) / ref.p95Ms) * 100;
    console.log(
      pad(s.name, 36),
      pad(ref.p50Ms.toFixed(3), 10),
      pad(s.p50Ms.toFixed(3),  10),
      pad(color(dP50), 19),
      pad(ref.p95Ms.toFixed(3), 10),
      pad(s.p95Ms.toFixed(3),  10),
      color(dP95),
    );
  }
  console.log();
}

main();
