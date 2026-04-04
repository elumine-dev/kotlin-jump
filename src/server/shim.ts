/**
 * Minimal shim that satisfies the `vscode` module contract used by
 * SymbolIndex and FindUsagesEngine when running outside VS Code (LSP server).
 *
 * esbuild aliases `vscode` → this file for the server build target.
 */
import * as nodefs from 'fs/promises';

// ── Uri ───────────────────────────────────────────────────────────────────────

export const Uri = {
  parse(s: string) {
    const fsPath = s.startsWith('file://')
      ? decodeURIComponent(s.slice('file://'.length))
      : s;
    return {
      toString: () => s,
      path: fsPath,
      fsPath,
      scheme: s.includes(':') ? s.split(':')[0] : 'file',
    };
  },
  file(fsPath: string) {
    const encoded = fsPath.split('/').map(seg => encodeURIComponent(seg)).join('/');
    return Uri.parse(`file://${encoded}`);
  },
};

// ── workspace ─────────────────────────────────────────────────────────────────

export const workspace = {
  getConfiguration(_section?: string) {
    return {
      get<T>(_key: string, defaultValue: T): T { return defaultValue; },
    };
  },
  fs: {
    async readFile(uri: { fsPath: string }): Promise<Uint8Array> {
      return nodefs.readFile(uri.fsPath);
    },
    async stat(uri: { fsPath: string }) {
      const s = await nodefs.stat(uri.fsPath);
      return { mtime: s.mtimeMs, size: s.size, type: 1 };
    },
  },
};

// ── Stub types used by SymbolIndex / providers ────────────────────────────────

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export class Location {
  constructor(public uri: ReturnType<typeof Uri.parse>, public range: Range) {}
}

// ── CancellationToken (never cancelled — server handles its own lifecycle) ────

export const CancellationToken = {
  None: { isCancellationRequested: false } as { isCancellationRequested: boolean },
};

// ── extensions (unused in server — companion mode not applicable) ─────────────

export const extensions = {
  getExtension(_id: string) { return undefined; },
};

// ── window / commands (no-ops in server) ─────────────────────────────────────

export const window = {
  createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '', tooltip: '' }),
  showInformationMessage: () => Promise.resolve(undefined),
  activeTextEditor: undefined,
};

export const commands = {
  executeCommand: () => Promise.resolve(undefined),
  registerCommand: () => ({ dispose() {} }),
};
