import * as vscode from 'vscode';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';

// `contentDescription = null` anywhere is the decorative-image declaration.
// It is valid Compose, but it also means TalkBack skips the element, so it
// deserves a nudge to confirm the image really is decorative.
const NULL_DESCRIPTION_RE = /\bcontentDescription\s*=\s*null\b/g;

// `.clickable { ... }` / `.clickable(...)` with no role and no custom
// semantics: TalkBack announces a bare "double tap to activate" with no
// role. Passing `role = Role.Button` (or wrapping in `semantics {}`) fixes
// the announcement. Line-local check: if `role` or `semantics` appears on
// the same line we stay quiet — a missed multi-line role is a false
// negative, which beats a false positive on correct code.
const CLICKABLE_RE = /\.clickable\s*[({]/g;
const HAS_ROLE_RE = /\brole\s*=|\bRole\s*\.|\.semantics\b|\bonClickLabel\s*=/;

const DESCRIPTION_TOOLTIP = new vscode.MarkdownString(
  'TalkBack skips this element. Intentional for decorative images; if the '
  + 'image carries meaning, describe it: `contentDescription = stringResource(...)`.',
);
const ROLE_TOOLTIP = new vscode.MarkdownString(
  'TalkBack announces this as a bare tappable element with no role. '
  + 'Pass `role = Role.Button` to `clickable`, or set `onClickLabel`, '
  + 'or wrap the semantics: `Modifier.semantics { role = Role.Button }`.',
);

/**
 * Inline accessibility nudges for common Compose patterns, without running
 * a linter:
 *
 *   Image(painter = p, contentDescription = null)   ⚠ a11y: decorative?
 *   Modifier.clickable { }                          ⚠ a11y: role?
 *
 * Both are HINTS, not errors: `null` descriptions and role-less clickables
 * are sometimes correct, so the label asks a question instead of asserting
 * a violation. Toggle with `kotlinJump.composeAccessibilityHints`.
 */
export class ComposeA11yProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onChange.event;

  fireChange(): void { this._onChange.fire(); }
  dispose(): void { this._onChange.dispose(); }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('composeAccessibilityHints', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const hints: vscode.InlayHint[] = [];
    let inRaw = false;

    // Raw-string state must be tracked from the top of the file, not from
    // range.start — a """ block opened above the viewport would otherwise
    // desynchronize the oracle.
    for (let ln = 0; ln <= range.end.line && ln < document.lineCount; ln++) {
      const text = document.lineAt(ln).text;
      const wasInRaw = inRaw;
      if (countTripleQuotes(text) % 2 !== 0) inRaw = !inRaw;
      if (wasInRaw || ln < range.start.line) continue;
      if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue;

      NULL_DESCRIPTION_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NULL_DESCRIPTION_RE.exec(text)) !== null) {
        if (isInsideCommentOrString(text, m.index)) continue;
        hints.push(makeHint(ln, m.index + m[0].length, '⚠ a11y: decorative?', DESCRIPTION_TOOLTIP));
      }

      if (HAS_ROLE_RE.test(text)) continue;
      CLICKABLE_RE.lastIndex = 0;
      while ((m = CLICKABLE_RE.exec(text)) !== null) {
        if (isInsideCommentOrString(text, m.index)) continue;
        hints.push(makeHint(ln, m.index + '.clickable'.length, '⚠ a11y: role?', ROLE_TOOLTIP));
      }
    }
    return hints;
  }
}

function makeHint(
  line: number,
  col: number,
  label: string,
  tooltip: vscode.MarkdownString,
): vscode.InlayHint {
  const hint = new vscode.InlayHint(
    new vscode.Position(line, col),
    label,
    vscode.InlayHintKind.Parameter,
  );
  hint.paddingLeft = true;
  hint.tooltip = tooltip;
  return hint;
}
