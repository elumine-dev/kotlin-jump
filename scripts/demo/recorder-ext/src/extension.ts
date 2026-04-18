import * as vscode from 'vscode';
import * as fs     from 'node:fs';
import * as path   from 'node:path';
import { spawn }   from 'node:child_process';

/**
 * Dev-only recorder extension. Adds a "▶ Record demo — <name>.webp" CodeLens
 * above each `export default async function record(...)` in a `*.demo.ts` file.
 * Click → spawns the recording pipeline in a VS Code terminal.
 *
 * Guards:
 *  - Requires a `.kotlin-jump-dev-mode` marker at the workspace root.
 *    Without it, activate() no-ops. This keeps the extension inert if the
 *    code somehow ends up loaded outside the kotlin-jump dev repo.
 *  - Its `package.json` has `"private": true` and a distinct `publisher`
 *    so it cannot be published to the Marketplace.
 *  - Its source lives under `scripts/demo/` which is excluded from the VSIX
 *    via `.vscodeignore`.
 */
export function activate(context: vscode.ExtensionContext): void {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws || !fs.existsSync(path.join(ws, '.kotlin-jump-dev-mode'))) {
    // eslint-disable-next-line no-console
    console.error('[kotlin-jump-demo-recorder] refused to activate: no .kotlin-jump-dev-mode marker at workspace root');
    return;
  }

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/scripts/demo/demos/*.demo.ts' },
      new DemoRecordCodeLensProvider(),
    ),
    vscode.commands.registerCommand('kotlinJumpDemo.record', async (demoFsPath: string) => {
      if (!demoFsPath) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
        demoFsPath = editor.document.uri.fsPath;
      }
      if (!demoFsPath.endsWith('.demo.ts')) {
        vscode.window.showErrorMessage(`Not a demo file: ${path.basename(demoFsPath)}`);
        return;
      }
      runRecordPipeline(ws, demoFsPath);
    }),
  );
}

export function deactivate(): void { /* nothing to clean up */ }

class DemoRecordCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const re = /^export\s+default\s+async\s+function\s+record\s*\(/gm;
    const text = doc.getText();
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const pos   = doc.positionAt(match.index);
      const range = new vscode.Range(pos, pos);
      const name  = path.basename(doc.uri.fsPath, '.demo.ts');
      lenses.push(new vscode.CodeLens(range, {
        title:     `▶ Record demo — ${name}.webp`,
        command:   'kotlinJumpDemo.record',
        arguments: [doc.uri.fsPath],
      }));
    }
    return lenses;
  }
}

/**
 * Spawns the record pipeline in a dedicated VS Code terminal so the user sees
 * live progress and can cancel via Ctrl+C.
 *
 * The pipeline itself is the regular `node dist/demo/record.js <demo>` CLI —
 * no special coupling with this extension.
 */
function runRecordPipeline(workspaceRoot: string, demoFsPath: string): void {
  const recordScript = path.join(workspaceRoot, 'dist', 'demo', 'record.js');
  if (!fs.existsSync(recordScript)) {
    vscode.window.showErrorMessage(
      `Record script not found: ${recordScript}. Run \`npm run compile\` first.`,
    );
    return;
  }
  const name     = path.basename(demoFsPath, '.demo.ts');
  const terminal = vscode.window.createTerminal({
    name: `Record: ${name}`,
    cwd:  workspaceRoot,
  });
  terminal.show(true);
  // Use a shell command so the user sees the exact invocation.
  terminal.sendText(`node ${shellQuote(recordScript)} ${shellQuote(demoFsPath)}`);

  // When the recording completes (quick check — the pipeline usually takes
  // 30–60 s), the resulting WebP will be at media/demos/<name>.webp. Open it
  // for preview once the file appears.
  const outputWebp = path.join(workspaceRoot, 'media', 'demos', `${name}.webp`);
  const beforeMtime = fs.existsSync(outputWebp) ? fs.statSync(outputWebp).mtimeMs : 0;
  const deadline = Date.now() + 120_000;   // give the pipeline up to 2 min
  const timer = setInterval(() => {
    if (Date.now() > deadline) { clearInterval(timer); return; }
    if (!fs.existsSync(outputWebp)) return;
    const mtime = fs.statSync(outputWebp).mtimeMs;
    if (mtime > beforeMtime) {
      clearInterval(timer);
      void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputWebp));
    }
  }, 500);
}

function shellQuote(s: string): string {
  // Conservative POSIX shell quoting — safe for paths with spaces.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
