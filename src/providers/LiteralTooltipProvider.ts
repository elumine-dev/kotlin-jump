import * as vscode from 'vscode';
import { isInsideComment, countTripleQuotes } from '../util/textUtils';

// One cron field: *, */6, 5, 1-5, 1,3,5, 1-5/2 and combinations.
const CRON_FIELD_RE = /^(\*|\d+)(\/\d+)?([-,]\d+(\/\d+)?)*$/;
// ISO-8601 duration: P[nY][nM][nW][nD][T[nH][nM][nS]], at least one component.
const ISO_DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
// Double-quoted string literals with escapes.
const STRING_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Translates a 5-field cron expression into a short phrase, or null when
 * the expression is not cron or uses a shape we cannot phrase cleanly.
 * A wrong translation is worse than none, so unphrasable shapes bail out.
 *
 * Purely numeric 5-field strings ("1 2 3 4 5") are rejected on purpose:
 * without a * or / anywhere, data tuples are indistinguishable from cron.
 */
export function describeCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  if (!/[*/]/.test(expr)) return null;
  if (!fields.every(f => CRON_FIELD_RE.test(f))) return null;

  const [min, hour, dom, mon, dow] = fields;
  if (mon !== '*') return null;   // month-constrained crons: too many shapes

  const time = (): string | null => {
    if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
    const h = Number(hour), m = Number(min);
    if (h > 23 || m > 59) return null;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  // every minute / every N minutes
  if (hour === '*' && dom === '*' && dow === '*') {
    if (min === '*') return 'every minute';
    const step = /^\*\/(\d+)$/.exec(min);
    if (step) return `every ${step[1]} minutes`;
    if (/^\d+$/.test(min) && Number(min) <= 59) return `every hour at :${min.padStart(2, '0')}`;
    return null;
  }

  // every N hours (optionally at a fixed minute)
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (hourStep && dom === '*' && dow === '*' && /^\d+$/.test(min)) {
    const at = min === '0' ? '' : ` at :${min.padStart(2, '0')}`;
    return `every ${hourStep[1]} hours${at}`;
  }

  // daily / weekly / monthly at a fixed time
  const t = time();
  if (t === null) return null;

  if (dom === '*' && dow === '*') return `daily at ${t}`;
  if (dom === '*' && dow !== '*') {
    const days = describeDays(dow);
    return days ? `${days} at ${t}` : null;
  }
  if (dow === '*' && /^\d+$/.test(dom)) {
    const d = Number(dom);
    if (d < 1 || d > 31) return null;
    return `monthly on day ${d} at ${t}`;
  }
  return null;
}

function describeDays(dow: string): string | null {
  const name = (n: number): string | null => (n <= 7 ? DAY_NAMES[n % 7] : null);
  const range = /^(\d+)-(\d+)$/.exec(dow);
  if (range) {
    const a = name(Number(range[1])), b = name(Number(range[2]));
    return a && b ? `${a} to ${b}` : null;
  }
  if (/^\d+(,\d+)*$/.test(dow)) {
    const names = dow.split(',').map(d => name(Number(d)));
    return names.every(Boolean) ? names.join(', ') : null;
  }
  return null;
}

/** "PT1H30M" → "1 hr 30 min". Null when not an ISO-8601 duration. */
export function describeIsoDuration(s: string): string | null {
  const m = ISO_DURATION_RE.exec(s);
  if (!m) return null;
  const [, y, mo, w, d, h, min, sec] = m;
  const parts: string[] = [];
  if (y)   parts.push(`${y} yr`);
  if (mo)  parts.push(`${mo} mo`);
  if (w)   parts.push(`${w} wk`);
  if (d)   parts.push(`${d} ${d === '1' ? 'day' : 'days'}`);
  if (h)   parts.push(`${h} hr`);
  if (min) parts.push(`${min} min`);
  if (sec) parts.push(`${sec} sec`);
  return parts.length > 0 ? parts.join(' ') : null;
}

export interface LiteralHint { column: number; label: string }

/** Scans one line's string literals for cron / ISO duration content. */
export function findLiteralHints(text: string): LiteralHint[] {
  const out: LiteralHint[] = [];
  STRING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRING_RE.exec(text)) !== null) {
    if (isInsideComment(text, m.index)) continue;
    const translated = describeCron(m[1]) ?? describeIsoDuration(m[1]);
    if (translated) out.push({ column: m.index + m[0].length, label: `↳ ${translated}` });
  }
  return out;
}

/**
 * Inline translation of schedule-shaped string literals:
 *
 *   val schedule = "0 *\/6 * * *"   ↳ every 6 hours
 *   val timeout  = "PT1H30M"        ↳ 1 hr 30 min
 *
 * Toggle with `kotlinJump.literalTooltips`.
 */
export class LiteralTooltipProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onChange.event;

  fireChange(): void { this._onChange.fire(); }
  dispose(): void { this._onChange.dispose(); }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('literalTooltips', true)) return [];
    const lang = document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') return [];

    const hints: vscode.InlayHint[] = [];
    let inRaw = false;
    for (let ln = 0; ln <= range.end.line && ln < document.lineCount; ln++) {
      const text = document.lineAt(ln).text;
      const wasInRaw = inRaw;
      if (countTripleQuotes(text) % 2 !== 0) inRaw = !inRaw;
      if (wasInRaw || ln < range.start.line) continue;

      for (const hit of findLiteralHints(text)) {
        const h = new vscode.InlayHint(
          new vscode.Position(ln, hit.column),
          hit.label,
          vscode.InlayHintKind.Parameter,
        );
        h.paddingLeft = true;
        hints.push(h);
      }
    }
    return hints;
  }
}
