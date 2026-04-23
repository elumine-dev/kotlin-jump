/**
 * Interactive REPL for adding timeline events after a manual recording.
 *
 * Grammar:   <t_seconds> <type> "<label>" ["<sublabel>"] [dur=<ms>]
 *
 * Examples:
 *   2.3 caption "Click the Run button"
 *   4.1 click "▶ Run" "Cmd+click on status bar"
 *   5.2 keystroke "Cmd+Shift+P" "Command Palette" dur=1800
 *
 * Commands:
 *   list        → show current events
 *   drop <n>    → remove the n-th event (1-indexed, matches the list order)
 *   .           → finish (blank line also works)
 *
 * The events list is kept sorted by `t` after every mutation, so `list` and
 * `drop <n>` use consistent indices regardless of the order of entry.
 */

import * as readline from 'node:readline';

import type { TimelineEvent } from './timeline';

const EVENT_RE = /^(\d+(?:\.\d+)?)\s+(caption|click|keystroke)\s+"([^"]+)"(?:\s+"([^"]+)")?(?:\s+dur=(\d+))?$/;
const DEFAULT_DURATION_MS = 2500;
const MIN_DURATION_MS     = 100;
const MAX_DURATION_MS     = 10_000;

export async function promptTimelineEvents(
  rawDurationSec: number,
  log: (msg: string) => void,
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  log(``);
  log(`Add timeline events. Format: <t_seconds> <type> "<label>" ["<sublabel>"] [dur=<ms>]`);
  log(`  Types: caption | click | keystroke`);
  log(`  Example: 2.3 caption "Click the Run button"`);
  log(`  Example: 4.1 click "▶ Run" "Cmd+click on status bar"`);
  log(`  Example: 5.2 keystroke "Cmd+Shift+P" "Command Palette" dur=1800`);
  log(`  Commands: list | drop <n> | . (or blank line = finish)`);
  log(``);

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: true,
    prompt:   '> ',
  });

  rl.prompt();

  return await new Promise<TimelineEvent[]>((resolve) => {
    rl.on('line', (raw) => {
      const line = raw.trim();

      if (line === '' || line === '.') {
        rl.close();
        return;
      }

      if (line === 'list') {
        printList(events);
        rl.prompt();
        return;
      }

      const dropMatch = line.match(/^drop\s+(\d+)$/);
      if (dropMatch) {
        const idx = parseInt(dropMatch[1], 10) - 1;
        if (idx < 0 || idx >= events.length) {
          process.stdout.write(`  ✗ drop: index ${idx + 1} out of range (have ${events.length} events).\n`);
        } else {
          const removed = events.splice(idx, 1)[0];
          process.stdout.write(`  ✓ dropped event #${idx + 1}: ${removed.type} "${removed.label}"\n`);
        }
        rl.prompt();
        return;
      }

      const m = line.match(EVENT_RE);
      if (!m) {
        process.stdout.write(
          `  ✗ invalid format. Expected: <t> <type> "<label>" ["<sublabel>"] [dur=<ms>]\n` +
          `    Types: caption | click | keystroke. Commands: list, drop <n>, . (finish)\n`,
        );
        rl.prompt();
        return;
      }
      const [, tStr, type, label, sublabel, durStr] = m;
      const t        = parseFloat(tStr);
      const duration = durStr ? parseInt(durStr, 10) : DEFAULT_DURATION_MS;

      if (t < 0 || t > rawDurationSec) {
        process.stdout.write(`  ✗ t=${t}s out of range [0, ${rawDurationSec.toFixed(1)}s]\n`);
        rl.prompt();
        return;
      }
      if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
        process.stdout.write(
          `  ✗ duration=${duration}ms out of sane range [${MIN_DURATION_MS}, ${MAX_DURATION_MS}]\n`,
        );
        rl.prompt();
        return;
      }

      const event: TimelineEvent = {
        t:        Math.round(t * 1000),
        type:     type as TimelineEvent['type'],
        label,
        duration,
        ...(sublabel ? { sublabel } : {}),
      };
      events.push(event);
      events.sort((a, b) => a.t - b.t);
      process.stdout.write(
        `  ✓ ${type} @ ${t.toFixed(2)}s (duration ${duration}ms)${sublabel ? ` "${sublabel}"` : ''}\n`,
      );
      rl.prompt();
    });

    rl.on('close', () => resolve(events));
  });
}

function printList(events: readonly TimelineEvent[]): void {
  if (events.length === 0) {
    process.stdout.write(`  (no events yet)\n`);
    return;
  }
  for (let i = 0; i < events.length; i++) {
    const e   = events[i];
    const sub = e.sublabel ? ` "${e.sublabel}"` : '';
    process.stdout.write(
      `  ${i + 1}. t=${(e.t / 1000).toFixed(2)}s ${e.type} "${e.label}"${sub} dur=${e.duration}ms\n`,
    );
  }
}
