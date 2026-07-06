// Web-only placeholders for the Logcat views declared in package.json
// (kotlinJump.logcat webview, kotlinJump.logcat.devices tree). Deliberately
// imports NOTHING from src/logcat/* or src/android/*, since those pull in
// child_process/fs and must never reach the browser bundle.
//
// Do NOT gate these on the `isWeb` context: it's a UI signal, not an
// extension-host signal, and stays true inside a real GitHub Codespace
// opened in a browser tab, where Logcat actually works, because VS Code
// picks the Node `main` entry point over `browser` when a real backend is
// available. Gating on isWeb would hide a working feature there.
import * as vscode from 'vscode';

export class LogcatDevicesWebPlaceholderProvider implements vscode.TreeDataProvider<never> {
  getChildren(): never[] { return []; }
  getTreeItem(element: never): vscode.TreeItem { return element; }
}

/** No `viewsWelcome` equivalent exists for webview-type views, so this is
 *  hand-rolled static HTML instead. */
export class LogcatWebviewPlaceholderProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: false };
    view.webview.html = `<!DOCTYPE html>
<html>
<body style="font-family:var(--vscode-font-family);padding:12px;color:var(--vscode-descriptionForeground);">
  <p>Logcat isn't available in VS Code for the Web.</p>
  <p>Open this workspace in desktop VS Code, or in a GitHub Codespace, to stream device logs.</p>
</body>
</html>`;
  }
}
