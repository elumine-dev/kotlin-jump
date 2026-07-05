export class ThemeColor {
  constructor(public id: string) {}
}

export class Position {
  constructor(public line: number, public character: number) {}
  isEqual(other: Position) { return this.line === other.line && this.character === other.character; }
  translate(dl: number, dc: number) { return new Position(this.line + dl, this.character + dc); }
}

export class Range {
  public start: Position;
  public end: Position;
  constructor(startOrLine: Position | number, endOrChar: Position | number, endLine?: number, endChar?: number) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine ?? startOrLine, endChar ?? (endOrChar as number));
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
}

export class Location {
  constructor(public uri: any, public range: Range | Position) {}
}

export class MarkdownString {
  value: string;
  constructor(value = '') { this.value = value; }
  appendCodeblock(code: string) { this.value += code; return this; }
  appendMarkdown(md: string) { this.value += md; return this; }
}

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return { dispose: () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    } };
  };
  fire(e: T) { for (const l of this._listeners.slice()) l(e); }
  dispose() { this._listeners = []; }
}

export class CodeLens {
  command?: any;
  constructor(public range: Range, command?: any) {
    if (command) this.command = command;
  }
}

export class Hover {
  public contents: MarkdownString[];
  constructor(contents: MarkdownString | MarkdownString[], public range?: Range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
  }
}

export class TypeHierarchyItem {
  constructor(
    public kind: number,
    public name: string,
    public detail: string,
    public uri: any,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export enum CodeActionTriggerKind {
  Invoke    = 1,
  Automatic = 2,
}

export class CodeActionKind {
  static readonly SourceOrganizeImports = new CodeActionKind('source.organizeImports');
  static readonly QuickFix              = new CodeActionKind('quickfix');
  static readonly Source                = new CodeActionKind('source');
  constructor(public readonly value: string) {}
  contains(other: CodeActionKind): boolean {
    return other.value === this.value || other.value.startsWith(`${this.value}.`);
  }
  append(part: string): CodeActionKind {
    return new CodeActionKind(`${this.value}.${part}`);
  }
}

export class CodeAction {
  edit?: WorkspaceEdit;
  isPreferred?: boolean;
  constructor(
    public title: string,
    public kind?: CodeActionKind,
  ) {}
}

export enum SymbolKind {
  File = 0,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  Object = 18,
  EnumMember = 21,
  Struct = 22,
}

export enum SymbolTag {
  Deprecated = 1,
}

export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  tags?: readonly SymbolTag[];
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export class CallHierarchyItem {
  data?: any;
  constructor(
    public kind: number,
    public name: string,
    public detail: string,
    public uri: any,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export class CallHierarchyIncomingCall {
  constructor(public from: CallHierarchyItem, public fromRanges: Range[]) {}
}

export class CallHierarchyOutgoingCall {
  constructor(public to: CallHierarchyItem, public fromRanges: Range[]) {}
}

export class SymbolInformation {
  constructor(
    public name: string,
    public kind: number,
    public containerName: string,
    public location: any,
  ) {}
}

export class TextEdit {
  constructor(public range: Range, public newText: string) {}
  static replace(range: Range, newText: string): TextEdit { return new TextEdit(range, newText); }
  static insert(position: Position, newText: string): TextEdit { return new TextEdit(new Range(position, position), newText); }
  static delete(range: Range): TextEdit { return new TextEdit(range, ''); }
}

export enum DocumentHighlightKind {
  Text  = 0,
  Read  = 1,
  Write = 2,
}

export class DocumentHighlight {
  constructor(public range: Range, public kind: DocumentHighlightKind = DocumentHighlightKind.Text) {}
}

export class WorkspaceEdit {
  private _entries: Array<{ uri: any; range: Range; newText: string }> = [];
  public _fileRenames: Array<{ oldUri: any; newUri: any; options?: any; metadata?: any }> = [];

  replace(uri: any, range: Range, newText: string, _metadata?: any): void {
    this._entries.push({ uri, range, newText });
  }

  set(uri: any, edits: ReadonlyArray<TextEdit | [TextEdit, any]>): void {
    for (const item of edits) {
      if (Array.isArray(item)) {
        const [te] = item as [TextEdit, any];
        this._entries.push({ uri, range: te.range, newText: te.newText });
      } else {
        const te = item as TextEdit;
        this._entries.push({ uri, range: te.range, newText: te.newText });
      }
    }
  }

  renameFile(oldUri: any, newUri: any, options?: any, metadata?: any): void {
    this._fileRenames.push({ oldUri, newUri, options, metadata });
  }

  entries(): Array<{ uri: any; range: Range; newText: string }> { return this._entries; }
  get size(): number { return this._entries.length; }
}

export const Uri = {
  parse: (s: string) => {
    // Extract path from scheme://authority/path  (e.g. file:///foo, kotlin-jar:///foo)
    const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)/i);
    const path = m ? m[1] : s.replace(/^file:\/\//, '');
    const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? 'file';
    return { toString: () => s, path, fsPath: path, scheme };
  },
  file: (p: string) => ({ toString: () => `file://${p}`, path: p, fsPath: p, scheme: 'file' }),
};

export enum OverviewRulerLane {
  Left   = 1,
  Center = 2,
  Right  = 4,
  Full   = 7,
}

export enum FileType {
  Unknown       = 0,
  File          = 1,
  Directory     = 2,
  SymbolicLink  = 64,
}

export enum FileChangeType {
  Changed = 1,
  Created = 2,
  Deleted = 3,
}

export class FileSystemError extends Error {
  static FileNotFound(messageOrUri?: string | any): FileSystemError {
    return new FileSystemError(`FileNotFound: ${messageOrUri}`);
  }
  static NoPermissions(messageOrUri?: string | any): FileSystemError {
    return new FileSystemError(`NoPermissions: ${messageOrUri}`);
  }
  static FileExists(messageOrUri?: string | any): FileSystemError {
    return new FileSystemError(`FileExists: ${messageOrUri}`);
  }
  static Unavailable(messageOrUri?: string | any): FileSystemError {
    return new FileSystemError(`Unavailable: ${messageOrUri}`);
  }
}

export enum StatusBarAlignment {
  Left  = 1,
  Right = 2,
}

export enum QuickPickItemKind {
  Separator = -1,
  Default   = 0,
}

export enum ConfigurationTarget {
  Global          = 1,
  Workspace       = 2,
  WorkspaceFolder = 3,
}

export enum DiagnosticSeverity {
  Error       = 0,
  Warning     = 1,
  Information = 2,
  Hint        = 3,
}

export class Diagnostic {
  public source?: string;
  constructor(public range: Range, public message: string, public severity: DiagnosticSeverity = DiagnosticSeverity.Error) {}
}

export enum TextEditorSelectionChangeKind {
  Keyboard = 1,
  Mouse    = 2,
  Command  = 3,
}

export enum TextEditorRevealType {
  Default                   = 0,
  InCenter                  = 1,
  InCenterIfOutsideViewport = 2,
  AtTop                     = 3,
}

export class Selection {
  constructor(public readonly anchor: Position, public readonly active: Position) {}
}

export const workspace = {
  textDocuments: [] as any[],
  getConfiguration: () => ({
    get: (_key: string, defaultVal: any) => defaultVal,
    update: async (_key: string, _value: any, _target?: any) => {},
  }),
  openTextDocument: async () => null,
  findFiles: async () => [] as any[],
  registerFileSystemProvider: () => ({ dispose: () => {} }),
  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
  onDidChangeTextDocument: (_listener: any) => ({ dispose: () => {} }),
  onDidOpenTextDocument:   (_listener: any) => ({ dispose: () => {} }),
  onDidCloseTextDocument:  (_listener: any) => ({ dispose: () => {} }),
  onDidSaveTextDocument:   (_listener: any) => ({ dispose: () => {} }),
  onDidChangeConfiguration: (_listener: any) => ({ dispose: () => {} }),
  fs: {
    readFile: async () => Buffer.from(''),
  },
};

export const window = {
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as any[],
  createTextEditorDecorationType: (_opts: any) => ({ dispose: () => {} }),
  createStatusBarItem: (_alignment?: StatusBarAlignment, _priority?: number) => ({
    text: '' as string,
    tooltip: '' as string,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  onDidChangeActiveTextEditor: (_listener: any) => ({ dispose: () => {} }),
  onDidChangeVisibleTextEditors: (_listener: any) => ({ dispose: () => {} }),
  onDidChangeTextEditorSelection: (_listener: any) => ({ dispose: () => {} }),
  showTextDocument: async (_doc: any, _opts?: any): Promise<any> => ({
    selection:      undefined as any,
    revealRange:    () => {},
    setDecorations: () => {},
  }),
  registerWebviewViewProvider: (_id: string, _provider: any, _options?: any) => ({ dispose: () => {} }),
  registerTreeDataProvider:    (_id: string, _provider: any) => ({ dispose: () => {} }),
};

export const commands = {
  executeCommand:  async (_cmd?: string, ..._args: any[]) => {},
  registerCommand: (_id: string, _handler: (...args: any[]) => any) => ({ dispose: () => {} }),
};

export const languages = {
  registerHoverProvider:      (_selector: any, _provider: any) => ({ dispose: () => {} }),
  registerColorProvider:      (_selector: any, _provider: any) => ({ dispose: () => {} }),
  createDiagnosticCollection: (_name?: string) => ({
    set:    (_uri: any, _diagnostics: any) => {},
    delete: (_uri: any) => {},
    clear:  () => {},
    dispose: () => {},
  }),
};

// ── Document Colors ───────────────────────────────────────────────────────────

export class Color {
  constructor(
    public red: number,
    public green: number,
    public blue: number,
    public alpha: number,
  ) {}
}

export class ColorInformation {
  constructor(public range: Range, public color: Color) {}
}

export class ColorPresentation {
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
  constructor(public label: string) {}
}

// ── Inlay Hints ───────────────────────────────────────────────────────────────

export enum InlayHintKind {
  Type      = 1,
  Parameter = 2,
}

export class InlayHintLabelPart {
  location?: Location;
  tooltip?: MarkdownString | string;
  command?: any;
  constructor(public value: string) {}
}

export class InlayHint {
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: MarkdownString | string;
  textEdits?: any[];
  constructor(
    public position: Position,
    public label: string | InlayHintLabelPart[],
    public kind?: InlayHintKind,
  ) {}
}

// ── Signature Help ────────────────────────────────────────────────────────────

export class ParameterInformation {
  documentation?: MarkdownString | string;
  constructor(public label: string | [number, number]) {}
}

export class SignatureInformation {
  parameters: ParameterInformation[] = [];
  documentation?: MarkdownString | string;
  activeParameter?: number;
  constructor(public label: string, doc?: string | MarkdownString) {
    if (doc) this.documentation = doc;
  }
}

export class SignatureHelp {
  signatures: SignatureInformation[] = [];
  activeSignature = 0;
  activeParameter = 0;
}

// ── Selection Ranges ──────────────────────────────────────────────────────────

export class SelectionRange {
  constructor(public range: Range, public parent?: SelectionRange) {}
}

// ── Folding Ranges ────────────────────────────────────────────────────────────

export class FoldingRange {
  constructor(public start: number, public end: number, public kind?: FoldingRangeKind) {}
}

export enum FoldingRangeKind {
  Comment = 1,
  Imports = 2,
  Region  = 3,
}

// ── Semantic Tokens ───────────────────────────────────────────────────────────

export class SemanticTokensLegend {
  constructor(public tokenTypes: string[], public tokenModifiers: string[]) {}
}

export class SemanticTokens {
  constructor(public data: Uint32Array, public resultId?: string) {}
}

export class SemanticTokensEdits {
  constructor(public edits: SemanticTokensEdit[], public resultId?: string) {}
}

export class SemanticTokensEdit {
  constructor(public start: number, public deleteCount: number, public data?: Uint32Array) {}
}

export class SemanticTokensBuilder {
  private _data: number[] = [];
  private _prevLine = 0;
  private _prevChar = 0;
  constructor(private _legend: SemanticTokensLegend) {}
  push(line: number, char: number, len: number, tokenType: number, tokenModifiers: number): void {
    const dl = line - this._prevLine;
    const dc = dl === 0 ? char - this._prevChar : char;
    this._data.push(dl, dc, len, tokenType, tokenModifiers);
    this._prevLine = line;
    this._prevChar = char;
  }
  build(resultId?: string): SemanticTokens {
    return new SemanticTokens(new Uint32Array(this._data), resultId);
  }
}

// ── Chat Participant ──────────────────────────────────────────────────────────

export const chat = {
  createChatParticipant: (_id: string, _handler: any) => ({
    iconPath: undefined as any,
    dispose: () => {},
  }),
};

// ── Language Model (MCP + LM APIs) ───────────────────────────────────────────

export class McpStdioServerDefinition {
  constructor(
    public label: string,
    public command: string,
    public args?: string[],
    public env?: Record<string, string | number | null>,
    public version?: string,
  ) {}
}

export const lm = {
  registerMcpServerDefinitionProvider: (_id: string, _provider: any) => ({ dispose: () => {} }),
};
