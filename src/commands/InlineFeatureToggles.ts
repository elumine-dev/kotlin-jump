import * as vscode from 'vscode';

// ── Inline feature toggles — buttons in editor/title + master toggle ──────────
// Each Kotlin Jump inline feature (string folding, color folding, const val
// folding, hex color swatch, null assertion highlight) gets enable/disable/
// toggle commands wired to a setting. Context keys are published so the
// editor/title menu can swap the icon (enable vs disable) based on state.
// The master command flips all inline features off (or all on if all are
// currently off) — a one-click panic button.
//
// Shared between extension.ts and extension.browser.ts: every command here is
// contributed in package.json menus, so the web build must register them too
// or the toolbar buttons error out on vscode.dev.

interface InlineFeature { setting: string; ctxKey: string; }

const FEATURES: InlineFeature[] = [
  { setting: 'stringResourceFolding',  ctxKey: 'stringFoldingEnabled' },
  { setting: 'colorResourceFolding',   ctxKey: 'colorFoldingEnabled' },
  { setting: 'constValFolding',        ctxKey: 'constValFoldingEnabled' },
  { setting: 'hexColorSwatch',         ctxKey: 'hexColorSwatchEnabled' },
  { setting: 'nullAssertionHighlight', ctxKey: 'nullAssertionHighlightEnabled' },
];

// stringResourceFolding's enable/disable/toggle are already registered in
// the dedicated string-folding IIFE of each entry point — don't double-register.
const FIXED: Array<[string, string, boolean]> = [
  ['enableColorFolding',            'colorResourceFolding',   true],
  ['disableColorFolding',           'colorResourceFolding',   false],
  ['enableConstValFolding',         'constValFolding',        true],
  ['disableConstValFolding',        'constValFolding',        false],
  ['enableHexColorSwatch',          'hexColorSwatch',         true],
  ['disableHexColorSwatch',         'hexColorSwatch',         false],
  ['enableNullAssertionHighlight',  'nullAssertionHighlight', true],
  ['disableNullAssertionHighlight', 'nullAssertionHighlight', false],
];

const TOGGLES: Array<[string, string]> = [
  ['toggleColorFolding',           'colorResourceFolding'],
  ['toggleConstValFolding',        'constValFolding'],
  ['toggleHexColorSwatch',         'hexColorSwatch'],
  ['toggleNullAssertionHighlight', 'nullAssertionHighlight'],
];

export function registerInlineFeatureToggles(context: vscode.ExtensionContext): void {
  const syncContexts = (): void => {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    for (const f of FEATURES) {
      void vscode.commands.executeCommand(
        'setContext',
        `kotlinJump.${f.ctxKey}`,
        cfg.get<boolean>(f.setting, true),
      );
    }
  };
  syncContexts();

  const setOne = (setting: string, value: boolean): Thenable<void> =>
    vscode.workspace.getConfiguration('kotlinJump')
      .update(setting, value, vscode.ConfigurationTarget.Global);

  const subs: vscode.Disposable[] = [];
  for (const [cmd, setting, val] of FIXED) {
    subs.push(vscode.commands.registerCommand(`kotlinJump.${cmd}`, () => setOne(setting, val)));
  }
  for (const [cmd, setting] of TOGGLES) {
    subs.push(vscode.commands.registerCommand(`kotlinJump.${cmd}`, () => {
      const current = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(setting, true);
      return setOne(setting, !current);
    }));
  }
  // Master: if ANY feature is on, turn ALL off. Otherwise, turn ALL on.
  // Asymmetric semantics make this a reliable "shut everything off" button
  // while keeping a one-click restore from a clean-slate state.
  subs.push(vscode.commands.registerCommand('kotlinJump.toggleAllInlineFeatures', async () => {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const anyOn = FEATURES.some(f => cfg.get<boolean>(f.setting, true));
    const target = !anyOn;
    for (const f of FEATURES) {
      await cfg.update(f.setting, target, vscode.ConfigurationTarget.Global);
    }
  }));
  subs.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (FEATURES.some(f => e.affectsConfiguration(`kotlinJump.${f.setting}`))) {
      syncContexts();
    }
  }));
  context.subscriptions.push(...subs);
}
