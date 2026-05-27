import type { LogEntry, LogLevel } from './messages';

/**
 * Streaming parser for `adb logcat -v threadtime,year` output.
 *
 * The threadtime,year format is:
 *   2026-01-15 12:34:56.789  1234  5678 D MyTag: message body
 *
 * Lines that do not match the prefix regex are treated as **continuation lines**
 * (FATAL EXCEPTION traces, multi-line messages) and appended to the previous
 * entry.
 *
 * Designed for high throughput: a single non-backtracking regex per prefix line
 * and string concat per continuation. No allocations in the hot loop besides
 * the resulting `LogEntry`.
 */
export class LogcatLineParser {
  private current: LogEntry | null = null;

  /**
   * Feeds one line and returns the entry that just **completed**, if any.
   * The current entry stays open until either (a) a new prefix line arrives
   * or (b) {@link flush} is called.
   */
  feed(line: string, seq: () => number): LogEntry | null {
    if (line.length === 0) return null;

    const m = PREFIX_REGEX.exec(line);
    if (m && m.groups) {
      const completed = this.current;
      const time = m.groups['time']!;
      this.current = {
        seq:   seq(),
        ts:    parseTs(m.groups['date']!, time),
        tsDisplay: time,             // device wall-clock, untouched by host TZ
        pid:   parseInt(m.groups['pid']!, 10),
        tid:   parseInt(m.groups['tid']!, 10),
        level: (m.groups['level'] ?? 'I') as LogLevel,
        tag:   m.groups['tag']!.trim(),
        message: m.groups['msg'] ?? '',
      };
      return completed;
    }

    if (this.current) {
      this.current.message += '\n' + line;
      if (!this.current.isStackFrame && STACK_FRAME_REGEX.test(line)) {
        this.current.isStackFrame = true;
      }
    }
    return null;
  }

  /** Returns and clears the in-flight entry. Call when the stream ends. */
  flush(): LogEntry | null {
    const entry = this.current;
    this.current = null;
    return entry;
  }

  /** Resets parser state without emitting. */
  reset(): void { this.current = null; }
}

// Group names give us self-documenting parser code at zero runtime cost.
const PREFIX_REGEX =
  /^(?<date>\d{4}-\d{2}-\d{2}) (?<time>\d{2}:\d{2}:\d{2}\.\d{3})\s+(?<pid>\d+)\s+(?<tid>\d+)\s+(?<level>[VDIWEF])\s+(?<tag>[^:]+):\s?(?<msg>.*)$/;

/**
 * Detects Java/Kotlin/Compose/coroutines stack frames. Used to flag continuation
 * lines that contain frames so `is:stacktrace`-style filters can hit them later.
 */
export const STACK_FRAME_REGEX =
  /^\s*at\s+(?<fqn>[\w$.]+)\.(?<method>[\w$<>]+)\((?<file>[\w$]+\.(?:kt|java)):(?<line>\d+)\)/;

function parseTs(date: string, time: string): number {
  // date = "YYYY-MM-DD", time = "HH:MM:SS.mmm" — built-in Date parses ISO with T separator.
  const isoLike = `${date}T${time}`;
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) ? ms : Date.now();
}
