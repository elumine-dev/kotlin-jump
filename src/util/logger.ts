import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  info(msg: string): void { this.channel.appendLine(`[INFO]  ${msg}`); }
  warn(msg: string): void { this.channel.appendLine(`[WARN]  ${msg}`); }
  error(msg: string, err?: unknown): void {
    this.channel.appendLine(`[ERROR] ${msg}${err ? ` — ${err}` : ''}`);
  }

  dispose(): void { this.channel.dispose(); }
}
