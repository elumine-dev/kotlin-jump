import * as vscode from 'vscode';
import { isInsideCommentOrString } from '../util/textUtils';

// Map: API level integer → human-readable name
const API_NAMES: Record<number, string> = {
  21: 'Lollipop (5.0)',
  22: 'Lollipop MR1 (5.1)',
  23: 'Marshmallow (6.0)',
  24: 'Nougat (7.0)',
  25: 'Nougat MR1 (7.1)',
  26: 'Oreo (8.0)',
  27: 'Oreo MR1 (8.1)',
  28: 'Pie (9)',
  29: 'Q (10)',
  30: 'R (11)',
  31: 'S (12)',
  32: 'S_V2 (12L)',
  33: 'Tiramisu (13)',
  34: 'UpsideDownCake (14)',
  35: 'VanillaIceCream (15)',
};

// Map: Build.VERSION_CODES constant → API level
const VERSION_CODES: Record<string, number> = {
  LOLLIPOP:          21,
  LOLLIPOP_MR1:      22,
  M:                 23,
  N:                 24,
  N_MR1:             25,
  O:                 26,
  O_MR1:             27,
  P:                 28,
  Q:                 29,
  R:                 30,
  S:                 31,
  S_V2:              32,
  TIRAMISU:          33,
  UPSIDE_DOWN_CAKE:  34,
  VANILLA_ICE_CREAM: 35,
};

// @RequiresApi(N), @RequiresApi(value = N), or @RequiresApi(api = N)
const RE_REQUIRES_INT  = /@RequiresApi\s*\(\s*(?:(?:value|api)\s*=\s*)?(\d+)\s*\)/g;
// @RequiresApi(Build.VERSION_CODES.XXX) or @RequiresApi(XXX)
const RE_REQUIRES_CODE = /@RequiresApi\s*\(\s*(?:Build\.VERSION_CODES\.)?([A-Z][A-Z_0-9]*)\s*\)/g;
// SDK_INT >= N  or  SDK_INT > N  (integer literal)
const RE_SDK_INT       = /\bSDK_INT\s*(>=|>)\s*(\d+)/g;
// SDK_INT >= Build.VERSION_CODES.XXX  or  SDK_INT >= XXX  (VERSION_CODES constant)
const RE_SDK_INT_CODE  = /\bSDK_INT\s*(>=|>)\s*(?:Build\.VERSION_CODES\.)?([A-Z][A-Z_0-9]*)/g;

export class ApiLevelProvider implements vscode.InlayHintsProvider {
  private readonly _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  fireChange(): void {
    this._onDidChangeInlayHints.fire();
  }

  dispose(): void {
    this._onDidChangeInlayHints.dispose();
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return [];

    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('apiLevelInlayHints', true);
    if (!enabled) return [];

    const hints: vscode.InlayHint[] = [];

    for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
      const text = document.lineAt(lineNum).text;

      // @RequiresApi with integer literal
      RE_REQUIRES_INT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_REQUIRES_INT.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const level = parseInt(m[1], 10);
        const label = apiLabel(level);
        if (!label) continue;
        const pos = new vscode.Position(lineNum, m.index + m[0].length);
        hints.push(makeHint(pos, label));
      }

      // @RequiresApi with VERSION_CODES constant
      RE_REQUIRES_CODE.lastIndex = 0;
      while ((m = RE_REQUIRES_CODE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const code  = m[1];
        const level = VERSION_CODES[code];
        if (level === undefined) continue;
        const label = apiLabel(level);
        if (!label) continue;
        const pos = new vscode.Position(lineNum, m.index + m[0].length);
        hints.push(makeHint(pos, label));
      }

      // SDK_INT >= N  /  SDK_INT > N  (integer literal)
      RE_SDK_INT.lastIndex = 0;
      while ((m = RE_SDK_INT.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const op    = m[1];
        let   level = parseInt(m[2], 10);
        if (op === '>') level += 1;
        const label = apiLabel(level);
        if (!label) continue;
        const pos = new vscode.Position(lineNum, m.index + m[0].length);
        hints.push(makeHint(pos, label));
      }

      // SDK_INT >= Build.VERSION_CODES.XXX  /  SDK_INT > Build.VERSION_CODES.XXX
      RE_SDK_INT_CODE.lastIndex = 0;
      while ((m = RE_SDK_INT_CODE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const op   = m[1];
        const code = m[2];
        let level  = VERSION_CODES[code];
        if (level === undefined) continue;
        if (op === '>') level += 1;
        const label = apiLabel(level);
        if (!label) continue;
        const pos = new vscode.Position(lineNum, m.index + m[0].length);
        hints.push(makeHint(pos, label));
      }
    }

    return hints;
  }
}

function apiLabel(level: number): string | undefined {
  const name = API_NAMES[level];
  return name ? `Android ${name}` : undefined;
}

function makeHint(pos: vscode.Position, label: string): vscode.InlayHint {
  const hint = new vscode.InlayHint(
    pos,
    ` // ${label}`,
    vscode.InlayHintKind.Type,
  );
  hint.paddingLeft = false;
  return hint;
}
