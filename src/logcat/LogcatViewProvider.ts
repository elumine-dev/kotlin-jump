import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { LogcatService } from './LogcatService';
import type { LogEntry, ViewToHost } from './messages';
import { LOGCAT_API_VERSION, makeHostMsg } from './messages';
import { looksObfuscated } from './LogcatStackResolver';

export class LogcatViewProvider implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'kotlinJump.logcat';

  private view?: vscode.WebviewView;
  private htmlCache?: string;
  private warnedReleaseBuild = false;

  /** True when the panel is currently rendered AND visible to the user. */
  get visible(): boolean { return this.view?.visible === true; }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: LogcatService,
  ) {
    service.on('append',  (rows: LogEntry[]) => this.post(makeHostMsg({ type: 'append', rows })));
    service.on('reset',   () => this.post(makeHostMsg({ type: 'reset' })));
    service.on('devices', devices => this.post(makeHostMsg({ type: 'devices', devices })));
    service.on('state',   state    => this.post(makeHostMsg({ type: 'state', ...state })));
    service.on('stream-error', (err: unknown) => {
      const message = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : err == null
            ? 'unknown error'
            : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      this.post(makeHostMsg({ type: 'stream-error', message }));
    });
    service.on('append',  (rows: LogEntry[]) => this.maybeWarnReleaseBuild(rows));
    service.on('demo-flash', (payload: { seq: number; frameIndex: number }) => {
      this.post({ apiVersion: LOGCAT_API_VERSION, type: '_demoFlash', seq: payload.seq, frameIndex: payload.frameIndex });
    });
  }

  async resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'logcat'),
        vscode.Uri.joinPath(this.extensionUri, 'media', 'logcat'),
      ],
    };

    // Wire the listener BEFORE setting html so we don't miss the webview's
    // 'ready' handshake (the script loads almost synchronously after html is set).
    view.webview.onDidReceiveMessage((msg: ViewToHost) => this.onMessage(msg));
    view.webview.html = await this.renderHtml(view.webview);
  }

  /**
   * Pushes the initial state snapshot. Called from the 'ready' handler so the
   * webview is guaranteed to have its message listener installed.
   */
  private sendInitSnapshot(): void {
    void this.service.listDevices().then(devices => this.post(makeHostMsg({ type: 'devices', devices })));
    this.post(makeHostMsg({
      type: 'init',
      state: {
        followAppPid: true,
        paused:       false,
        colorScheme:  'studio',
        bufferCap:    this.service.snapshotState().bufferCap,
      },
    }));
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  private async onMessage(msg: ViewToHost): Promise<void> {
    if (!msg || typeof msg !== 'object' || msg.apiVersion !== LOGCAT_API_VERSION) return;

    switch (msg.type) {
      case 'ready':
        // Webview has loaded and installed its listener — push the init snapshot.
        this.sendInitSnapshot();
        break;

      case 'pickDevice':
        this.service.switchDevice(msg.serial);
        void this.service.listPackagesFor(msg.serial)
          .then(packages => this.post(makeHostMsg({ type: 'packages', serial: msg.serial, packages })));
        break;

      case 'pickPackage':
        this.service.setFollowedPackage(msg.packageName);
        break;

      case 'setLevels':
        this.service.setLevels(msg.levels);
        break;

      case 'setSearch':
        this.service.setSearch(msg.query);
        break;

      case 'setTagFilter':
        this.service.setTagFilter(msg.tag);
        break;

      case 'setFollowAppPid':
        this.service.setFollowAppPid(msg.enabled);
        break;

      case 'pause':
        this.service.pause();
        break;

      case 'resume':
        this.service.resume();
        break;

      case 'clear':
        this.service.clear();
        break;

      case 'export': {
        const text = this.service.exportFiltered();
        const doc = await vscode.workspace.openTextDocument({ content: text, language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: false });
        break;
      }

      case 'navigate': {
        try {
          const uri = vscode.Uri.parse(msg.uri);
          const line = Math.max(0, msg.line - 1);
          await vscode.window.showTextDocument(uri, {
            preview:   false,
            selection: new vscode.Range(line, 0, line, 0),
          });
        } catch { /* swallow */ }
        break;
      }

      case 'requestPackages': {
        const packages = await this.service.listPackagesFor(msg.serial);
        this.post(makeHostMsg({ type: 'packages', serial: msg.serial, packages }));
        break;
      }
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private maybeWarnReleaseBuild(rows: LogEntry[]): void {
    if (this.warnedReleaseBuild) return;
    if (rows.some(looksObfuscated)) {
      this.warnedReleaseBuild = true;
      this.post(makeHostMsg({ type: 'release-build-detected' }));
    }
  }

  // ── HTML shell ─────────────────────────────────────────────────────────────

  private async renderHtml(webview: vscode.Webview): Promise<string> {
    if (!this.htmlCache) {
      const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'logcat', 'index.html');
      this.htmlCache = await fs.readFile(htmlPath, 'utf8');
    }
    const nonce  = generateNonce();
    const cspSrc = webview.cspSource;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'logcat', 'main.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'logcat', 'styles.css'));

    return this.htmlCache
      .replace(/\{\{cspSource\}\}/g, cspSrc)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
      .replace(/\{\{styleUri\}\}/g, styleUri.toString());
  }
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
