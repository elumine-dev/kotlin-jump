/**
 * Interactive REPL for adding timeline events after a manual recording.
 *
 * Grammar:   <t_seconds> <type> "<label>" ["<sublabel>"] [dur=<ms>]
 * Anchor:    use <n> <type> "<label>" ["<sublabel>"] [dur=<ms>] [offset=<ms>]
 *              → anchors to detectedEvents[n-1], default offset 500ms before it
 *
 * Examples:
 *   2.3 caption "Click the Run button"
 *   4.1 click "▶ Run" "Cmd+click on status bar"
 *   5.2 keystroke "Cmd+Shift+P" "Command Palette" dur=1800
 *   use 3 caption "Click the Run button"
 *
 * Commands:
 *   list        → show current events
 *   detected    → re-print the events captured during recording
 *   drop <n>    → remove the n-th event (1-indexed, matches the list order)
 *   .           → finish (blank line also works)
 *
 * Lists are kept sorted by `t` after every mutation.
 */

import * as readline from 'node:readline';

import type { TimelineEvent }   from './timeline';
import type { DetectedEvent }   from './event-recorder';

const EVENT_RE = /^(\d+(?:\.\d+)?)\s+(caption|click|keystroke)\s+"([^"]+)"(?:\s+"([^"]+)")?(?:\s+dur=(\d+))?$/;
const USE_RE   = /^use\s+(\d+)\s+(caption|click|keystroke)\s+"([^"]+)"(?:\s+"([^"]+)")?(?:\s+dur=(\d+))?(?:\s+offset=(-?\d+))?$/;
const DEFAULT_DURATION_MS         = 2500;
const MIN_DURATION_MS             = 100;
const MAX_DURATION_MS             = 10_000;
const DEFAULT_OFFSET_MS_BEFORE    = 500;

export async function promptTimelineEvents(
  rawDurationSec: number,
  log: (msg: string) => void,
  detectedEvents: readonly DetectedEvent[] = [],
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  log(``);
  log(`Add timeline events. Format: <t_seconds> <type> "<label>" ["<sublabel>"] [dur=<ms>]`);
  log(`  Types: caption | click | keystroke`);
  log(`  Example: 2.3 caption "Click the Run button"`);
  log(`  Example: 4.1 click "▶ Run" "Cmd+click on status bar"`);
  log(`  Example: 5.2 keystroke "Cmd+Shift+P" "Command Palette" dur=1800`);
  log(`  Commands: list | drop <n> | detected | use <n> ... | . (or blank line = finish)`);
  log(`  use <n> <type> "<label>" ["<sublabel>"] [dur=<ms>] [offset=<ms>]`);
  log(`     anchors to detected event #n; offset defaults to ${DEFAULT_OFFSET_MS_BEFORE}ms before it`);
  log(``);

  if (detectedEvents.length > 0) {
    log(`Detected during recording (${detectedEvents.length} event${detectedEvents.length === 1 ? '' : 's'}):`);
    printDetected(detectedEvents);
    log(``);
  }

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

      if (line === 'detected') {
        if (detectedEvents.length === 0) {
          process.stdout.write(`  (no events were detected during recording)\n`);
        } else {
          printDetected(detectedEvents);
        }
        rl.prompt();
        return;
      }

      const useMatch = line.match(USE_RE);
      if (useMatch) {
        const [, nStr, type, label, sublabel, durStr, offsetStr] = useMatch;
        const idx = parseInt(nStr, 10) - 1;
        if (idx < 0 || idx >= detectedEvents.length) {
          process.stdout.write(`  ✗ use: index ${idx + 1} out of range (have ${detectedEvents.length} detected events).\n`);
          rl.prompt();
          return;
        }
        const det      = detectedEvents[idx];
        const offset   = offsetStr ? parseInt(offsetStr, 10) : DEFAULT_OFFSET_MS_BEFORE;
        const tMs      = Math.max(0, det.t - offset);
        const duration = durStr ? parseInt(durStr, 10) : DEFAULT_DURATION_MS;
        if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
          process.stdout.write(
            `  ✗ duration=${duration}ms out of sane range [${MIN_DURATION_MS}, ${MAX_DURATION_MS}]\n`,
          );
          rl.prompt();
          return;
        }
        const event: TimelineEvent = {
          t:        tMs,
          type:     type as TimelineEvent['type'],
          label,
          duration,
          ...(sublabel ? { sublabel } : {}),
        };
        events.push(event);
        events.sort((a, b) => a.t - b.t);
        process.stdout.write(
          `  ✓ ${type} @ ${(tMs / 1000).toFixed(2)}s (anchored to detected #${idx + 1}, offset -${offset}ms)\n`,
        );
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
          `    Types: caption | click | keystroke.\n` +
          `    Commands: list, detected, use <n> ..., drop <n>, . (finish)\n`,
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

// Sanitise an AX label for terminal display: collapse newlines, trim, cap
// at 50 chars. AX values from editor content can be the entire first line
// of a file (with embedded newlines) — without this they wrap and ruin
// the REPL output.
function cleanLabel(raw: string): string {
  const collapsed = raw
    .replace(/\r?\n/g, ' ↵ ')   // visible newline marker
    .replace(/\s+/g, ' ')       // collapse runs of whitespace
    .trim();
  return collapsed.length > 50 ? collapsed.slice(0, 47) + '…' : collapsed;
}

function describeClickTarget(e: Extract<DetectedEvent, { type: 'click' }>): string {
  const role       = e.element?.subrole ?? e.element?.role;
  const roleSuffix = role ? ` [${role}]` : '';

  // Priority order:
  // 1. text.word          → user clicked on a code identifier in the editor
  // 2. text.selected      → user has a drag-selected range
  // 3. element.title/value → output of multi-strategy orchestrator
  //                         (hit_test > descent_window > focused)
  // 4. role + coords      → fallback: at least we know what kind of widget
  // 5. raw coords         → last resort
  if (e.text?.word)     return `"${cleanLabel(e.text.word)}"${roleSuffix}`;
  if (e.text?.selected) return `selected "${cleanLabel(e.text.selected)}"${roleSuffix}`;

  const elementLabel = e.element?.title ?? e.element?.value ?? e.element?.id;
  if (elementLabel) return `"${cleanLabel(elementLabel)}"${roleSuffix}`;

  if (role) return `[${role}] @ ${e.x},${e.y}`;
  return `(${e.button} @ ${e.x},${e.y})`;
}

function printDetected(events: readonly DetectedEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const t = (e.t / 1000).toFixed(2);
    if (e.type === 'click') {
      process.stdout.write(`  ${i + 1}. t=${t}s  click      ${describeClickTarget(e)}\n`);
    } else {
      process.stdout.write(`  ${i + 1}. t=${t}s  keystroke  "${e.key}"\n`);
    }
  }
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
