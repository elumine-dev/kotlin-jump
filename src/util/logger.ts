import * as vscode from 'vscode';

export class NullLogger {
  debug(_: string): void {}
  info(_: string): void {}
  warn(_: string): void {}
}

export class Logger implements vscode.Disposable {
  readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  private ts(): string {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`;
  }

  debug(msg: string): void { this.channel.appendLine(`[${this.ts()}][DEBUG] ${msg}`); }
  info(msg: string): void  { this.channel.appendLine(`[${this.ts()}][INFO]  ${msg}`); }
  warn(msg: string): void  { this.channel.appendLine(`[${this.ts()}][WARN]  ${msg}`); }
  error(msg: string, err?: unknown): void {
    this.channel.appendLine(`[${this.ts()}][ERROR] ${msg}${err ? ` — ${err}` : ''}`);
  }

  dispose(): void { this.channel.dispose(); }
}
