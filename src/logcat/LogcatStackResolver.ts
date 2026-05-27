import * as vscode from 'vscode';
import type { SymbolIndex } from '../indexer/SymbolIndex';
import type { LogEntry, ResolvedFrame } from './messages';
import { STACK_FRAME_REGEX } from './LogcatLineParser';

const FRAME_REGEX_GLOBAL = new RegExp(STACK_FRAME_REGEX.source, 'gm');
// Heuristic for R8-obfuscated FQNs: 3+ consecutive single-character segments
// (e.g. `a.b.c.Cz`). Real packages like `io.x.Y` have at most 2 short segments
// in a row and must NOT trip this — they're legitimate (e.g. `io.kotest.x`).
const OBFUSCATED_HINT = /(^|\.)[a-zA-Z](\.[a-zA-Z]){2,}(\.|$)/;

/**
 * Detects stack frames in a `LogEntry.message` and tries to resolve each FQN
 * via the existing Kotlin Jump symbol index. Mutates the entry in place.
 *
 * On obfuscated builds (R8/ProGuard), the FQNs are short (`a.b.c.Cz`) and
 * `lookupFqn` will miss. We mark those frames with `obfuscated: true` so the
 * webview can show a "Release build detected" banner.
 */
export class LogcatStackResolver {
  constructor(private readonly index: SymbolIndex) {}

  resolve(entry: LogEntry): void {
    if (!entry.message.includes('\tat ') && !entry.message.includes(' at ') && !entry.message.includes('\n  at ')) {
      // Quick reject — most messages are not stacks. STACK_FRAME_REGEX requires `at`.
      if (!STACK_FRAME_REGEX.test(entry.message)) return;
    }

    const frames: ResolvedFrame[] = [];
    let m: RegExpExecArray | null;
    FRAME_REGEX_GLOBAL.lastIndex = 0;
    while ((m = FRAME_REGEX_GLOBAL.exec(entry.message)) !== null) {
      if (!m.groups) continue;
      const fqn    = m.groups['fqn']!;
      const method = m.groups['method']!;
      const file   = m.groups['file']!;
      const line   = parseInt(m.groups['line']!, 10);

      // Skip the leading whitespace inside the matched span so the rendered
      // <a class="frame"> link does not wrap tabs/spaces.
      const fullMatch = m[0];
      const atOffset  = fullMatch.search(/at\s/);
      const startCol  = m.index + (atOffset >= 0 ? atOffset : 0);
      const endCol    = m.index + fullMatch.length;

      const resolved = this.lookupBestMatch(fqn);
      const obfuscated = !resolved && OBFUSCATED_HINT.test(fqn);

      const frame: ResolvedFrame = {
        startCol, endCol, fqn, method, file, line,
        ...(resolved ? { uri: resolved.toString() } : {}),
        ...(obfuscated ? { obfuscated: true } : {}),
      };
      frames.push(frame);
    }

    if (frames.length > 0) {
      entry.frames = frames;
      entry.isStackFrame = true;
    }
  }

  /**
   * Tries the FQN as-is, then strips inner-class suffixes (`Outer$Inner` → `Outer`),
   * then strips the trailing class component to attempt the file-level Kotlin name
   * (`com.app.MainActivityKt` → `com.app.MainActivity`).
   */
  private lookupBestMatch(fqn: string): vscode.Uri | undefined {
    const direct = this.index.lookupFqn(fqn);
    if (direct) return direct.uri;

    const innerStripped = fqn.replace(/\$.+$/, '');
    if (innerStripped !== fqn) {
      const hit = this.index.lookupFqn(innerStripped);
      if (hit) return hit.uri;
    }

    // Synthetic Kotlin file-class: foo.Bar.bazFn lives in foo.BarKt.kt
    if (fqn.endsWith('Kt')) {
      const hit = this.index.lookupFqn(fqn.slice(0, -2));
      if (hit) return hit.uri;
    }
    return undefined;
  }
}

/**
 * True when the entry's frames look majority-obfuscated. Drives the
 * "Release build detected" banner.
 */
export function looksObfuscated(entry: LogEntry): boolean {
  const frames = entry.frames;
  if (!frames || frames.length === 0) return false;
  const obfCount = frames.filter(f => f.obfuscated).length;
  return obfCount >= Math.ceil(frames.length / 2);
}
